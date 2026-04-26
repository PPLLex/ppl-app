/**
 * Two-factor auth routes (#141 / PREMIUM_AUDIT S6).
 *
 * Flow for setup (admin or any user opting in):
 *   1. POST /api/auth/2fa/setup  → returns { secret, otpauthUrl }
 *      (also stashes secret on the user row but does NOT enable yet —
 *       that requires a verification round-trip)
 *   2. POST /api/auth/2fa/enable { code }  → verify the first TOTP code
 *      against the pending secret, flip enabledAt + return recovery codes
 *      ONCE (the only time plaintext recovery codes are ever shown).
 *   3. POST /api/auth/2fa/disable { password, code }  → require password
 *      AND a current TOTP code (or recovery code) to turn 2FA off.
 *   4. POST /api/auth/2fa/recovery-codes/regenerate { code }  → mint a
 *      fresh batch, invalidating the old. Requires a current TOTP code.
 *
 * Login bridge (used by /api/auth/login when the user has 2FA on):
 *   POST /api/auth/login/2fa-verify { challenge, code }
 *     - challenge: the one-time token returned by /auth/login
 *     - code: a 6-digit TOTP OR a XXXXX-XXXXX recovery code
 *
 * Every state change writes an AuditLog row (`auth.2fa.*`).
 */

import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import qrcode from 'qrcode';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate, generateToken, JwtPayload } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimit';
import { createAuditLog } from '../services/auditService';
import {
  generateTotpSecret,
  buildOtpauthUrl,
  verifyTotpCode,
  generateRecoveryCodes,
  verifyRecoveryCode,
} from '../services/twoFactorService';

const router = Router();

// ============================================================
// GET /api/auth/2fa/status
// Quick "is 2FA on for me?" lookup — used by the security page in /profile
// to decide whether to show the enrollment CTA or the disable button.
// ============================================================

