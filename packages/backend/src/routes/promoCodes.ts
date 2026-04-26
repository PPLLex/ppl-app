/**
 * Promo code routes (#138 / PREMIUM_AUDIT).
 *
 * Admin (authed + requireAdmin):
 *   GET    /api/promo-codes               — list
 *   POST   /api/promo-codes               — create + mirror to Stripe
 *   PATCH  /api/promo-codes/:id           — update label / archive (isActive flip)
 *   GET    /api/promo-codes/:id/redemptions — recent redemptions report
 *
 * Public:
 *   GET    /api/promo-codes/lookup?code=&planId=
 *     Validate a code and (optionally) preview the discount against a plan.
 *     Public so /register?promo=CODE can show the discounted price before
 *     the user has even created their account.
 *
 * The Stripe-side effects are intentionally one-way: creating a promo
 * mirrors to Stripe; archiving toggles isActive locally and DELETES the
 * Stripe coupon (Stripe coupons referenced by past subscriptions stay
 * functional after deletion). Editing the discount of a coupon isn't
 * supported by Stripe — admins must archive + re-create.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate, requireAdmin } from '../middleware/auth';
import { Role, PromoCodeDiscountType, PromoCodeDuration } from '@prisma/client';
import {
  validatePromoCodeInput,
  createStripeCoupon,
  lookupRedeemablePromoCode,
  previewDiscount,
  normalizeCode,
} from '../services/promoCodeService';
import { stripe } from '../services/stripeService';
import { createAuditLog } from '../services/auditService';

const router = Router();

// ============================================================
// GET /api/promo-codes/lookup?code=...&planId=...
// PUBLIC. Validates a code and (optionally) previews the discount against
// a specific plan's price. Used by the registration flow when the user
// arrives at /register?promo=CODE.
// ============================================================

router.get('/lookup', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = String(req.query.code || '').trim();
    const planId = req.query.planId ? String(req.query.planId) : null;
    if (!code) throw ApiError.badRequest('code is required');

    const result = await lookupRedeemablePromoCode(code);
    if (!result.ok) {
      // Translate the structured reason into a user-readable message.
      const message =
        result.reason === 'not_found' ? 'That code isn’t valid.' :
        result.reason === 'inactive' ? 'That code is no longer active.' :
        result.reason === 'expired' ? 'That code has expired.' :
        result.reason === 'maxed' ? 'That code has reached its redemption limit.' :
        'That code is not redeemable.';
      // Note: 200 with valid:false rather than 4xx so the public form can
      // distinguish "real network error" from "code didn't validate".
      res.json({ success: true, data: { valid: false, reason: result.reason, message } });
      return;
    }

    let discount = null as null | { basePriceCents: number; discountCents: number; finalCents: number };
    if (planId) {
      const plan = await prisma.membershipPlan.findUnique({
        where: { id: planId },
        select: { priceCents: true, name: true },
      });
      if (plan) {
        const { discountCents, finalCents } = previewDiscount(result.promo, plan.priceCents);
        discount = {
          basePriceCents: plan.priceCents,
          discountCents,
          finalCents,
        };
      }
    }

    res.json({
      success: true,
      data: {
        valid: true,
        code: result.promo.code,
        label: result.promo.label,
        discountType: result.promo.discountType,
        percentOff: result.promo.percentOff,
        amountOffCents: result.promo.amountOffCents,
        duration: result.promo.duration,
        durationInMonths: result.promo.durationInMonths,
        expiresAt: result.promo.expiresAt,
        discount,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/promo-codes  (admin)
// ============================================================

router.get(
  '/',
  authenticate,
  requireAdmin,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const promos = await prisma.promoCode.findMany({
        orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
        include: {
          createdBy: { select: { id: true, fullName: true, email: true } },
          _count: { select: { redemptions: true } },
        },
      });
      res.json({ success: true, data: promos });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================
// POST /api/promo-codes  (admin)
// ============================================================

router.post(
  '/',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as {
        code?: string;
        label?: string;
        discountType?: PromoCodeDiscountType;
        percentOff?: number | null;
        amountOffCents?: number | null;
        duration?: PromoCodeDuration;
        durationInMonths?: number | null;
        maxRedemptions?: number | null;
        expiresAt?: string | null;
      };

      const input = {
        code: normalizeCode(body.code || ''),
        label: (body.label || '').trim(),
        discountType: body.discountType!,
        percentOff: body.percentOff ?? null,
        amountOffCents: body.amountOffCents ?? null,
        duration: body.duration!,
        durationInMonths: body.durationInMonths ?? null,
        maxRedemptions: body.maxRedemptions ?? null,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      };

      try {
        validatePromoCodeInput(input);
      } catch (e: unknown) {
        throw ApiError.badRequest(e instanceof Error ? e.message : 'Invalid promo code input');
      }

      // Conflict check before we hit Stripe so we don't create an orphan
      // coupon there if the local row would fail.
      const existing = await prisma.promoCode.findUnique({
        where: { organizationId_code: { organizationId: 'ppl', code: input.code } },
      });
      if (existing) {
        throw ApiError.conflict('A promo code with that name already exists.');
      }

      // Mirror to Stripe first. If Stripe rejects, the local row never
      // gets written — there's no orphan to clean up.
      let stripeCouponId: string;
      try {
        stripeCouponId = await createStripeCoupon(input);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Stripe rejected the coupon';
        throw ApiError.badRequest(`Could not create coupon in Stripe: ${message}`);
      }

      const promo = await prisma.promoCode.create({
        data: {
          ...input,
          stripeCouponId,
          createdById: req.user!.userId,
        },
      });

      void createAuditLog({
        userId: req.user!.userId,
        action: 'promoCode.created',
        resourceType: 'PromoCode',
        resourceId: promo.id,
        changes: {
          code: promo.code,
          discountType: promo.discountType,
          percentOff: promo.percentOff,
          amountOffCents: promo.amountOffCents,
          duration: promo.duration,
        },
      });

      res.status(201).json({ success: true, data: promo });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================
// PATCH /api/promo-codes/:id  (admin)
// Limited mutability — Stripe doesn't allow editing coupon math, only the
// surrounding metadata. We expose: label edit + archive (isActive=false).
// ============================================================

router.patch(
  '/:id',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = String(req.params.id);
      const { label, isActive } = req.body as {
        label?: string;
        isActive?: boolean;
      };

      const promo = await prisma.promoCode.findUnique({ where: { id } });
      if (!promo) throw ApiError.notFound('Promo code not found');

      const data: { label?: string; isActive?: boolean } = {};
      if (typeof label === 'string' && label.trim()) data.label = label.trim();
      if (typeof isActive === 'boolean') data.isActive = isActive;

      // If we're archiving and there's a Stripe coupon, delete it on the
      // Stripe side too — Stripe will keep applying it to existing subs
      // but won't accept new redemptions.
      if (
        typeof isActive === 'boolean' &&
        isActive === false &&
        promo.isActive &&
        promo.stripeCouponId
      ) {
        try {
          await stripe.coupons.del(promo.stripeCouponId);
        } catch (e) {
          // Don't block the local archive on a Stripe API hiccup — log and
          // continue. The admin can re-archive later if it matters.
          console.error('[promoCodes] stripe.coupons.del failed:', e);
        }
      }

      const updated = await prisma.promoCode.update({
        where: { id },
        data,
      });

      void createAuditLog({
        userId: req.user!.userId,
        action: data.isActive === false ? 'promoCode.archived' : 'promoCode.updated',
        resourceType: 'PromoCode',
        resourceId: id,
        changes: data,
      });

      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================
// GET /api/promo-codes/:id/redemptions  (admin)
// ============================================================

router.get(
  '/:id/redemptions',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = String(req.params.id);
      const redemptions = await prisma.promoCodeRedemption.findMany({
        where: { promoCodeId: id },
        orderBy: { redeemedAt: 'desc' },
        take: 200,
        include: {
          user: { select: { id: true, fullName: true, email: true } },
          membership: { select: { id: true, planId: true, status: true } },
        },
      });
      res.json({ success: true, data: redemptions });
    } catch (err) {
      next(err);
    }
  }
);

// Suppress an unused-import warning when Role isn't referenced — we keep
// the import for parity with sibling admin routes, in case future logic
// wants to log on a per-role basis.
void Role;

export default router;
