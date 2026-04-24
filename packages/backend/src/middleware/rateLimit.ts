import { Request, Response, NextFunction } from 'express';

/**
 * Simple in-memory rate limiter.
 * For production, swap with Redis-backed (e.g., rate-limiter-flexible).
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
}, 5 * 60 * 1000);

interface RateLimitOptions {
  windowMs: number;   // Time window in ms
  max: number;        // Max requests per window
  keyPrefix?: string; // Prefix for grouping (e.g., 'auth', 'api')
}

export function rateLimit(options: RateLimitOptions) {
  const { windowMs, max, keyPrefix = 'global' } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - entry.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

    if (entry.count > max) {
      res.status(429).json({
        success: false,
        message: 'Too many requests. Please try again later.',
        retryAfter: Math.ceil((entry.resetAt - now) / 1000),
      });
      return;
    }

    next();
  };
}

/** Strict limiter for auth endpoints (login, register, password reset) */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                   // 20 attempts per 15 min
  keyPrefix: 'auth',
});

/** General API limiter */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,             // 100 requests per minute
  keyPrefix: 'api',
});

/** Aggressive limiter for the 4-digit kiosk PIN. A 4-digit PIN has only
 * 10,000 possible values, so even a slow brute-force could enumerate
 * the space. 10 attempts per 15 minutes per IP makes that infeasible. */
export const kioskPinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyPrefix: 'kiosk-pin',
});

/** Limiter for email-based flows (password reset, magic link, invites).
 * Keyed by IP to block rotation; backend handlers should also silently
 * accept requests so enumeration is impossible regardless of rate. */
export const sensitiveLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  keyPrefix: 'sensitive',
});
