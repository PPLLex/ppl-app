'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('App error:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 mb-6">
          <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-foreground mb-2">Something went wrong</h1>
        <p className="text-muted text-sm mb-6">
          An unexpected error occurred. This has been logged and we&apos;ll look into it.
        </p>
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
