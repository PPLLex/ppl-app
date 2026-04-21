import { Router, Request, Response, NextFunction } from 'express';
import Stripe from 'stripe';
import { stripe } from '../services/stripeService';
import { prisma } from '../utils/prisma';
import { config } from '../config';
import { notify } from '../services/notificationService';
import { createAuditLog } from '../services/auditService';
import {
  MembershipStatus,
  PaymentStatus,
  NotificationType,
  NotificationChannel,
  BookingStatus,
} from '@prisma/client';
import { notifyLocationCoordinators } from '../services/paymentRetryService';

const router = Router();

/**
 * POST /api/webhooks/stripe
 * Handle Stripe webhook events.
 * IMPORTANT: This route uses raw body parsing (configured in app.ts).
 */
router.post('/stripe', async (req: Request, res: Response, next: NextFunction) => {
  const sig = req.headers['stripe-signature'] as string;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, config.stripe.webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Webhook signature verification failed:', message);
    return res.status(400).send(`Webhook Error: ${message}`);
  }

  try {
    switch (event.type) {
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      default:
        console.log(`Unhandled Stripe event: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error(`Webhook handler error for ${event.type}:`, error);
    // Still return 200 so Stripe doesn't retry
    res.json({ received: true, error: 'Handler error' });
  }
});

// ============================================================
// WEBHOOK HANDLERS
// ============================================================

/**
 * Payment succeeded — confirm membership, grant weekly credits.
 */
async function handlePaymentSucceeded(invoice: Stripe.Invoice) {
  const subscriptionId = invoice.subscription as string;
  if (!subscriptionId) return;

  const membership = await prisma.clientMembership.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
    include: { plan: true, client: { select: { id: true, fullName: true } } },
  });

  if (!membership) {
    console.error(`No membership found for Stripe subscription: ${subscriptionId}`);
    return;
  }

  // Record the payment
  await prisma.payment.create({
    data: {
      clientId: membership.clientId,
      membershipId: membership.id,
      stripePaymentIntentId: invoice.payment_intent as string | null,
      stripeInvoiceId: invoice.id,
      amountCents: invoice.amount_paid,
      status: PaymentStatus.SUCCEEDED,
    },
  });

  // If membership was PAST_DUE, restore it to ACTIVE
  if (membership.status === MembershipStatus.PAST_DUE) {
    await prisma.clientMembership.update({
      where: { id: membership.id },
      data: { status: MembershipStatus.ACTIVE },
    });

    // Restore credits for limited plans
    if (membership.plan.sessionsPerWeek !== null) {
      const weekStart = getWeekStart(new Date(), membership.billingDay);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);

      await prisma.weeklyCredit.upsert({
        where: {
          clientId_membershipId_weekStartDate: {
            clientId: membership.clientId,
            membershipId: membership.id,
            weekStartDate: weekStart,
          },
        },
        create: {
          clientId: membership.clientId,
          membershipId: membership.id,
          creditsTotal: membership.plan.sessionsPerWeek,
          creditsUsed: 0,
          weekStartDate: weekStart,
          weekEndDate: weekEnd,
        },
        update: {
          // Keep existing usage, just ensure record exists
        },
      });

      await prisma.creditTransaction.create({
        data: {
          clientId: membership.clientId,
          transactionType: 'restore',
          amount: membership.plan.sessionsPerWeek,
          notes: `Credits restored after successful payment for ${membership.plan.name}`,
        },
      });
    }

    await notify({
      userId: membership.clientId,
      type: NotificationType.CREDITS_RESTORED,
      title: 'Payment Successful — You\'re Back!',
      body: `Your payment of $${(invoice.amount_paid / 100).toFixed(2)} was successful. Your ${membership.plan.name} membership is active again and your booking credits have been restored.`,
      channels: [NotificationChannel.EMAIL, NotificationChannel.SMS],
      metadata: { membershipId: membership.id, amountCents: invoice.amount_paid },
    });
  } else {
    // Regular successful payment — grant new weekly credits for limited plans
    if (membership.plan.sessionsPerWeek !== null) {
      const weekStart = getWeekStart(new Date(), membership.billingDay);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);

      await prisma.weeklyCredit.upsert({
        where: {
          clientId_membershipId_weekStartDate: {
            clientId: membership.clientId,
            membershipId: membership.id,
            weekStartDate: weekStart,
          },
        },
        create: {
          clientId: membership.clientId,
          membershipId: membership.id,
          creditsTotal: membership.plan.sessionsPerWeek,
          creditsUsed: 0,
          weekStartDate: weekStart,
          weekEndDate: weekEnd,
        },
        update: {
          // Reset credits for new week
          creditsUsed: 0,
        },
      });
    }

    await notify({
      userId: membership.clientId,
      type: NotificationType.PAYMENT_SUCCEEDED,
      title: 'Payment Received',
      body: `Your weekly payment of $${(invoice.amount_paid / 100).toFixed(2)} for ${membership.plan.name} was processed successfully.`,
      channels: [NotificationChannel.EMAIL],
      metadata: { membershipId: membership.id, amountCents: invoice.amount_paid },
    });
  }

  await createAuditLog({
    userId: membership.clientId,
    locationId: membership.locationId,
    action: 'payment.succeeded',
    resourceType: 'payment',
    changes: {
      amountCents: invoice.amount_paid,
      stripeInvoiceId: invoice.id,
      planName: membership.plan.name,
    },
  });
}

/**
 * Payment failed — set PAST_DUE, revoke credits, notify client + admins.
 */
async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const subscriptionId = invoice.subscription as string;
  if (!subscriptionId) return;

  const membership = await prisma.clientMembership.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
    include: { plan: true, client: { select: { id: true, fullName: true, email: true } } },
  });

  if (!membership) {
    console.error(`No membership found for Stripe subscription: ${subscriptionId}`);
    return;
  }

  // Get Stripe's failure reason if available
  let failureReason = 'Payment declined or failed';
  let friendlyReason = 'Your bank declined the payment.';
  try {
    if (invoice.payment_intent) {
      const pi = await stripe.paymentIntents.retrieve(invoice.payment_intent as string);
      const lastCharge = pi.latest_charge;
      if (lastCharge && typeof lastCharge === 'string') {
        const charge = await stripe.charges.retrieve(lastCharge);
        if (charge.failure_message) failureReason = charge.failure_message;
        // Map Stripe decline codes to friendly messages
        const code = charge.failure_code || '';
        switch (code) {
          case 'card_declined': friendlyReason = 'Your card was declined by your bank.'; break;
          case 'insufficient_funds': friendlyReason = 'Your card has insufficient funds.'; break;
          case 'expired_card': friendlyReason = 'Your card has expired. Please update your card.'; break;
          case 'incorrect_cvc': friendlyReason = 'The CVC code was incorrect.'; break;
          case 'processing_error': friendlyReason = 'A processing error occurred. Please try again.'; break;
          case 'lost_card': friendlyReason = 'This card has been reported lost. Please use a different card.'; break;
          case 'stolen_card': friendlyReason = 'This card has been reported stolen. Please use a different card.'; break;
          default: friendlyReason = charge.failure_message || 'Your bank declined the payment.'; break;
        }
      }
    }
  } catch (err) {
    console.error('Error fetching Stripe failure reason:', err);
  }

  // Record the failed payment
  await prisma.payment.create({
    data: {
      clientId: membership.clientId,
      membershipId: membership.id,
      stripePaymentIntentId: invoice.payment_intent as string | null,
      stripeInvoiceId: invoice.id,
      amountCents: invoice.amount_due,
      status: PaymentStatus.FAILED,
      failureReason,
    },
  });

  // Set membership to PAST_DUE — triggers dummy mode via membershipGuard
  await prisma.clientMembership.update({
    where: { id: membership.id },
    data: { status: MembershipStatus.PAST_DUE },
  });

  // ---- REMOVE ATHLETE FROM ALL FUTURE BOOKED SESSIONS ----
  // Cancel all upcoming bookings and return credits to account (frozen)
  const now = new Date();
  const futureBookings = await prisma.booking.findMany({
    where: {
      clientId: membership.clientId,
      status: BookingStatus.CONFIRMED,
      session: { startTime: { gt: now } },
    },
    include: { session: { select: { id: true, startTime: true, sessionTypeName: true } } },
  });

  if (futureBookings.length > 0) {
    // Cancel all future bookings
    await prisma.booking.updateMany({
      where: { id: { in: futureBookings.map(b => b.id) } },
      data: { status: BookingStatus.CANCELLED, cancelledAt: now },
    });

    // Return credits for each cancelled booking (they'll be frozen below)
    for (const booking of futureBookings) {
      if (booking.creditsUsed > 0) {
        // Find the weekly credit record and return the credits
        const weeklyCredit = await prisma.weeklyCredit.findFirst({
          where: {
            clientId: membership.clientId,
            membershipId: membership.id,
            weekStartDate: { lte: booking.session.startTime },
            weekEndDate: { gt: booking.session.startTime },
          },
        });
        if (weeklyCredit) {
          await prisma.weeklyCredit.update({
            where: { id: weeklyCredit.id },
            data: { creditsUsed: { decrement: booking.creditsUsed } },
          });
        }
      }
    }

    console.log(`[PaymentFailed] Cancelled ${futureBookings.length} future bookings for ${membership.client.fullName}`);

    await prisma.creditTransaction.create({
      data: {
        clientId: membership.clientId,
        transactionType: 'cancel_return',
        amount: futureBookings.reduce((sum, b) => sum + b.creditsUsed, 0),
        notes: `Credits returned from ${futureBookings.length} cancelled bookings due to failed payment. Credits are frozen until payment resolves.`,
      },
    });
  }

  // Revoke ALL credits — full lockdown
  if (membership.plan.sessionsPerWeek !== null) {
    const weekStart = getWeekStart(new Date(), membership.billingDay);

    const weeklyCredit = await prisma.weeklyCredit.findFirst({
      where: {
        clientId: membership.clientId,
        membershipId: membership.id,
        weekStartDate: weekStart,
      },
    });

    if (weeklyCredit) {
      const remaining = weeklyCredit.creditsTotal - weeklyCredit.creditsUsed;
      if (remaining > 0) {
        await prisma.weeklyCredit.update({
          where: { id: weeklyCredit.id },
          data: { creditsTotal: weeklyCredit.creditsUsed },
        });

        await prisma.creditTransaction.create({
          data: {
            clientId: membership.clientId,
            transactionType: 'revoke',
            amount: -remaining,
            notes: `Credits frozen due to failed payment for ${membership.plan.name}. Reason: ${failureReason}`,
          },
        });
      }
    }
  }

  // Notify the client via ALL channels — push, SMS, and email
  const amount = `$${(invoice.amount_due / 100).toFixed(2)}`;
  await notify({
    userId: membership.clientId,
    type: NotificationType.PAYMENT_FAILED,
    title: 'Payment Failed — Account On Hold',
    body: `Your ${amount} payment for ${membership.plan.name} failed. Reason: ${friendlyReason} Your account is now on hold — you cannot book sessions or access training programs until your payment is resolved. Please update your payment method in the app to restore access.`,
    channels: [NotificationChannel.EMAIL, NotificationChannel.SMS, NotificationChannel.PUSH],
    metadata: {
      membershipId: membership.id,
      amountCents: invoice.amount_due,
      failureReason: friendlyReason,
      action: 'UPDATE_PAYMENT',
    },
  });

  // Notify coordinators at the athlete's location (not all staff)
  const ageGroup = await prisma.athleteProfile.findFirst({
    where: { userId: membership.clientId },
    select: { ageGroup: true },
  }).then(p => p?.ageGroup || membership.plan.ageGroup);

  await notifyLocationCoordinators({
    locationId: membership.locationId,
    ageGroup,
    type: NotificationType.PAYMENT_FAILED,
    title: `Payment Failed: ${membership.client.fullName}`,
    body: `Payment of ${amount} failed for ${membership.client.fullName} (${membership.client.email}). Plan: ${membership.plan.name}. Reason: ${failureReason}. ${futureBookings.length > 0 ? `${futureBookings.length} upcoming session(s) have been cancelled.` : ''} Account is locked until payment resolves.`,
    metadata: { membershipId: membership.id, clientId: membership.clientId, cancelledBookings: futureBookings.length },
  });

  await createAuditLog({
    userId: membership.clientId,
    locationId: membership.locationId,
    action: 'payment.failed',
    resourceType: 'payment',
    changes: {
      amountCents: invoice.amount_due,
      stripeInvoiceId: invoice.id,
      planName: membership.plan.name,
      membershipStatus: 'PAST_DUE',
      failureReason,
      friendlyReason,
      accountLocked: true,
    },
  });
}

/**
 * Subscription deleted in Stripe — finalize the cancellation.
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const membership = await prisma.clientMembership.findUnique({
    where: { stripeSubscriptionId: subscription.id },
    include: { plan: true },
  });

  if (!membership) return;

  await prisma.clientMembership.update({
    where: { id: membership.id },
    data: {
      status: MembershipStatus.CANCELLED,
      cancelledAt: new Date(),
    },
  });

  await notify({
    userId: membership.clientId,
    type: NotificationType.MEMBERSHIP_STATUS_CHANGE,
    title: 'Membership Ended',
    body: `Your ${membership.plan.name} membership has officially ended. We hope to see you again! Contact us anytime to restart your membership.`,
    channels: [NotificationChannel.EMAIL, NotificationChannel.SMS],
    metadata: { membershipId: membership.id },
  });

  await createAuditLog({
    userId: membership.clientId,
    locationId: membership.locationId,
    action: 'membership.ended',
    resourceType: 'membership',
    resourceId: membership.id,
  });
}

/**
 * Subscription updated in Stripe — sync status.
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const membership = await prisma.clientMembership.findUnique({
    where: { stripeSubscriptionId: subscription.id },
  });

  if (!membership) return;

  // Sync status based on Stripe subscription status
  let newStatus: MembershipStatus | null = null;

  switch (subscription.status) {
    case 'active':
      if (membership.status !== MembershipStatus.ACTIVE) {
        newStatus = MembershipStatus.ACTIVE;
      }
      break;
    case 'past_due':
      if (membership.status !== MembershipStatus.PAST_DUE) {
        newStatus = MembershipStatus.PAST_DUE;
      }
      break;
    case 'canceled':
    case 'unpaid':
      if (membership.status !== MembershipStatus.CANCELLED) {
        newStatus = MembershipStatus.CANCELLED;
      }
      break;
  }

  if (newStatus) {
    await prisma.clientMembership.update({
      where: { id: membership.id },
      data: { status: newStatus },
    });
  }
}

/**
 * Checkout session completed — handle one-time onboarding fee payments.
 * Belt-and-suspenders: the frontend also calls /onboarding/confirm-payment,
 * but this webhook ensures we never miss a payment confirmation.
 */
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  const metadata = session.metadata || {};

  // Only handle onboarding fee payments
  if (metadata.type !== 'onboarding_fee') return;

  const { onboardingRecordId } = metadata;
  if (!onboardingRecordId) return;

  if (session.payment_status !== 'paid') return;

  const record = await prisma.onboardingRecord.findUnique({
    where: { id: onboardingRecordId },
  });

  if (!record || record.feeStatus === 'PAID') return;

  await prisma.onboardingRecord.update({
    where: { id: record.id },
    data: {
      feeStatus: 'PAID',
      stripePaymentId: session.payment_intent as string,
      completedAt: new Date(),
    },
  });

  console.log(`Onboarding fee PAID via webhook for record ${onboardingRecordId}`);
}

// ============================================================
// Helper
// ============================================================

function getWeekStart(date: Date, billingDay: string): Date {
  const d = new Date(date);
  const dayMap: Record<string, number> = { MONDAY: 1, THURSDAY: 4 };
  const targetDay = dayMap[billingDay] || 1;
  const currentDay = d.getDay();

  let diff = currentDay - targetDay;
  if (diff < 0) diff += 7;

  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default router;
