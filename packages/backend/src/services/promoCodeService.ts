/**
 * Promo code helpers (#138 / PREMIUM_AUDIT).
 *
 * Two responsibilities:
 *   1. Mirror PromoCode rows to Stripe Coupons + Promotion Codes so the
 *      discount actually applies during a Stripe-driven subscription.
 *   2. Validate redemption attempts (active? expired? at max redemptions?
 *      already redeemed by this user?).
 *
 * Why mirror to Stripe instead of computing the discount ourselves?
 *   - Stripe applies the coupon on every recurring invoice automatically
 *     (REPEATING durations honor durationInMonths without our cron).
 *   - Stripe-hosted checkout flows (future, e.g. Stripe Checkout / Payment
 *     Links) get the coupon for free.
 *   - Reporting and tax/refund accounting all live in Stripe consistently.
 *
 * The local DB is the source of truth for: code → coupon mapping, who
 * redeemed what, redemption counts. Stripe is the source of truth for:
 * the actual discount calculation that hits the customer's invoice.
 */

import Stripe from 'stripe';
import { prisma } from '../utils/prisma';
import { stripe } from './stripeService';
import {
  PromoCode,
  PromoCodeDiscountType,
  PromoCodeDuration,
} from '@prisma/client';

const CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/;

export interface PromoCodeInput {
  code: string;
  label: string;
  discountType: PromoCodeDiscountType;
  percentOff?: number | null;
  amountOffCents?: number | null;
  duration: PromoCodeDuration;
  durationInMonths?: number | null;
  maxRedemptions?: number | null;
  expiresAt?: Date | null;
}

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Validate the shape of a promo code submission. Throws Error with a
 * user-friendly message on failure — caller wraps in ApiError.badRequest.
 */
export function validatePromoCodeInput(input: PromoCodeInput): void {
  if (!input.code || !CODE_PATTERN.test(input.code)) {
    throw new Error(
      'Code must be 3–32 characters of A–Z, 0–9, hyphens, or underscores.'
    );
  }
  if (!input.label || input.label.trim().length === 0) {
    throw new Error('A label is required so this code is identifiable in reports.');
  }
  if (input.discountType === 'PERCENT_OFF') {
    if (
      input.percentOff === null ||
      input.percentOff === undefined ||
      input.percentOff < 1 ||
      input.percentOff > 100
    ) {
      throw new Error('Percent off must be between 1 and 100.');
    }
    if (input.amountOffCents) {
      throw new Error('Choose either a percent or a flat amount, not both.');
    }
  } else if (input.discountType === 'AMOUNT_OFF') {
    if (
      input.amountOffCents === null ||
      input.amountOffCents === undefined ||
      input.amountOffCents <= 0
    ) {
      throw new Error('Amount off must be a positive value in cents.');
    }
    if (input.percentOff) {
      throw new Error('Choose either a percent or a flat amount, not both.');
    }
  } else {
    throw new Error('Unknown discount type.');
  }
  if (input.duration === 'REPEATING') {
    if (
      input.durationInMonths === null ||
      input.durationInMonths === undefined ||
      input.durationInMonths < 1 ||
      input.durationInMonths > 24
    ) {
      throw new Error('Repeating coupons must specify 1–24 months.');
    }
  } else if (input.durationInMonths) {
    throw new Error('durationInMonths is only valid when duration is REPEATING.');
  }
  if (input.maxRedemptions !== null && input.maxRedemptions !== undefined) {
    if (input.maxRedemptions < 1) {
      throw new Error('maxRedemptions must be 1 or greater (omit for unlimited).');
    }
  }
}

/**
 * Create the matching Stripe Coupon for a promo code. Returns the new
 * coupon's ID. Throws on Stripe error — caller decides how to handle.
 */
