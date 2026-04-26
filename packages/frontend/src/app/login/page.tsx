'use client';

import { useState, useEffect, Suspense, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Script from 'next/script';
import { toast } from 'sonner';
import { PasswordInput } from '@/components/auth/PasswordInput';

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

type AuthMode = 'credentials' | 'magic-link';

function LoginForm() {
  const { login, verifyTwoFactorLogin, loginWithGoogle, sendMagicLink } = useAuth();
  const { branding, isLoaded: brandingLoaded } = useTheme();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('credentials');
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [googleLoaded, setGoogleLoaded] = useState(false);
  // 2FA challenge state — set when /auth/login returns twoFactorRequired.
  // While set, the form swaps from "email + password" to "6-digit code".
  const [twoFactorChallenge, setTwoFactorChallenge] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');

  useEffect(() => {
    if (searchParams.get('expired') === 'true') {
      toast.info('Your session expired. Please sign in again.');
      setInfo('Your session has expired. Please sign in again.');
    }
  }, [searchParams]);

  // Google Sign-In callback
  const handleGoogleResponse = useCallback(async (response: { credential: string }) => {
    setError('');
    setIsLoading(true);
    try {
      const result = await loginWithGoogle(response.credential);
      if (result.isNewUser) {
        // New user — redirect to onboarding to pick location/age group
        window.location.href = '/register?oauth=google&step=2';
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Google sign-in failed';
      toast.error(message);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [loginWithGoogle]);

  // Initialize Google Sign-In
  useEffect(() => {
    if (!googleLoaded) return;

    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) return;

    // @ts-expect-error - Google Identity Services global
    if (window.google?.accounts?.id) {
      // @ts-expect-error - Google Identity Services
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleResponse,
        auto_select: false,
        cancel_on_tap_outside: true,
      });

      const googleBtnContainer = document.getElementById('google-signin-btn');
      if (googleBtnContainer) {
        // @ts-expect-error - Google Identity Services
        window.google.accounts.id.renderButton(googleBtnContainer, {
          theme: 'filled_black',
          size: 'large',
          width: '100%',
          text: 'signin_with',
          shape: 'rectangular',
          logo_alignment: 'left',
        });
      }
    }
  }, [googleLoaded, handleGoogleResponse]);

  const handleCredentialLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const result = await login(email, password);
      if (result.twoFactorRequired) {
        // Stash the challenge token and swap the form into 2FA mode. Toast
        // is informational rather than success — they're not in yet.
        setTwoFactorChallenge(result.challenge);
        setTwoFactorCode('');
        toast.info('Enter the 6-digit code from your authenticator app');
        return;
      }
      toast.success('Welcome back to PPL');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login failed. Please try again.';
      toast.error(message);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTwoFactorVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!twoFactorChallenge) return;
    setError('');
    setIsLoading(true);
    try {
      const { recoveryCodesLow } = await verifyTwoFactorLogin(twoFactorChallenge, twoFactorCode);
      toast.success('Welcome back to PPL');
      if (recoveryCodesLow) {
        // Soft nudge — don't block them, but tell them to print fresh codes.
        toast.warning(
          'You have 3 or fewer recovery codes left. Generate new codes from your security settings soon.'
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Verification failed';
      toast.error(message);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const cancelTwoFactor = () => {
    setTwoFactorChallenge(null);
    setTwoFactorCode('');
    setError('');
    // We intentionally KEEP the email so the user doesn't have to retype it.
    setPassword('');
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await sendMagicLink(email);
      setMagicLinkSent(true);
      toast.success('Check your email for a sign-in link');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to send link';
      toast.error(message);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      {/* Google Identity Services script */}
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={() => setGoogleLoaded(true)}
      />

      <div className="w-full max-w-md">
        {/* Logo — static /ppl-logo.webp (43KB). Zero network round-trip,
            paints on first frame. */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="flex items-center justify-center w-48 h-48 rounded-full overflow-hidden mb-5 shadow-xl shadow-emerald-900/25 ring-1 ring-border bg-white/5">
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
          <h1 className="font-display text-xl sm:text-2xl font-bold tracking-[0.08em] uppercase text-foreground text-center leading-tight">
            {branding.businessName || 'Pitching Performance Lab'}
          </h1>
          <p className="text-muted mt-2 text-center">Sign in to your account</p>
        </div>

        <div className="ppl-card">
          {info && (
            <div className="mb-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm">
              {info}
            </div>
          )}
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">
              {error}
            </div>
          )}

          {/* —— Social Sign-In Buttons —— */}
          <div className="space-y-3 mb-6">
            {/* Google Sign-In */}
            <div id="google-signin-btn" className="flex justify-center [&>div]:!w-full" />

            {/* Apple Sign-In */}
            <button
              type="button"
              onClick={() => {
                // Apple Sign-In will be initialized when Apple developer account is set up
                setError('Apple Sign-In is coming soon!');
              }}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg border border-border bg-white text-black font-medium text-sm hover:bg-gray-50 transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
              </svg>
              Sign in with Apple
            </button>
          </div>

          {/* —— Divider —— */}
          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-3 bg-surface text-muted">or</span>
            </div>
          </div>

          {/* —— 2FA Challenge — only when login succeeded but the account
                has TOTP enabled. We hide the social + magic-link surface
                while we're collecting the code so the user can't get confused. —— */}
          {twoFactorChallenge ? (
            <form onSubmit={handleTwoFactorVerify} className="space-y-4">
              <div className="text-center mb-2">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-highlight/15 mb-3">
                  <svg className="w-6 h-6 text-accent-text" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0-1.1.9-2 2-2s2 .9 2 2-2 2-2 2v1m-4 4h8a2 2 0 002-2v-7a2 2 0 00-2-2h-1V6a3 3 0 00-6 0v1H8a2 2 0 00-2 2v7a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-base font-semibold text-foreground">Two-factor required</h3>
                <p className="text-xs text-muted mt-1">
                  Enter the 6-digit code from your authenticator app — or paste a recovery code.
                </p>
              </div>
              <div>
                <label htmlFor="totp-code" className="block text-sm font-medium text-foreground mb-1.5">
                  Verification code
                </label>
                <input
                  id="totp-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value)}
                  placeholder="123 456"
                  className="ppl-input text-center tracking-[0.4em] text-lg font-mono"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={isLoading || twoFactorCode.length < 6}
                className="ppl-btn ppl-btn-primary w-full py-3 text-base"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Verifying...
                  </span>
                ) : (
                  'Verify and sign in'
                )}
              </button>
              <button
                type="button"
                onClick={cancelTwoFactor}
                className="w-full text-sm text-muted hover:text-accent-text transition-colors text-center"
              >
                Use a different account
              </button>
            </form>
          ) : authMode === 'credentials' ? (
            <>
              <form onSubmit={handleCredentialLogin} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1.5">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="ppl-input"
                    required
                    autoComplete="email"
                  />
                </div>

                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1.5">
                    Password
                  </label>
                  <PasswordInput
                    id="password"
                    variant="login"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="ppl-btn ppl-btn-primary w-full py-3 text-base"
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Signing in...
                    </span>
                  ) : (
                    'Sign In'
                  )}
                </button>
              </form>

              <button
                type="button"
                onClick={() => { setAuthMode('magic-link'); setError(''); }}
                className="w-full mt-3 text-sm text-muted hover:text-accent-text transition-colors text-center"
              >
                Sign in with email link instead
              </button>
            </>
          ) : (
            <>
              {magicLinkSent ? (
                <div className="text-center py-4">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-highlight/20 mb-4">
                    <svg className="w-7 h-7 text-accent-text" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">Check your email</h3>
                  <p className="text-muted text-sm mb-4">
                    We sent a sign-in link to <strong className="text-foreground">{email}</strong>. Click the link in the email to sign in.
                  </p>
                  <p className="text-muted text-xs">
                    The link expires in 15 minutes. Check your spam folder if you don&apos;t see it.
                  </p>
                  <button
                    type="button"
                    onClick={() => { setMagicLinkSent(false); setEmail(''); }}
                    className="mt-4 text-sm text-accent-text hover:text-primary-text transition-colors"
                  >
                    Use a different email
                  </button>
                </div>
              ) : (
                <form onSubmit={handleMagicLink} className="space-y-4">
                  <div>
                    <label htmlFor="magic-email" className="block text-sm font-medium text-foreground mb-1.5">
                      Email
                    </label>
                    <input
                      id="magic-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="ppl-input"
                      required
                      autoComplete="email"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="ppl-btn ppl-btn-primary w-full py-3 text-base"
                  >
                    {isLoading ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Sending link...
                      </span>
                       ) : (
                      'Send Sign-In Link'
                    )}
                  </button>
                </form>
              )}

              <button
                type="button"
                onClick={() => { setAuthMode('credentials'); setError(''); setMagicLinkSent(false); }}
                className="w-full mt-3 text-sm text-muted hover:text-accent-text transition-colors text-center"
              >
                Sign in with password instead
              </button>
            </>
          )}

          <div className="mt-4 text-center">
            <Link href="/forgot-password" className="text-sm text-muted hover:text-accent-text transition-colors">
              Forgot your password?
            </Link>
          </div>

          <div className="mt-3 text-center">
            <p className="text-sm text-muted">
              New to PPL?{' '}
              <Link href="/register" className="text-accent-text hover:text-primary-text transition-colors">
                Create an account
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
