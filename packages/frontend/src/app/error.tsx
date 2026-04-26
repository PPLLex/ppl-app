'use client';

import { useEffect } from 'react';

/**
 * Branded global error boundary. Same gradient-orb backdrop as the 404
 * page so unexpected crashes still feel like part of the product, not
 * a fall-through to a stack trace.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface for ops + Sentry (already wired upstream)
    console.error('App error:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-[#0A0A0A] text-foreground relative overflow-hidden">
      <div
        aria-hidden
        className="absolute -top-40 left-1/2 -translate-x-1/2 w-[640px] h-[640px] rounded-full bg-gradient-to-br from-red-500/20 via-orange-500/10 to-transparent blur-3xl pointer-events-none"
      />
      <div className="relative text-center max-w-md">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-red-500/10 border-2 border-red-500/30 mb-6">
          <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold mb-2">Something broke on our end.</h1>
        <p className="text-muted text-sm mb-6">
          Sorry about that — we&apos;ve already logged it and the team will
          take a look. Try refreshing, or head back to your dashboard.
        </p>
        {error?.digest && (
          <p className="text-xs text-muted/60 font-mono mb-6">
            Reference: {error.digest}
          </p>
        )}
        <div className="flex gap-3 justify-center">
          <button onClick={reset} className="ppl-btn ppl-btn-primary text-sm">
            Try Again
          </button>
          <a href="/" className="ppl-btn ppl-btn-secondary text-sm">
            Go Home
          </a>
        </div>
      </div>
    </div>
  );
}
