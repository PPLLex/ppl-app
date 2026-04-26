'use client';

/**
 * Email-verification landing page (#142 / PREMIUM_AUDIT S4).
 *
 * Flow: user clicks the link from the verification email → lands here with
 * `?token=...` → we POST it to /api/auth/email/verify → render success
 * (with a CTA to sign in) or a "link expired" recovery state.
 *
 * Public route — no auth required, since by definition the user might not
 * be logged in when they click the link from their email.
 */

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailInner />
    </Suspense>
  );
}

function VerifyEmailInner() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [errorMessage, setErrorMessage] = useState('');
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setStatus('error');
      setErrorMessage('This link is missing the verification token.');
      return;
    }

    api
      .verifyEmailToken(token)
      .then((res) => {
        if (res.data?.verified) {
          setStatus('success');
          setVerifiedEmail(res.data.email);
        } else {
          setStatus('error');
          setErrorMessage('We couldn’t verify this link. Try requesting a new one.');
        }
      })
      .catch((err: unknown) => {
        setStatus('error');
        setErrorMessage(
          err instanceof Error
            ? err.message
            : 'This link is invalid or has expired. Sign in and request a new one.'
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm flex flex-col items-center text-center">
        <div className="flex items-center justify-center w-48 h-48 rounded-full overflow-hidden mb-6 shadow-xl shadow-emerald-900/25 ring-1 ring-border bg-white/5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/ppl-logo.webp"
            alt="Pitching Performance Lab"
            width={192}
            height={192}
            className="w-full h-full object-contain"
            loading="eager"
            fetchPriority="high"
          />
        </div>

        {status === 'verifying' && (
          <>
            <div className="flex justify-center mb-4">
              <svg className="animate-spin h-8 w-8 text-accent-text" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">Verifying your email...</h2>
            <p className="text-muted text-sm">Just a moment.</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-highlight/20 mb-4">
              <svg className="w-7 h-7 text-accent-text" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">You&apos;re verified</h2>
            {verifiedEmail && (
              <p className="text-muted text-sm mb-6">
                <strong className="text-foreground">{verifiedEmail}</strong> is now confirmed on your PPL account.
              </p>
            )}
            <Link
              href="/login"
              className="ppl-btn ppl-btn-primary inline-block px-6 py-3"
            >
              Continue to sign in
            </Link>
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
              Sign in to request a new link
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
