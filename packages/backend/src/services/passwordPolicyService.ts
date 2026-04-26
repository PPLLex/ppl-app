/**
 * Server-side password policy (#PREMIUM_AUDIT S10).
 *
 * Three checks, ordered cheap → expensive so we short-circuit on cheap fails:
 *   1. Length / shape — minimum 8 chars, can't be all-digit or all-letter
 *      one-character (e.g. 'aaaaaaaa').
 *   2. Inline blocklist — the top ~50 worst-of-the-worst (123456, password,
 *      qwerty, etc.). Keeps the very dumbest signups out without a network
 *      hop. The frontend has its own larger client-side list at
 *      packages/frontend/src/lib/common-passwords.ts; this is a defensive
 *      duplicate, not the source of truth.
 *   3. HaveIBeenPwned k-anonymity check — POST a SHA-1 prefix to
 *      api.pwnedpasswords.com, scan the response for our suffix. Only the
 *      first 5 hex chars of the hash leave the server, so the actual
 *      password never does. If the suffix is in the result, the password
 *      has been seen in a breach corpus and we reject it.
 *
 * The HIBP step is fail-open: if the network call errors or the service
 * is down, we DO NOT block the signup. The cost of a false-positive
 * "password rejected because we couldn't reach pwnedpasswords.com" is
 * customer support tickets we don't want to handle. Frontend strength
 * meter + length + inline blocklist still catch the egregious cases.
 *
 * Usage:
 *   await assertPasswordPolicy(password);    // throws ApiError on failure
 *
 * Throws ApiError.badRequest with a human-readable message — wire it into
 * any route that creates or rotates a passwordHash.
 */

import crypto from 'crypto';
import { ApiError } from '../utils/apiError';

const MIN_LENGTH = 8;
const HIBP_TIMEOUT_MS = 2000;

// Top offenders. NOT exhaustive — the frontend list is larger; this is the
// "no matter what, never let these through the API" tier.
const HARD_BLOCKLIST = new Set([
  '12345678',
  '123456789',
  '1234567890',
  'password',
  'password1',
  'password!',
  'qwerty',
  'qwerty123',
  'qwertyuiop',
  'baseball',
  'baseball1',
  'pitcher',
  'football',
  'iloveyou',
  'admin',
  'admin123',
  'letmein',
  'welcome',
  'welcome1',
  'monkey',
  'dragon',
  'master',
  'sunshine',
  'princess',
  'shadow',
  'abc12345',
  'abcd1234',
  '11111111',
  '00000000',
  '99999999',
  'aaaaaaaa',
  'asdfasdf',
  'qazwsxedc',
  'zaq12wsx',
  'pitchingperformancelab',
  'ppl12345',
]);

/**
 * Quick-fail length + shape checks. Throws on bad input.
 */
function validateShape(password: string): void {
  if (password.length < MIN_LENGTH) {
    throw ApiError.badRequest(`Password must be at least ${MIN_LENGTH} characters.`);
  }
  if (password.length > 200) {
    // Bcrypt truncates at 72 bytes anyway and a 200-char policy is plenty;
    // anything longer is a bug or a denial-of-service attempt.
    throw ApiError.badRequest('Password is too long. Use 200 characters or fewer.');
  }
  // All same character (aaaaaaaa, 11111111). Repeats >=80% of length is also
  // a giveaway, but we'll be conservative and only reject the all-same case
  // here — the HIBP check picks up the rest.
  if (/^(.)\1+$/.test(password)) {
    throw ApiError.badRequest('Password is too repetitive. Mix in some variety.');
  }
}

/**
 * Inline blocklist check. Lowercases first so 'PASSWORD' is treated like
 * 'password'. Throws on hit.
 */
function validateBlocklist(password: string): void {
  if (HARD_BLOCKLIST.has(password.toLowerCase())) {
    throw ApiError.badRequest(
      'That password is too common. Pick something unique to you — a phrase or 4 random words works well.'
    );
  }
}

/**
 * HaveIBeenPwned k-anonymity check. Returns true if the password has been
 * seen in a known breach. False if not found OR if the API call failed
 * (fail-open — caller should treat false as "not blocked").
 *
 * Uses Node's built-in fetch (Node 22 has it stable). 2-second timeout
 * via AbortController so a slow HIBP doesn't hang signups.
 */
async function isPwnedByHibp(password: string): Promise<boolean> {
  try {
    const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), HIBP_TIMEOUT_MS);
    try {
      const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        method: 'GET',
        headers: { 'User-Agent': 'PPL-App-Password-Check' },
        signal: ctrl.signal,
      });
      if (!res.ok) return false;
      const body = await res.text();
      // Body is "SUFFIX:COUNT\r\n" lines. Match our suffix case-insensitively.
      const target = suffix.toUpperCase();
      for (const line of body.split('\n')) {
        const idx = line.indexOf(':');
        if (idx > 0 && line.slice(0, idx).trim().toUpperCase() === target) {
          return true;
        }
      }
      return false;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    // Network failure / timeout / DNS — fail open. Don't block signups
    // because a third-party API is down.
    console.warn('[passwordPolicy] HIBP check skipped:', err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Single entry point — call this anywhere we'd otherwise call bcrypt.hash
 * on a user-supplied password. Throws ApiError on policy failure;
 * resolves to void on accept.
 */
export async function assertPasswordPolicy(password: string): Promise<void> {
  validateShape(password);
  validateBlocklist(password);
  // HIBP last (network round trip) so cheap fails short-circuit.
  if (await isPwnedByHibp(password)) {
    throw ApiError.badRequest(
      'That password has appeared in a known data breach and isn’t safe to use. Pick a different one — a long passphrase is hard to guess and easy to remember.'
    );
  }
}
