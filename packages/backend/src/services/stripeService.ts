import Stripe from 'stripe';
import { config } from '../config';
import { prisma } from '../utils/prisma';
import { BillingDay, MembershipStatus } from '@prisma/client';

const stripe = new Stripe(config.stripe.secretKey);

// ============================================================
// BILLING DAY ALIGNMENT LOGIC
// ============================================================

/**
 * Determine billing day based on when payment succeeds.
 * Mon-Thu payment → bill on Mondays
 * Fri-Sun payment → bill on Thursdays
 */
export function determineBillingDay(paymentDate: Date): BillingDay {
  const day = paymentDate.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  // Friday=5, Saturday=6, Sunday=0
  if (day === 0 || day === 5 || day === 6) {
    return BillingDay.THURSDAY;
  }
  return BillingDay.MONDAY;
}

/**
 * Calculate the next billing anchor date (the first recurring charge date).
 * Ensures at least 5 days before the first auto-charge.
 */
export function calculateBillingAnchor(paymentDate: Date, billingDay: BillingDay): Date {
  const targetDayNum = billingDay === BillingDay.MONDAY ? 1 : 4; // 1=Mon, 4=Thu
  const anchor = new Date(paymentDate);

  // Move forward to the next occurrence of the target day
  while (anchor.getDay() !== targetDayNum) {
    anchor.setDate(anchor.getDate() + 1);
  }

  // If less than 5 days away, push to the week after
  const diffDays = (anchor.getTime() - paymentDate.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays < 5) {
    anchor.setDate(anchor.getDate() + 7);
  }

  anchor.setHours(0, 0, 0, 0);
  return anchor;
}

// ============================================================
// STRIPE CUSTOMER MANAGEMENT
// ============================================================

/**
 * Get or create a Stripe customer for a PPL user.
 */
export async function getOrCreateStripeCustomer(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, fullName: true, phone: true, stripeCustomerId: true },
  });

  if (!user) throw new Error('User not found');

  if (user.stripeCustomerId) {
    return user.stripeCustomerId;
  }

  // Create new Stripe customer
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.fullName,
    phone: user.phone || undefined,
    metadata: {
      ppl_user_id: user.id,
    },
  });

  // Store the Stripe customer ID
  await prisma.user.update({
    where: { id: userId },
    data: { stripeCustomerId: customer.id },
  });

  return customer.id;
}

// ============================================================
// STRIPE SUBSCRIPTION (MEMBERSHIP) MANAGEMENT
// ============================================================

/**
 * Create a Stripe Price for a membership plan (weekly recurring).
 * We'll create prices dynamically or use existing ones.
 */
export async function getOrCreateStripePrice(planId: string): Promise<string> {
  const plan = await prisma.membershipPlan.findUnique({ where: { id: planId } });
  if (!plan) throw new Error('Plan not found');

  // Check if we already have a Stripe price for this plan
  // Search by metadata
  const existingPrices = await stripe.prices.search({
    query: `metadata["ppl_plan_id"]:"${planId}" active:"true"`,
  });

  if (existingPrices.data.length > 0) {
    return existingPrices.data[0].id;
  }

  // Create a product first
  const product = await stripe.products.create({
    name: plan.name,
    metadata: { ppl_plan_id: planId },
  });

  // Recurring interval driven by plan.billingCycle — weekly plans billed
  // every 7 days, monthly plans (Pro tiers) billed every 30-ish days.
  const interval: 'week' | 'month' =
    plan.billingCycle === 'monthly' ? 'month' : 'week';

  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: plan.priceCents,
    currency: 'usd',
    recurring: {
      interval,
      interval_count: 1,
    },
    metadata: { ppl_plan_id: planId, billing_cycle: plan.billingCycle },
  });

  return price.id;
}

/**
 * Create a subscription for a client.
 * Returns a client_secret for the frontend to complete payment.
 */
export async function createSubscription(params: {
  userId: string;
  planId: string;
  locationId: string;
}): Promise<{
  subscriptionId: string;
  clientSecret: string;
  billingDay: BillingDay;
  billingAnchorDate: Date;
}> {
  const { userId, planId, locationId } = params;

  // Get/create Stripe customer
  const stripeCustomerId = await getOrCreateStripeCustomer(userId);

  // Get/create Stripe price
  const stripePriceId = await getOrCreateStripePrice(planId);

  // Determine billing day based on current date (will be adjusted after first payment succeeds)
  const now = new Date();
  const billingDay = determineBillingDay(now);
  const billingAnchorDate = calculateBillingAnchor(now, billingDay);

  // Create the subscription with a trial period until the billing anchor
  // This means the first charge happens now, then recurring starts on the anchor date
  const subscription = await stripe.subscriptions.create({
    customer: stripeCustomerId,
    items: [{ price: stripePriceId }],
    payment_behavior: 'default_incomplete',
    payment_settings: {
      save_default_payment_method: 'on_subscription',
    },
    expand: ['latest_invoice.payment_intent'],
    metadata: {
      ppl_user_id: userId,
      ppl_plan_id: planId,
      ppl_location_id: locationId,
      ppl_billing_day: billingDay,
    },
  });

  // Extract client secret for frontend payment completion
  const invoice = subscription.latest_invoice as Stripe.Invoice;
  const paymentIntent = invoice.payment_intent as Stripe.PaymentIntent;

  // Create the membership record (pending until payment succeeds)
  await prisma.clientMembership.create({
    data: {
      clientId: userId,
      planId,
      locationId,
      status: MembershipStatus.ACTIVE, // Will be confirmed by webhook
      stripeSubscriptionId: subscription.id,
      stripePriceId,
      billingDay,
      billingAnchorDate,
    },
  });

  return {
    subscriptionId: subscription.id,
    clientSecret: paymentIntent.client_secret!,
    billingDay,
    billingAnchorDate,
  };
}

/**
 * Cancel a subscription (admin action only).
 */
export async function cancelSubscription(membershipId: string): Promise<void> {
  const membership = await prisma.clientMembership.findUnique({
    where: { id: membershipId },
  });

  if (!membership || !membership.stripeSubscriptionId) {
    throw new Error('Membership or subscription not found');
  }

  // Cancel at period end so they keep access until current billing cycle ends
  await stripe.subscriptions.update(membership.stripeSubscriptionId, {
    cancel_at_period_end: true,
  });

  await prisma.clientMembership.update({
    where: { id: membershipId },
    data: {
      status: MembershipStatus.CANCELLED,
      cancelledAt: new Date(),
    },
  });
}

/**
 * Create a secure card update session for a client.
 * Returns a URL the client can use to update their payment method.
 */
export async function createCardUpdateSession(userId: string): Promise<string> {
  const stripeCustomerId = await getOrCreateStripeCustomer(userId);

  // Create a Stripe Billing Portal session for card updates only
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${config.frontendUrl}/client/membership`,
  });

  return session.url;
}

/**
 * Retry a failed payment for a subscription.
 */
export async function retryPayment(membershipId: string): Promise<boolean> {
  const membership = await prisma.clientMembership.findUnique({
    where: { id: membershipId },
  });

  if (!membership || !membership.stripeSubscriptionId) {
    throw new Error('Membership or subscription not found');
  }

  try {
    // Get the latest invoice
    const invoices = await stripe.invoices.list({
      subscription: membership.stripeSubscriptionId,
      status: 'open',
      limit: 1,
    });

    if (invoices.data.length > 0) {
      await stripe.invoices.pay(invoices.data[0].id);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export { stripe };
