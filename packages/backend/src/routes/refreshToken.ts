/**
 * Refresh-token endpoints (#S9).
 *
 *   POST /api/auth/refresh   { refreshToken }  — public, rotates pair
 *   POST /api/auth/logout    { refreshToken? } — public, revokes one
 *   POST /api/auth/logout-all                  — authed, revokes ALL
 *
 * Refresh is rate-limited via authLimiter (same window as /login) so
 * a leaked-token attacker can't stuff this endpoint either.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate, generateToken, JwtPayload } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimit';
import {
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokensForUser,
} from '../services/refreshTokenService';
import { createAuditLog } from '../services/auditService';

const router = Router();

// ============================================================
// POST /api/auth/refresh  { refreshToken }
// Rotate the supplied refresh token; respond with a fresh access JWT
// AND a fresh refresh token. Old refresh token is consumed.
// ============================================================

router.post(
  '/refresh',
  authLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { refreshToken } = req.body as { refreshToken?: string };
      if (!refreshToken || typeof refreshToken !== 'string') {
        throw ApiError.badRequest('refreshToken is required');
      }

      const result = await rotateRefreshToken({
        presentedToken: refreshToken,
        userAgent: req.get('user-agent') ?? null,
        ipAddress: req.ip,
      });

      if (!result.ok) {
        // 'replayed' specifically means we just nuked all of this user's
        // tokens because someone tried to reuse a consumed token. The
        // frontend treats this the same as 'invalid' (force re-login).
        if (result.reason === 'replayed') {
          void createAuditLog({
            action: 'auth.refresh.replayed',
            resourceType: 'RefreshToken',
            ipAddress: req.ip,
            changes: { reason: 'token_replayed_all_revoked' },
          });
        }
        throw ApiError.unauthorized('Session expired. Please sign in again.');
      }

      // Look up fresh user payload — role / location may have changed
      // since the refresh token was first issued.
      const user = await prisma.user.findUnique({
        where: { id: result.userId },
        select: {
          id: true,
          email: true,
          role: true,
          homeLocationId: true,
          isActive: true,
        },
      });
      if (!user || !user.isActive) {
        throw ApiError.unauthorized('Account is no longer active.');
      }

      const accessTokenPayload: JwtPayload = {
        userId: user.id,
        email: user.email,
        role: user.role,
        homeLocationId: user.homeLocationId,
      };
      const accessToken = generateToken(accessTokenPayload);

      res.json({
        success: true,
        data: {
          token: accessToken,
          refreshToken: result.token,
          refreshExpiresAt: result.expiresAt,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================
// POST /api/auth/logout  { refreshToken? }
// Revoke a single refresh token (this device). Public — no auth needed
// because logout should work even with an expired access JWT.
// ============================================================

router.post('/logout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (refreshToken && typeof refreshToken === 'string') {
      await revokeRefreshToken(refreshToken);
    }
    res.json({ success: true, data: { ok: true } });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/auth/logout-all
// Authed. Revoke EVERY refresh token for the calling user (logout from
// every device). Useful after suspected compromise.
// ============================================================

router.post(
  '/logout-all',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const count = await revokeAllRefreshTokensForUser(req.user!.userId);
      void createAuditLog({
        userId: req.user!.userId,
        action: 'auth.logout_all',
        resourceType: 'User',
        resourceId: req.user!.userId,
        ipAddress: req.ip,
        changes: { revokedCount: count },
      });
      res.json({ success: true, data: { revokedCount: count } });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
