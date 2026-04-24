import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { sendEmail, buildPPLEmail } from '../services/emailService';
import { sensitiveLimiter } from '../middleware/rateLimit';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const router = Router();

// In-memory token store for dev. In production, use Redis or a DB table.
const resetTokens = new Map<string, { userId: string; expiresAt: Date }>();

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

    // Generate token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    resetTokens.set(token, { userId: user.id, expiresAt });

    // Clean up expired tokens
    for (const [key, val] of resetTokens.entries()) {
      if (val.expiresAt < new Date()) resetTokens.delete(key);
    }

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

    const resetData = resetTokens.get(token);
    if (!resetData) throw ApiError.badRequest('Invalid or expired reset token');
    if (resetData.expiresAt < new Date()) {
      resetTokens.delete(token);
      throw ApiError.badRequest('Reset token has expired');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
      where: { id: resetData.userId },
      data: { passwordHash },
    });

    // Consume the token
    resetTokens.delete(token);

    res.json({ success: true, message: 'Password has been reset. You can now log in.' });
  } catch (error) {
    next(error);
  }
});

export default router;
