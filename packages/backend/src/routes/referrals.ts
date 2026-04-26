/**
 * Referral routes (#134).
 *
 *   GET  /api/referrals/me                       My code + my referrals + statuses
 *   POST /api/referrals/validate                 Public — { code } → { valid, referrerName? }
 *
 * Reward issuance happens inside the Stripe webhook (payment.succeeded);
 * see services/referralService.awardReferralIfPending.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate } from '../middleware/auth';
import {
  getOrCreateReferralCode,
  findReferrerByCode,
} from '../services/referralService';

const router = Router();

/**
 * Public — used by the registration page to confirm a code is valid
 * before the user submits. Doesn't return the referrer's email.
 */
router.post('/validate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code } = req.body as { code?: string };
    if (!code || typeof code !== 'string') throw ApiError.badRequest('code required');
    const referrer = await findReferrerByCode(code);
    if (!referrer) {
      res.json({ success: true, data: { valid: false } });
      return;
    }
    res.json({
      success: true,
      data: { valid: true, referrerFirstName: (referrer.fullName || '').split(' ')[0] || 'A friend' },
    });
  } catch (err) {
    next(err);
  }
});

router.use(authenticate);

router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw ApiError.unauthorized('login required');

    const code = await getOrCreateReferralCode(userId);
    const referrals = await prisma.referral.findMany({
      where: { referrerId: userId },
      orderBy: { registeredAt: 'desc' },
      take: 50,
      include: {
        referee: { select: { id: true, fullName: true, email: true } },
      },
    });

    const summary = {
      total: referrals.length,
      pending: referrals.filter((r) => r.status === 'PENDING').length,
      rewarded: referrals.filter((r) => r.status === 'REWARDED').length,
      expired: referrals.filter((r) => r.status === 'EXPIRED').length,
    };

    const wasReferred = await prisma.referral.findUnique({
      where: { refereeId: userId },
      include: { referrer: { select: { fullName: true } } },
    });

    const baseUrl = process.env.FRONTEND_URL || 'https://app.pitchingperformancelab.com';

    res.json({
      success: true,
      data: {
        code,
        shareUrl: `${baseUrl}/register?ref=${encodeURIComponent(code)}`,
        summary,
        referrals: referrals.map((r) => ({
          id: r.id,
          status: r.status,
          registeredAt: r.registeredAt,
          rewardedAt: r.rewardedAt,
          expiresAt: r.expiresAt,
          refereeName: r.referee.fullName,
        })),
        referredBy: wasReferred
          ? {
              status: wasReferred.status,
              referrerName: wasReferred.referrer.fullName,
              registeredAt: wasReferred.registeredAt,
              rewardedAt: wasReferred.rewardedAt,
            }
          : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
