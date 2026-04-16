'use client';

import { useState, useEffect, Suspense, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Script from 'next/script';

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

type AuthMode = 'credentials' | 'magic-link';

function LoginForm() {
  const { login, loginWithGoogle, sendMagicLink } = useAuth();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('credentials');
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [googleLoaded, setGoogleLoaded] = useState(false);

  useEffect(() => {
    if (searchParams.get('expired') === 'true') {
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
        // New user â redirect to onboarding to pick location/age group
        window.location.href = '/register?oauth=google&step=2';
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Google sign-in failed';
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
      await login(email, password);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login failed. Please try again.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await sendMagicLink(email);
      setMagicLinkSent(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to send link';
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
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full ppl-gradient mb-4">
            <span className="text-white text-3xl font-bold">P</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">
            Pitching Performance Lab
          </h1>
          <p className="text-muted mt-1">Sign in to your account</p>
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

          {/* ââ Social Sign-In Buttons ââ */}
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

          {/* ââ Divider ââ */}
          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-3 bg-surface text-muted">or</span>
            </div>
          </div>

          {/* ââ Magic Link / Password Toggle ââ */}
          {authMode === 'credentials' ? (
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
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="â¢â¢â¢â¢â¢â¢â¢â¢"
                    className="ppl-input"
                    required
                    autoComplete="current-password"
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
                className="w-full mt-3 text-sm text-muted hover:text-ppl-light-green transition-colors text-center"
              >
                Sign in with email link instead
              </button>
            </>
          ) : (
            <>
              {magicLinkSent ? (
                <div className="text-center py-4">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-ppl-dark-green/20 mb-4">
                    <svg className="w-7 h-7 text-ppl-light-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
                    className="mt-4 text-sm text-ppl-light-green hover:text-ppl-dark-green transition-colors"
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
                className="w-full mt-3 text-sm text-muted hover:text-ppl-light-green transition-colors text-center"
              >
                Sign in with password instead
              </button>
            </>
          )}

          <div className="mt-4 text-center">
            <Link href="/forgot-password" className="text-sm text-muted hover:text-ppl-light-green transition-colors">
              Forgot your password?
            </Link>
          </div>

          <div className="mt-3 text-center">
            <p className="text-sm text-muted">
              New to PPL?{' '}
              <Link href="/register" className="text-ppl-light-green hover:text-ppl-dark-green transition-colors">
                Create an account
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
