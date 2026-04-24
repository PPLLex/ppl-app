import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { sendEmail, buildPPLEmail } from '../services/emailService';
import { sensitiveLimiter } from '../middleware/rateLimit';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const router = Router();

/**
 * Hash the raw token with SHA-256 before it ever touches the DB.
 * A DB leak (backup, read-only access) can't be turned into live reset
 * links because the hash is one-way. Only the email the user already
 * received contains the raw token.
 */
function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p: any = prisma;

/**
 * POST /api/auth/forgot-password
 * Send a password reset email.
 *
 * Rate-limited (5/hr/IP) to block attackers who'd spam reset emails at
 * a target's inbox OR try to enumerate accounts by timing responses.
 * Handler also silently accepts unknown emails so the response shape
 * never leaks account existence.
 */
router.post('/forgot-password', sensitiveLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body;
    if (!email) throw ApiError.badRequest('Email is required');

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true, email: true, fullName: true },
    });

    // Always return success to prevent email enumeration
    if (!user) {
      res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
      return;
    }

    // Generate a cryptographically random 32-byte token, email the raw
    // hex, store only the SHA-256 hash. Expires in 1 hour.
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await p.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    // Opportunistic sweep of expired/used rows (cheap — indexed).
    // A dedicated cron could do the same; this keeps the table small
    // without a separate job.
    await p.passwordResetToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { usedAt: { not: null } },
        ],
      },
    });

    // In production, this URL would point to the deployed frontend
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${token}`;

    const emailBody = `
      <p>Hi ${user.fullName.split(' ')[0]},</p>
      <p>We received a request to reset your password. Click the link below to set a new password:</p>
      <p style="text-align: center; margin: 24px 0;">
        <a href="${resetUrl}" style="display: inline-block; padding: 12px 32px; background: #4D7A2A; color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">
          Reset Password
        </a>
      </p>
      <p style="color: #888; font-size: 13px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
    `;

    await sendEmail({
      to: user.email,
      subject: 'Reset Your PPL Password',
      text: `Reset your password: ${resetUrl}`,
      html: buildPPLEmail('Password Reset', emailBody),
    });

    res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/reset-password
 * Reset password using a token.
 */
router.post('/reset-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      throw ApiError.badRequest('Token and new password are required');
    }
    if (newPassword.length < 8) {
      throw ApiError.badRequest('Password must be at least 8 characters');
    }

    const tokenHash = hashToken(token);
    const resetRow = await p.passwordResetToken.findUnique({
      where: { tokenHash },
    });
    if (!resetRow) throw ApiError.badRequest('Invalid or expired reset token');
    if (resetRow.usedAt) throw ApiError.badRequest('This reset link has already been used');
    if (resetRow.expiresAt < new Date()) {
      await p.passwordResetToken.delete({ where: { id: resetRow.id } });
      throw ApiError.badRequest('Reset token has expired');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Atomically set the new password + mark the token used so a race
    // condition can't let the same token reset two passwords.
    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetRow.userId },
        data: { passwordHash },
      }),
      p.passwordResetToken.update({
        where: { id: resetRow.id },
        data: { usedAt: new Date() },
      }),
    ]);

    res.json({ success: true, message: 'Password has been reset. You can now log in.' });
  } catch (error) {
    next(error);
  }
});

export default router;
