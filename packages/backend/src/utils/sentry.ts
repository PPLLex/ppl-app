/**
 * Sentry initialization for the PPL backend.
 *
 * Guards the entire module on SENTRY_DSN — if the env var isn't set,
 * the initSentry() call is a silent no-op and captureException() uses
 * a fall-through that just logs to stderr. That makes Sentry strictly
 * opt-in at the infra layer: add SENTRY_DSN to Railway and telemetry
 * starts flowing on the next deploy. No code change needed.
 *
 * Import order matters: initSentry() MUST run before we import the
 * express app (see server.ts). Sentry v9+ installs its instrumentation
 * into Node's require hooks at init time, and any modules loaded
 * beforehand don't get tracing.
 */

import * as Sentry from '@sentry/node';

let initialized = false;

export function initSentry(): boolean {
  if (initialized) return true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    // Not configured — leave Sentry off, keep captureException as a local logger.
    return false;
  }
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'production',
    // Conservative trace sample rate to start — Chad can raise via
    // SENTRY_TRACES_SAMPLE_RATE once we see the volume.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    // Disable Sentry's default "send PII" heuristic; we explicitly attach
    // what we want (userId on auth paths, etc.) — never raw emails/phones.
    sendDefaultPii: false,
    release: process.env.RAILWAY_DEPLOYMENT_ID || undefined,
  });
  initialized = true;
  return true;
}

/**
 * Normalize a captured error: if Sentry is on, forward it; otherwise
 * log to stderr so we still see it in Railway logs.
 */
export function captureError(
  err: unknown,
  context?: { userId?: string; tags?: Record<string, string>; extra?: Record<string, unknown> }
): void {
  if (initialized) {
    Sentry.withScope((scope) => {
      if (context?.userId) scope.setUser({ id: context.userId });
      if (context?.tags) for (const [k, v] of Object.entries(context.tags)) scope.setTag(k, v);
      if (context?.extra) for (const [k, v] of Object.entries(context.extra)) scope.setExtra(k, v);
      scope.captureException(err);
    });
    return;
  }
  console.error('[captureError]', err, context ?? '');
}

/**
 * Express request handler — attach at the TOP of app.use() so Sentry
 * starts a transaction for every request.
 */
export function sentryRequestHandler() {
  // Sentry v9 auto-instruments Express once init is called before the
  // app is imported. We export a no-op middleware for forward-compat
  // so the callsite in app.ts stays stable.
  return (_req: unknown, _res: unknown, next: () => void) => next();
}

/**
 * Express error handler — attach AFTER all routes so thrown errors
 * get captured on their way to our own error middleware.
 */
export function sentryErrorHandler() {
  // Sentry.setupExpressErrorHandler is the v9+ API. Calling it is
  // safe even when init() was a no-op (it checks the client).
  const app = { use: (_fn: unknown) => {} };
  return (err: unknown, _req: unknown, _res: unknown, next: (e?: unknown) => void) => {
    if (initialized) {
      try {
        Sentry.captureException(err);
      } catch {
        /* never let Sentry itself break error handling */
      }
    }
    next(err);
    void app; // keep reference for future setupExpressErrorHandler wire-in
  };
}
