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

// ============================================================
// EASTERN TIME HELPERS
// ============================================================
//
// Railway runs in UTC, but PPL's billing + ops clock is Eastern. These
// helpers let us reason about "9 AM Eastern" without a datetime library.
//
// US Eastern DST rules:
//   DST starts: 2nd Sunday of March at 02:00 local (spring forward to EDT, UTC-4)
//   DST ends:   1st Sunday of November at 02:00 local (fall back to EST, UTC-5)
//
// Exact enough for billing scheduling — the 5-day cushion in
// calculateBillingAnchor makes one-hour discrepancies harmless.

/** True if the given UTC instant falls in US Eastern Daylight Time. */
function isEasternDST(d: Date): boolean {
  const year = d.getUTCFullYear();
  // 2nd Sunday of March
  const march1 = new Date(Date.UTC(year, 2, 1));
  const daysToFirstSunMar = (7 - march1.getUTCDay()) % 7;
  const dstStart = new Date(Date.UTC(year, 2, 1 + daysToFirstSunMar + 7, 7)); // 02:00 EST = 07:00 UTC
  // 1st Sunday of November
  const nov1 = new Date(Date.UTC(year, 10, 1));
  const daysToFirstSunNov = (7 - nov1.getUTCDay()) % 7;
  const dstEnd = new Date(Date.UTC(year, 10, 1 + daysToFirstSunNov, 6)); // 02:00 EDT = 06:00 UTC
  return d >= dstStart && d < dstEnd;
}

/** Current hour (0-23) in America/New_York. */
export function getEasternHour(now: Date = new Date()): number {
  const offsetHours = isEasternDST(now) ? 4 : 5; // EDT=UTC-4, EST=UTC-5
  return (now.getUTCHours() - offsetHours + 24) % 24;
}

/** Current day-of-week in America/New_York (0=Sun, 1=Mon, ..., 6=Sat). */
export function getEasternDay(now: Date = new Date()): number {
  const offsetHours = isEasternDST(now) ? 4 : 5;
  // Shift UTC hours back by the offset to get local hour, then compute day.
  const localMs = now.getTime() - offsetHours * 60 * 60 * 1000;
  return new Date(localMs).getUTCDay();
}

/**
 * Calculate the next billing anchor — the specific UTC instant of the next
 * Monday or Thursday at 09:00 America/New_York, at least 5 days out from
 * the signup. 5-day cushion gives Stripe enough time to finalize the
 * signup-day invoice before the first recurring one fires.
 *
 * Example: customer signs up Wed 2026-04-22 14:30 UTC (10:30 AM ET);
 *   billingDay=MONDAY → anchor = Mon 2026-04-27 13:00 UTC (09:00 AM EDT).
 *   billingDay=THURSDAY → anchor = Thu 2026-04-30 13:00 UTC (09:00 AM EDT).
 */