export async function createStripeCoupon(input: PromoCodeInput): Promise<string> {
  const params: Stripe.CouponCreateParams = {
    name: input.label,
    duration: input.duration.toLowerCase() as Stripe.CouponCreateParams.Duration,
    metadata: { ppl_code: input.code },
  };

  if (input.discountType === 'PERCENT_OFF') {
    params.percent_off = input.percentOff!;
  } else {
    params.amount_off = input.amountOffCents!;
    params.currency = 'usd';
  }

  if (input.duration === 'REPEATING') {
    params.duration_in_months = input.durationInMonths!;
  }
  if (input.maxRedemptions) {
    params.max_redemptions = input.maxRedemptions;
  }
  if (input.expiresAt) {
    params.redeem_by = Math.floor(input.expiresAt.getTime() / 1000);
  }

  const coupon = await stripe.coupons.create(params);
  return coupon.id;
}

/**
 * Look up a promo code by its human-typed string. Returns the row if it
 * exists AND is currently redeemable; otherwise returns a structured
 * reason so the caller can surface the right error message.
 *
 * `userId` is optional — when supplied, we also check that this user
 * hasn't already redeemed the code (so re-typing it on retry doesn't
 * silently double-redeem).
 */
export type PromoLookupResult =
  | { ok: true; promo: PromoCode }
  | { ok: false; reason: 'not_found' | 'inactive' | 'expired' | 'maxed' | 'already_redeemed' };

export async function lookupRedeemablePromoCode(
  rawCode: string,
  organizationId = 'ppl',
  userId?: string
): Promise<PromoLookupResult> {
  const code = normalizeCode(rawCode);
  const promo = await prisma.promoCode.findUnique({
    where: { organizationId_code: { organizationId, code } },
  });
  if (!promo) return { ok: false, reason: 'not_found' };
  if (!promo.isActive) return { ok: false, reason: 'inactive' };
  if (promo.expiresAt && promo.expiresAt < new Date()) {
    return { ok: false, reason: 'expired' };
  }
  if (
    promo.maxRedemptions !== null &&
    promo.maxRedemptions !== undefined &&
    promo.redemptionCount >= promo.maxRedemptions
  ) {
    return { ok: false, reason: 'maxed' };
  }
  if (userId) {
    const prior = await prisma.promoCodeRedemption.findFirst({
      where: { promoCodeId: promo.id, userId },
    });
    if (prior) return { ok: false, reason: 'already_redeemed' };
  }
  return { ok: true, promo };
}

/**
 * Record that a user redeemed a promo code. Bumps the global counter and
 * writes the redemption row. Optionally links to a membership/subscription
 * for reporting. Caller is responsible for actually applying the coupon
 * to the Stripe subscription (we just track it).
 */
export async function recordPromoRedemption(params: {
  promoCodeId: string;
  userId: string;
  membershipId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeCouponId?: string | null;
}) {
  await prisma.$transaction([
    prisma.promoCodeRedemption.create({
      data: {
        promoCodeId: params.promoCodeId,
        userId: params.userId,
        membershipId: params.membershipId ?? null,
        stripeSubscriptionId: params.stripeSubscriptionId ?? null,
        stripeCouponId: params.stripeCouponId ?? null,
      },
    }),
    prisma.promoCode.update({
      where: { id: params.promoCodeId },
      data: { redemptionCount: { increment: 1 } },
    }),
  ]);
}

/**
 * Compute the (informational) discount preview in cents off a base price.
 * Used by the public /apply endpoint so the frontend can show the user
 * the discounted amount before they commit. Stripe still re-applies the
 * coupon authoritatively on its side.
 */
export function previewDiscount(promo: PromoCode, basePriceCents: number): {
  discountCents: number;
  finalCents: number;
} {
  let discountCents = 0;
  if (promo.discountType === 'PERCENT_OFF' && promo.percentOff) {
    discountCents = Math.round((basePriceCents * promo.percentOff) / 100);
  } else if (promo.discountType === 'AMOUNT_OFF' && promo.amountOffCents) {
    discountCents = Math.min(promo.amountOffCents, basePriceCents);
  }
  return { discountCents, finalCents: Math.max(0, basePriceCents - discountCents) };
}