router.get('/2fa/status', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        twoFactorEnabledAt: true,
        twoFactorRecoveryCodes: true,
      },
    });
    if (!user) throw ApiError.notFound('User not found');

    res.json({
      success: true,
      data: {
        enabled: !!user.twoFactorEnabledAt,
        enabledAt: user.twoFactorEnabledAt,
        recoveryCodesRemaining: user.twoFactorRecoveryCodes.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/auth/2fa/setup
// Generate a fresh TOTP secret + QR code, stash on the user row as
// "pending" (twoFactorSecret set, twoFactorEnabledAt still null). The
// frontend renders the QR + the manual-entry secret string.
//
// Calling this twice cycles the pending secret — useful if the user
// closes the page without enrolling and starts over.
// ============================================================

router.post('/2fa/setup', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, email: true, twoFactorEnabledAt: true },
    });
    if (!user) throw ApiError.notFound('User not found');

    if (user.twoFactorEnabledAt) {
      throw ApiError.badRequest(
        'Two-factor is already enabled. Disable it first if you need to re-enroll.'
      );
    }

    const secret = generateTotpSecret();
    const otpauthUrl = buildOtpauthUrl(secret, user.email);
    const qrDataUrl = await qrcode.toDataURL(otpauthUrl, {
      width: 240,
      margin: 1,
      color: { dark: '#0A0A0A', light: '#FFFFFF' },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: secret },
    });

    res.json({
      success: true,
      data: { secret, otpauthUrl, qrDataUrl },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/auth/2fa/enable  { code }
// Verify the user's first TOTP code against the pending secret and flip
// `twoFactorEnabledAt`. Generates + returns 10 recovery codes — these
// are shown ONCE on the success screen and never exposed again.
// ============================================================

router.post('/2fa/enable', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code } = req.body as { code?: string };
    if (!code) throw ApiError.badRequest('A 6-digit verification code is required');

    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, twoFactorSecret: true, twoFactorEnabledAt: true },
    });
    if (!user) throw ApiError.notFound('User not found');

    if (user.twoFactorEnabledAt) {
      throw ApiError.badRequest('Two-factor is already enabled.');
    }
    if (!user.twoFactorSecret) {
      throw ApiError.badRequest('Start enrollment first by calling /api/auth/2fa/setup.');
    }

    if (!verifyTotpCode(user.twoFactorSecret, code)) {
      throw ApiError.unauthorized('Invalid verification code. Try again.');
    }

    const { plaintext, hashes } = await generateRecoveryCodes();

    await prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorEnabledAt: new Date(),
        twoFactorRecoveryCodes: hashes,
      },
    });

    void createAuditLog({
      userId: user.id,
      action: 'auth.2fa.enabled',
      resourceType: 'User',
      resourceId: user.id,
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      data: {
        enabled: true,
        // First-and-only-time plaintext display. The frontend MUST surface
        // a "save these somewhere safe" UX with download / copy actions.
        recoveryCodes: plaintext,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/auth/2fa/disable  { password, code }
// Disable 2FA. Requires BOTH the user's current password AND a current
// TOTP code (or a recovery code) — we never let a hijacked session turn
// 2FA off. The recovery code path is intentional: a user who lost their
// device should be able to use a recovery code to disable + re-enroll.
// ============================================================

router.post('/2fa/disable', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { password, code } = req.body as { password?: string; code?: string };
    if (!password || !code) {
      throw ApiError.badRequest('Password and a 2FA code (or recovery code) are required.');
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        passwordHash: true,
        twoFactorSecret: true,
        twoFactorEnabledAt: true,
        twoFactorRecoveryCodes: true,
      },
    });
    if (!user) throw ApiError.notFound('User not found');
    if (!user.twoFactorEnabledAt) {
      throw ApiError.badRequest('Two-factor is not currently enabled on this account.');
    }
    if (!user.passwordHash) {
      throw ApiError.badRequest(
        'OAuth-only accounts cannot disable 2FA via password. Contact support.'
      );
    }

    const passwordOk = await bcrypt.compare(password, user.passwordHash);
    if (!passwordOk) throw ApiError.unauthorized('Incorrect password.');

    let codeOk = false;
    if (user.twoFactorSecret && verifyTotpCode(user.twoFactorSecret, code)) {
      codeOk = true;
    } else {
      const idx = await verifyRecoveryCode(code, user.twoFactorRecoveryCodes);
      if (idx >= 0) codeOk = true;
    }
    if (!codeOk) throw ApiError.unauthorized('Invalid 2FA code.');

    await prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorSecret: null,
        twoFactorEnabledAt: null,
        twoFactorRecoveryCodes: [],
        twoFactorPendingChallenge: null,
        twoFactorChallengeExpiresAt: null,
      },
    });

    void createAuditLog({
      userId: user.id,
      action: 'auth.2fa.disabled',
      resourceType: 'User',
      resourceId: user.id,
      ipAddress: req.ip,
    });

    res.json({ success: true, data: { enabled: false } });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/auth/2fa/recovery-codes/regenerate  { code }
// Mint a fresh batch of 10 recovery codes, invalidating the prior set.
// Requires a current TOTP code so a hijacked session can't silently
// rotate the recovery codes out from under the real owner.
// ============================================================