export function calculateBillingAnchor(paymentDate: Date, billingDay: BillingDay): Date {
  const targetEasternDay = billingDay === BillingDay.MONDAY ? 1 : 4;

  // Work entirely in Eastern-local terms first, then shift back to UTC.
  const paymentEasternDay = getEasternDay(paymentDate);

  // Days forward to next Mon or Thu (in Eastern weekday numbering).
  let daysAhead = (targetEasternDay - paymentEasternDay + 7) % 7;
  if (daysAhead === 0) daysAhead = 7; // always push to NEXT Mon/Thu, not today

  // Anchor date calendar day (in Eastern terms). Start from paymentDate's
  // Eastern-date midnight, add daysAhead, then set local 09:00.
  const etOffsetHoursNow = isEasternDST(paymentDate) ? 4 : 5;
  const paymentEasternMs = paymentDate.getTime() - etOffsetHoursNow * 60 * 60 * 1000;
  const paymentEasternMidnight = new Date(paymentEasternMs);
  paymentEasternMidnight.setUTCHours(0, 0, 0, 0);

  let anchorEastern = new Date(
    paymentEasternMidnight.getTime() + daysAhead * 24 * 60 * 60 * 1000
  );
  anchorEastern.setUTCHours(9, 0, 0, 0); // 09:00 Eastern local

  // Re-anchor if <5 days out
  const diffDays = (anchorEastern.getTime() - paymentEasternMs) / (1000 * 60 * 60 * 24);
  if (diffDays < 5) {
    anchorEastern = new Date(anchorEastern.getTime() + 7 * 24 * 60 * 60 * 1000);
  }

  // Convert back to UTC using the DST state AT THE ANCHOR (handles
  // cross-DST-boundary signups correctly).
  const etOffsetHoursAnchor = isEasternDST(anchorEastern) ? 4 : 5;
  return new Date(anchorEastern.getTime() + etOffsetHoursAnchor * 60 * 60 * 1000);
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
  /** Specific AthleteProfile this subscription covers. Required for
   * multi-athlete families so credits + bookings route to the right kid.
   * Optional for single-athlete accounts (legacy flow still works). */
  athleteProfileId?: string;
}): Promise<{
  subscriptionId: string;
  clientSecret: string;
  billingDay: BillingDay;
  billingAnchorDate: Date;
}> {
  const { userId, planId, locationId, athleteProfileId } = params;

  // Load the plan once — we need its billingCycle to decide whether to
  // anchor to Mon/Thu (weekly plans) or leave on the signup-date cycle
  // (Pro monthly plans, per Chad 2026-04-23).
  const plan = await prisma.membershipPlan.findUnique({ where: { id: planId } });
  if (!plan) throw new Error('Plan not found');

  // Get/create Stripe customer
  const stripeCustomerId = await getOrCreateStripeCustomer(userId);

  // Get/create Stripe price
  const stripePriceId = await getOrCreateStripePrice(planId);

  // Determine billing day based on current date (will be adjusted after first payment succeeds)
  const now = new Date();
  const billingDay = determineBillingDay(now);
  const billingAnchorDate = calculateBillingAnchor(now, billingDay);

  // Anchor recurring invoices to the next Mon/Thu 09:00 Eastern. Stripe then:
  //   1. Charges a prorated amount NOW for the gap (signup → anchor) via the
  //      initial invoice + the Payment Intent we return to the frontend.
  //   2. Bills the full weekly rate on every anchor date thereafter.
  // Result: all weekly subscribers bill Mon OR Thu at 09:00 ET. Retries of
  // failed invoices are handled by paymentRetryService (daily at 09:00 ET).
  //
  // PRO MONTHLY plans (plan-pro-*) stay on their signup-date monthly cycle —
  // anchoring them to Mon/Thu would require weekly conversion and Chad opted
  // to leave Pro plans alone (2026-04-23 scope call).
  const isWeekly = plan.billingCycle === 'weekly' || plan.billingCycle === 'WEEKLY';

  const createParams: Stripe.SubscriptionCreateParams = {
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
      // Stamp the athlete on the Stripe side too so webhooks can
      // resolve the right kid even without a DB roundtrip.
      ...(athleteProfileId ? { ppl_athlete_profile_id: athleteProfileId } : {}),
    },
  };

  if (isWeekly) {
    createParams.billing_cycle_anchor = Math.floor(billingAnchorDate.getTime() / 1000);
    // 'create_prorations' bills the signup-to-anchor gap on day 1; subsequent
    // cycles run on schedule. This is what lets the first charge land on the
    // registration day while every future charge lands on Mon/Thu.
    createParams.proration_behavior = 'create_prorations';
  }

  const subscription = await stripe.subscriptions.create(createParams);

  // Extract client secret for frontend payment completion
  const invoice = subscription.latest_invoice as Stripe.Invoice;
  const paymentIntent = invoice.payment_intent as Stripe.PaymentIntent;

  // Create the membership record (pending until payment succeeds)
  await prisma.clientMembership.create({
    data: {
      clientId: userId,
      planId,
      locationId,
      athleteId: athleteProfileId ?? null,
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
