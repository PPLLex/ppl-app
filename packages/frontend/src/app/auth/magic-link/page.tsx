'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import Link from 'next/link';

export default function MagicLinkPage() {
  return (
    <Suspense>
      <MagicLinkVerifier />
    </Suspense>
  );
}

function MagicLinkVerifier() {
  const searchParams = useSearchParams();
  const { verifyMagicLink } = useAuth();
  const { branding, isLoaded: brandingLoaded } = useTheme();
  const [status, setStatus] = useState<'verifying' | 'error'>('verifying');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setStatus('error');
      setErrorMessage('Invalid link — no token provided.');
      return;
    }

    verifyMagicLink(token).catch((err) => {
      setStatus('error');
      setErrorMessage(
        err instanceof Error ? err.message : 'This link is invalid or has expired.'
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm flex flex-col items-center text-center">
        {!brandingLoaded ? (
          <div className="w-48 h-48 mb-6" aria-hidden="true" />
        ) : branding.logoData ? (
          <div className="flex items-center justify-center w-48 h-48 rounded-full overflow-hidden mb-6 shadow-xl shadow-emerald-900/25 ring-1 ring-border bg-white/5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={branding.logoData}
              alt={branding.businessName}
              className="w-full h-full object-contain"
            />
          </div>
        ) : (
          <div className="flex items-center justify-center w-48 h-48 rounded-full ppl-gradient mb-6">
            <span className="text-white text-6xl font-bold">P</span>
          </div>
        )}

        {status === 'verifying' && (
          <>
            <div className="flex justify-center mb-4">
              <svg className="animate-spin h-8 w-8 text-accent-text" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">Signing you in...</h2>
            <p className="text-muted text-sm">Verifying your link. Just a moment.</p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-danger/20 mb-4">
              <svg className="w-7 h-7 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">Link expired</h2>
            <p className="text-muted text-sm mb-6">{errorMessage}</p>
            <Link
              href="/login"
              className="ppl-btn ppl-btn-primary inline-block px-6 py-3"
            >
              Back to Sign In
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

