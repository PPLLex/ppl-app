/**
 * Email verification routes (#142 / PREMIUM_AUDIT S4).
 *
 *   POST /api/auth/email/verify           { token }   — public
 *   POST /api/auth/email/resend                       — authed
 *   GET  /api/auth/email/verification-status          — authed
 *
 * Resend is rate-limited via sensitiveLimiter (5/hr/IP) so a malicious
 * actor can't fan out verification emails to harass a target inbox.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/apiError';
import { authenticate } from '../middleware/auth';
import { sensitiveLimiter } from '../middleware/rateLimit';
import { prisma } from '../utils/prisma';
import {
  sendVerificationEmail,
  consumeVerificationToken,
} from '../services/emailVerificationService';
import { createAuditLog } from '../services/auditService';

const router = Router();

// ============================================================
// POST /api/auth/email/verify  { token }
// Public — clicked from the email link, the frontend calls this on the
// /auth/verify-email page with the token from the query string.
// ============================================================

router.post('/email/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.body as { token?: string };
    if (!token) throw ApiError.badRequest('Verification token is required');

    const user = await consumeVerificationToken(token);
    if (!user) {
      throw ApiError.badRequest(
        'This verification link is invalid or has expired. Request a new one from your account.'
      );
    }

    void createAuditLog({
      userId: user.id,
      action: 'auth.email.verified',
      resourceType: 'User',
      resourceId: user.id,
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      data: { verified: true, email: user.email },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/auth/email/resend
// Authenticated. Always returns success even if already verified — prevents
// a hijacked session from probing verification state via differential
// responses.
// ============================================================

router.post(
  '/email/resend',
  sensitiveLimiter,
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      void (await sendVerificationEmail(req.user!.userId));
      res.json({
        success: true,
        data: { message: 'If your account needs verification, a new link is on its way.' },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================
// GET /api/auth/email/verification-status
// Authenticated lookup — used by a /profile banner / dashboard nudge.
// ============================================================

router.get(
  '/email/verification-status',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.userId },
        select: { emailVerifiedAt: true, email: true },
      });
      if (!user) throw ApiError.notFound('User not found');

      res.json({
        success: true,
        data: {
          verified: !!user.emailVerifiedAt,
          verifiedAt: user.emailVerifiedAt,
          email: user.email,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
