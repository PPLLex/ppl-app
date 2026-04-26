/**
 * Two-factor authentication helpers (TOTP + recovery codes).
 *
 * Algorithm: TOTP per RFC 6238, 30-second window, 6-digit codes.
 * Implementation: `otplib` (battle-tested, no Speakeasy hash bug).
 *
 * Recovery codes: 10 random 10-character codes, hashed at-rest with bcrypt
 * (cost 10 — they're already 50 bits of entropy so cost-12 is overkill and
 * makes verifying a recovery code on login painfully slow). Each one is
 * one-shot — verifying consumes it.
 *
 * Pending challenge: when a user with 2FA enabled posts /auth/login, we
 * stash a one-time random token in `User.twoFactorPendingChallenge` (15 min
 * expiry) and return it instead of a JWT. The frontend then posts that
 * token + the TOTP code (or a recovery code) to /auth/login/2fa-verify
 * to complete the login.
 *
 * Design choice: storing the secret + recovery code hashes on the User row
 * (instead of a separate TwoFactorSecret model) keeps every query simple
 * and avoids a join on the hot login path. There's exactly one TOTP
 * secret per user, so a 1:1 model would just be ceremony.
 */

import { generateSecret, generateURI, verifySync } from 'otplib';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';

const ISSUER = 'Pitching Performance Lab';

// 30-second period, 6 digits, 1-step tolerance on each side (so a code is
// valid for the previous, current, and next 30-second window). This is the
// standard Google-Authenticator-compatible setup.
const PERIOD_SECONDS = 30;
const TOLERANCE_STEPS: [number, number] = [1, 1];

/**
 * Generate a fresh base32 TOTP secret. This is what gets QR-encoded and
 * shown to the user during enrollment.
 */
export function generateTotpSecret(): string {
  return generateSecret();
}

/**
 * Build the otpauth:// URL that the QR code encodes. Standard format —
 * Google Authenticator, 1Password, Authy all parse this identically.
 */
export function buildOtpauthUrl(secret: string, accountEmail: string): string {
  return generateURI({
    strategy: 'totp',
    issuer: ISSUER,
    label: accountEmail,
    secret,
    period: PERIOD_SECONDS,
    digits: 6,
  });
}

/**
 * Verify a 6-digit TOTP code against the user's secret.
 * Returns true if valid, false if not. NEVER throws on a bad code — let
 * the caller decide how to message the failure.
 */
export function verifyTotpCode(secret: string, code: string): boolean {
  const cleaned = code.replace(/\s+/g, '').trim();
  if (!/^\d{6}$/.test(cleaned)) return false;
  try {
    const result = verifySync({
      secret,
      token: cleaned,
      epochTolerance: [TOLERANCE_STEPS[0] * PERIOD_SECONDS, TOLERANCE_STEPS[1] * PERIOD_SECONDS],
    });
    return result.valid;
  } catch {
    return false;
  }
}

/**
 * Generate a fresh batch of 10 human-readable recovery codes.
 * Format: XXXXX-XXXXX (uppercase alphanumeric, no ambiguous chars).
 * Returns the plaintext for one-time display + the bcrypt hashes for storage.
 */
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // skip 0/O/1/I

export async function generateRecoveryCodes(): Promise<{
  plaintext: string[];
  hashes: string[];
}> {
  const plaintext: string[] = [];
  for (let i = 0; i < 10; i++) {
    const buf = randomBytes(10);
    let code = '';
    for (let j = 0; j < 10; j++) {
      code += RECOVERY_ALPHABET[buf[j] % RECOVERY_ALPHABET.length];
    }
    plaintext.push(`${code.slice(0, 5)}-${code.slice(5)}`);
  }
  const hashes = await Promise.all(plaintext.map((c) => bcrypt.hash(c, 10)));
  return { plaintext, hashes };
}

/**
 * Verify a candidate recovery code against the stored hashes.
 * Returns the index of the matching hash (so the caller can splice it out
 * of the array) or -1 if no match.
 */
export async function verifyRecoveryCode(
  candidate: string,
  hashes: string[]
): Promise<number> {
  const cleaned = candidate.replace(/\s+/g, '').toUpperCase().trim();
  if (!/^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(cleaned)) return -1;
  for (let i = 0; i < hashes.length; i++) {
    // Sequential, not parallel — bcrypt is intentionally slow and we want
    // to short-circuit on the first match. 10 hashes × ~100ms each is the
    // worst case, which is fine for a one-time recovery flow.
    // eslint-disable-next-line no-await-in-loop
    if (await bcrypt.compare(cleaned, hashes[i])) return i;
  }
  return -1;
}

/**
 * Generate a one-time challenge token used to bridge step-1 (password
 * verified) to step-2 (TOTP verified) of a two-factor login. Lives 15 min.
 */
export function generatePendingChallenge(): { token: string; expiresAt: Date } {
  return {
    token: randomBytes(24).toString('hex'),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  };
}
