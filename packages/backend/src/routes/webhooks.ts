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
} from '@prisma/client';

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

  // Record the failed payment
  await prisma.payment.create({
    data: {
      clientId: membership.clientId,
      membershipId: membership.id,
      stripePaymentIntentId: invoice.payment_intent as string | null,
      stripeInvoiceId: invoice.id,
      amountCents: invoice.amount_due,
      status: PaymentStatus.FAILED,
      failureReason: 'Payment declined or failed',
    },
  });

  // Set membership to PAST_DUE
  await prisma.clientMembership.update({
    where: { id: membership.id },
    data: { status: MembershipStatus.PAST_DUE },
  });

  // Revoke credits for limited plans
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
          data: { creditsTotal: weeklyCredit.creditsUsed }, // Set total = used, so remaining = 0
        });

        await prisma.creditTransaction.create({
          data: {
            clientId: membership.clientId,
            transactionType: 'revoke',
            amount: -remaining,
            notes: `Credits revoked due to failed payment for ${membership.plan.name}`,
          },
        });
      }
    }
  }

  // Notify the client
  await notify({
    userId: membership.clientId,
    type: NotificationType.PAYMENT_FAILED,
    title: 'Payment Failed',
    body: `Your payment of $${(invoice.amount_due / 100).toFixed(2)} for ${membership.plan.name} was unsuccessful. Please contact us to update your payment method and avoid losing access to your sessions.`,
    channels: [NotificationChannel.EMAIL, NotificationChannel.SMS],
    metadata: { membershipId: membership.id, amountCents: invoice.amount_due },
  });

  // Notify all admins
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN', isActive: true },
    select: { id: true },
  });

  for (const admin of admins) {
    await notify({
      userId: admin.id,
      type: NotificationType.PAYMENT_FAILED,
      title: `Payment Failed: ${membership.client.fullName}`,
      body: `Payment of $${(invoice.amount_due / 100).toFixed(2)} failed for ${membership.client.fullName} (${membership.client.email}). Plan: ${membership.plan.name}. Membership set to PAST DUE.`,
      channels: [NotificationChannel.EMAIL],
      metadata: { membershipId: membership.id, clientId: membership.clientId },
    });
  }

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
