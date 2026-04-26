'use client';

/**
 * Top-of-dashboard banner for users whose email is unverified (#142).
 *
 * - Loads /auth/email/verification-status once on mount.
 * - Hides itself entirely while loading and when the user is verified
 *   (so verified users never see a flash of UI).
 * - Offers a "Resend verification email" action with a 60s cooldown to
 *   discourage spam-clicking.
 *
 * This is intentionally NON-BLOCKING. Per #142 design, we don't want to
 * lock unverified users out of the dashboard — we just make verifying
 * impossible to ignore. Hard blocks (no booking, no payment) can layer on
 * later if Chad wants them.
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

const RESEND_COOLDOWN_SEC = 60;

export function EmailVerificationBanner() {
  const [verified, setVerified] = useState<boolean | null>(null);
  const [email, setEmail] = useState<string>('');
  const [resendingAt, setResendingAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let cancelled = false;
    api
      .getEmailVerificationStatus()
      .then((res) => {
        if (cancelled) return;
        if (res.data) {
          setVerified(res.data.verified);
          setEmail(res.data.email);
        }
      })
      .catch(() => {
        // Silent fail — the banner is a nudge, not load-bearing.
        if (!cancelled) setVerified(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-tick every second while a cooldown is active so the button updates
  // its countdown label. Cleared the moment cooldown expires.
  useEffect(() => {
    if (!resendingAt) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [resendingAt]);

  const cooldownLeft = resendingAt
    ? Math.max(0, RESEND_COOLDOWN_SEC - Math.floor((now - resendingAt) / 1000))
    : 0;

  if (verified === null || verified === true) return null;

  const handleResend = async () => {
    try {
      await api.resendVerificationEmail();
      toast.success('Verification email sent — check your inbox');
      setResendingAt(Date.now());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not send verification email');
    }
  };

  return (
    <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex items-start gap-3 flex-1">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.48 0L3.16 16.25A2 2 0 005 19z" />
          </svg>
        </div>
        <div className="text-sm">
          <p className="font-medium text-foreground">Verify your email</p>
          <p className="text-muted text-xs mt-0.5">
            We sent a confirmation link to{' '}
            <strong className="text-foreground">{email}</strong>. Click it to
            keep your PPL account fully active.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={handleResend}
        disabled={cooldownLeft > 0}
        className="ppl-btn ppl-btn-secondary text-xs whitespace-nowrap disabled:opacity-50"
      >
        {cooldownLeft > 0 ? `Resend in ${cooldownLeft}s` : 'Resend email'}
      </button>
    </div>
  );
}
