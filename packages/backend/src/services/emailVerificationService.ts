/**
 * Email verification helpers (#142 / PREMIUM_AUDIT S4).
 *
 * Token semantics:
 *   - Random 32-byte hex string, single-use.
 *   - 24-hour expiry. Long enough to survive most spam-folder rescues but
 *     short enough that a leaked email-archive token can't be redeemed
 *     weeks later.
 *   - Stored unhashed on the User row — these tokens are equivalent to a
 *     password-reset link in sensitivity, and we already store password-
 *     reset tokens this way (see passwordReset.ts). Future hardening pass
 *     could hash both with sha256.
 *
 * Pre-verified accounts:
 *   - Admin-invited staff (StaffInvite.accept) — they came from a trusted
 *     admin who used their email; double-confirming is friction without
 *     security gain.
 *   - OAuth signups (Google / Apple) — the IdP already verified the email.
 *   - Magic-link signups — by definition the user proved control of the
 *     inbox to receive the link.
 */

import { randomBytes } from 'crypto';
import { prisma } from '../utils/prisma';
import { sendEmail, buildPPLEmail } from './emailService';
import { config } from '../config';

const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export function generateVerificationToken(): { token: string; expiresAt: Date } {
  return {
    token: randomBytes(32).toString('hex'),
    expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
  };
}

/**
 * Issue a fresh verification token for a user and send the email.
 * Idempotent — calling twice rotates the token (the previous one becomes
 * invalid). Safe to call from /resend endpoints.
 *
 * Returns true if the email was queued. Never throws on bad email — the
 * caller should pretend success in user-facing responses to avoid email
 * enumeration.
 */
export async function sendVerificationEmail(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, fullName: true, emailVerifiedAt: true },
  });
  if (!user) return false;
  if (user.emailVerifiedAt) return false; // Already verified — no-op.

  const { token, expiresAt } = generateVerificationToken();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerificationToken: token,
      emailVerificationTokenExpiry: expiresAt,
    },
  });

  const verifyUrl = `${config.frontendUrl}/auth/verify-email?token=${token}`;
  const firstName = (user.fullName || '').split(/\s+/)[0] || 'there';

  const html = buildPPLEmail(
    'Verify Your Email',
    `
      <p style="margin:0 0 16px;">Hi ${firstName},</p>
      <p style="margin:0 0 16px;">
        One quick step to finish setting up your Pitching Performance Lab
        account: confirm your email address. Click the button below to
        verify.
      </p>
      <div style="text-align:center;margin:28px 0;">
        <a href="${verifyUrl}"
           style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#95c83c,#7fa829);color:#0a0a0a;text-decoration:none;border-radius:8px;font-weight:700;letter-spacing:0.04em;">
          Verify Email
        </a>
      </div>
      <p style="margin:0 0 16px;color:#666;font-size:13px;">
        This link expires in 24 hours. If the button doesn&apos;t open in
        your browser, paste this URL: <br>
        <span style="color:#95c83c;word-break:break-all;">${verifyUrl}</span>
      </p>
      <p style="margin:0 0 0;color:#666;font-size:13px;">
        Didn&apos;t request this? You can safely ignore this email.
      </p>
    `,
    { preheader: 'Verify your PPL email to finish signing up.' }
  );

  await sendEmail({
    to: user.email,
    subject: 'Verify your PPL email',
    text:
      `Hi ${firstName},\n\n` +
      `Click this link to verify your Pitching Performance Lab email address ` +
      `(expires in 24 hours):\n\n${verifyUrl}\n\n` +
      `Didn't request this? You can ignore this email.`,
    html,
  });

  return true;
}

/**
 * Consume a verification token. Returns the verified user on success, or
 * null if the token is unknown / expired. Single-use — the token row is
 * cleared after a successful verification.
 */
export async function consumeVerificationToken(token: string) {
  const user = await prisma.user.findUnique({
    where: { emailVerificationToken: token },
    select: {
      id: true,
      email: true,
      emailVerifiedAt: true,
      emailVerificationTokenExpiry: true,
    },
  });
  if (!user) return null;
  if (
    !user.emailVerificationTokenExpiry ||
    user.emailVerificationTokenExpiry < new Date()
  ) {
    // Clear the stale token so future checks short-circuit.
    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationToken: null,
        emailVerificationTokenExpiry: null,
      },
    });
    return null;
  }

  // Already-verified users hitting the link again: clear the token but
  // don't overwrite emailVerifiedAt. Treat as success.
  if (user.emailVerifiedAt) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationToken: null,
        emailVerificationTokenExpiry: null,
      },
    });
    return user;
  }

  return prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerifiedAt: new Date(),
      emailVerificationToken: null,
      emailVerificationTokenExpiry: null,
    },
  });
}