router.post(
  '/2fa/recovery-codes/regenerate',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { code } = req.body as { code?: string };
      if (!code) throw ApiError.badRequest('Current 2FA code is required.');

      const user = await prisma.user.findUnique({
        where: { id: req.user!.userId },
        select: { id: true, twoFactorSecret: true, twoFactorEnabledAt: true },
      });
      if (!user) throw ApiError.notFound('User not found');
      if (!user.twoFactorEnabledAt || !user.twoFactorSecret) {
        throw ApiError.badRequest('Two-factor is not enabled on this account.');
      }

      if (!verifyTotpCode(user.twoFactorSecret, code)) {
        throw ApiError.unauthorized('Invalid verification code.');
      }

      const { plaintext, hashes } = await generateRecoveryCodes();
      await prisma.user.update({
        where: { id: user.id },
        data: { twoFactorRecoveryCodes: hashes },
      });

      void createAuditLog({
        userId: user.id,
        action: 'auth.2fa.recovery_codes_regenerated',
        resourceType: 'User',
        resourceId: user.id,
        ipAddress: req.ip,
      });

      res.json({ success: true, data: { recoveryCodes: plaintext } });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================
// POST /api/auth/login/2fa-verify  { challenge, code }
// Step 2 of two-factor login. Trade the one-time challenge token + a
// valid TOTP/recovery code for a real JWT. Used after /auth/login
// returns `{ twoFactorRequired: true, challenge }`.
//
// Rate-limited via authLimiter so a leaked challenge can't be brute-forced
// in the 15 minutes before it expires.
// ============================================================

router.post(
  '/login/2fa-verify',
  authLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { challenge, code } = req.body as { challenge?: string; code?: string };
      if (!challenge || !code) {
        throw ApiError.badRequest('Challenge token and verification code are required.');
      }

      const user = await prisma.user.findUnique({
        where: { twoFactorPendingChallenge: challenge },
        include: {
          homeLocation: { select: { id: true, name: true } },
          clientProfile: { select: { ageGroup: true } },
        },
      });

      if (
        !user ||
        !user.twoFactorChallengeExpiresAt ||
        user.twoFactorChallengeExpiresAt < new Date()
      ) {
        throw ApiError.unauthorized('Challenge expired. Please log in again.');
      }
      if (!user.isActive) {
        throw ApiError.unauthorized('Account is deactivated. Please contact PPL.');
      }
      if (!user.twoFactorEnabledAt || !user.twoFactorSecret) {
        // Defensive: shouldn't happen, but if 2FA was disabled mid-flow
        // we don't want to hand out a JWT against a stale challenge.
        throw ApiError.unauthorized('Two-factor is no longer enabled on this account.');
      }

      // Try TOTP first, then fall back to recovery codes.
      let codeOk = false;
      let usedRecoveryCode = false;
      let updatedRecoveryCodes: string[] | null = null;

      if (verifyTotpCode(user.twoFactorSecret, code)) {
        codeOk = true;
      } else {
        const idx = await verifyRecoveryCode(code, user.twoFactorRecoveryCodes);
        if (idx >= 0) {
          codeOk = true;
          usedRecoveryCode = true;
          updatedRecoveryCodes = user.twoFactorRecoveryCodes.filter((_, i) => i !== idx);
        }
      }

      if (!codeOk) {
        throw ApiError.unauthorized('Invalid verification code.');
      }

      await prisma.user.update({
        where: { id: user.id },
        data: {
          twoFactorPendingChallenge: null,
          twoFactorChallengeExpiresAt: null,
          ...(updatedRecoveryCodes ? { twoFactorRecoveryCodes: updatedRecoveryCodes } : {}),
          // A successful login also clears any failed-login lockout state
          // (matches the password login handler).
          failedLoginCount: 0,
          failedLoginResetAt: null,
          lockedUntil: null,
        },
      });

      void createAuditLog({
        userId: user.id,
        action: usedRecoveryCode
          ? 'auth.2fa.login_with_recovery_code'
          : 'auth.2fa.login_success',
        resourceType: 'User',
        resourceId: user.id,
        ipAddress: req.ip,
        changes: usedRecoveryCode
          ? { recoveryCodesRemaining: updatedRecoveryCodes?.length ?? 0 }
          : undefined,
      });

      const tokenPayload: JwtPayload = {
        userId: user.id,
        email: user.email,
        role: user.role,
        homeLocationId: user.homeLocationId,
      };
      const token = generateToken(tokenPayload);

      res.json({
        success: true,
        data: {
          token,
          user: {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            phone: user.phone,
            role: user.role,
            homeLocation: user.homeLocation,
            ageGroup: user.clientProfile?.ageGroup ?? null,
            avatarUrl: user.avatarUrl ?? null,
          },
          // Tell the UI to nudge the user to print fresh codes if they're
          // running low. 3 is an arbitrary "you should care" threshold.
          recoveryCodesLow:
            usedRecoveryCode && (updatedRecoveryCodes?.length ?? 0) <= 3,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
