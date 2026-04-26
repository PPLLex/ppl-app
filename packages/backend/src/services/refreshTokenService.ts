/**
 * Refresh-token issuance, rotation, and revocation (#S9).
 *
 * Pattern: short-lived access JWT (15 min) + long-lived opaque refresh
 * token (14 days). Refresh is single-use — every successful refresh
 * rotates to a new pair and consumes the old. If the same refresh token
 * is replayed after consumption, we revoke ALL of that user's refresh
 * tokens (presumed theft).
 *
 * Storage: SHA-256 of the token hex. Plaintext lives only in the
 * response body the moment it's issued; we never log it.
 */

import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { prisma } from '../utils/prisma';

const REFRESH_BYTES = 48; // 384 bits
const REFRESH_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Issue a brand-new refresh token for a user. Returns the plaintext
 * (caller surfaces it once in the response) and the row id.
 */
export async function issueRefreshToken(params: {
  userId: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(REFRESH_BYTES).toString('hex');
  const tokenHash = hashRefreshToken(token);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);

  await prisma.refreshToken.create({
    data: {
      userId: params.userId,
      tokenHash,
      expiresAt,
      userAgent: params.userAgent ?? null,
      ipAddress: params.ipAddress ?? null,
    },
  });

  return { token, expiresAt };
}

/**
 * Constant-time hash compare. Both inputs MUST be hex strings of equal
 * length (sha256 = 64 chars). Returns false on length mismatch rather
 * than throwing.
 */
function safeHashEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * Consume a refresh token, rotating it for a fresh one. Returns the new
 * { token, expiresAt } pair plus the userId on success, or null if the
 * token is unknown / expired / already used.
 *
 * On replay (token is already used), we revoke ALL of the user's other
 * refresh tokens as a panic-button — the original is presumed stolen.
 */
export async function rotateRefreshToken(params: {
  presentedToken: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}): Promise<
  | { ok: true; userId: string; token: string; expiresAt: Date }
  | { ok: false; reason: 'invalid' | 'expired' | 'replayed' }
> {
  const tokenHash = hashRefreshToken(params.presentedToken);

  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash },
  });
  if (!row) return { ok: false, reason: 'invalid' };

  // Defensive: make sure the lookup actually matched our hash byte-for-byte.
  // (findUnique on @unique already does this, but constant-time-compare
  // costs nothing and matches the password-reset pattern.)
  if (!safeHashEqual(row.tokenHash, tokenHash)) {
    return { ok: false, reason: 'invalid' };
  }

  if (row.usedAt) {
    // REPLAY — wipe all this user's refresh tokens. Forces a fresh
    // password-based sign-in, which is what we want if a token has
    // leaked.
    await prisma.refreshToken.deleteMany({ where: { userId: row.userId } });
    return { ok: false, reason: 'replayed' };
  }
  if (row.expiresAt < new Date()) {
    await prisma.refreshToken.delete({ where: { id: row.id } });
    return { ok: false, reason: 'expired' };
  }

  // Issue the replacement BEFORE marking the old as used so we never
  // have a window where the user holds a not-yet-active replacement.
  const newToken = randomBytes(REFRESH_BYTES).toString('hex');
  const newHash = hashRefreshToken(newToken);
  const newExpires = new Date(Date.now() + REFRESH_TTL_MS);

  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    }),
    prisma.refreshToken.create({
      data: {
        userId: row.userId,
        tokenHash: newHash,
        expiresAt: newExpires,
        userAgent: params.userAgent ?? null,
        ipAddress: params.ipAddress ?? null,
      },
    }),
  ]);

  return { ok: true, userId: row.userId, token: newToken, expiresAt: newExpires };
}

/**
 * Revoke a single refresh token (logout from a single device).
 * Idempotent — silently no-ops if the token doesn't exist.
 */
export async function revokeRefreshToken(presentedToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(presentedToken);
  await prisma.refreshToken.deleteMany({ where: { tokenHash } });
}

/**
 * Revoke EVERY refresh token for a user (logout-everywhere or panic
 * button after a 2FA disable / password reset).
 */
export async function revokeAllRefreshTokensForUser(userId: string): Promise<number> {
  const { count } = await prisma.refreshToken.deleteMany({ where: { userId } });
  return count;
}
