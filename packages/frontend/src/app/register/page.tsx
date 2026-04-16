'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { api, Location } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Script from 'next/script';

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loginWithGoogle, routeByRole, user } = useAuth();

  // Check if arriving from OAuth (needs onboarding step 2)
  const oauthProvider = searchParams.get('oauth');
  const startStep = searchParams.get('step') === '2' && oauthProvider ? 2 : 1;

  const [step, setStep] = useState(startStep);
  const [locations, setLocations] = useState<Location[]>([]);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [googleLoaded, setGoogleLoaded] = useState(false);

  // Step 1 fields
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Step 2 fields
  const [locationId, setLocationId] = useState('');
  const [ageGroup, setAgeGroup] = useState('');

  useEffect(() => {
    api.getLocations().then((res) => {
      if (res.data) setLocations(res.data);
    });
  }, []);

  // If user arrived from OAuth and is on step 2, they already have an account
  // If they complete step 2, update their profile and route them
  const isOAuthOnboarding = startStep === 2 && oauthProvider;

  // Google Sign-In callback for registration
  const handleGoogleResponse = useCallback(async (response: { credential: string }) => {
    setError('');
    setIsLoading(true);
    try {
      const result = await loginWithGoogle(response.credential);
      if (result.isNewUser) {
        // New user â move to step 2 for location/age selection
        setStep(2);
      }
      // Existing user â AuthContext already routed them
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Google sign-up failed';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [loginWithGoogle]);

  // Initialize Google Sign-In
  useEffect(() => {
    if (!googleLoaded || step !== 1) return;

    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) return;

    // @ts-expect-error - Google Identity Services global
    if (window.google?.accounts?.id) {
      // @ts-expect-error - Google Identity Services
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleResponse,
        auto_select: false,
      });

      const googleBtnContainer = document.getElementById('google-signup-btn');
      if (googleBtnContainer) {
        // @ts-expect-error - Google Identity Services
        window.google.accounts.id.renderButton(googleBtnContainer, {
          theme: 'filled_black',
          size: 'large',
          width: '100%',
          text: 'signup_with',
          shape: 'rectangular',
          logo_alignment: 'left',
        });
      }
    }
  }, [googleLoaded, handleGoogleResponse, step]);

  const handleStep1 = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setStep(2);
  };

  const handleStep2Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!locationId) {
      setError('Please select your training location');
      return;
    }
    if (!ageGroup) {
      setError('Please select your age group');
      return;
    }

    setIsLoading(true);
    try {
      if (isOAuthOnboarding && user) {
        // OAuth user completing onboarding â update their profile
        await api.updateProfile({
          homeLocationId: locationId,
          clientProfile: { ageGroup },
        } as Parameters<typeof api.updateProfile>[0]);
        routeByRole(user.role);
      } else {
        // Standard email/password registration
        const res = await api.register({
          fullName,
          email,
          phone,
          password,
          locationId,
          ageGroup,
        });

        if (res.data) {
          localStorage.setItem('ppl_token', res.data.token);
          router.push('/client');
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Registration failed. Please try again.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
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
          <h1 className="text-2xl font-bold text-foreground">Join PPL</h1>
          <p className="text-muted mt-1">
            {isOAuthOnboarding
              ? 'Just a couple more details to get you started'
              : 'Create your account to start training'}
          </p>
        </div>

        {/* Progress indicator */}
        <div className="flex items-center gap-2 mb-6">
          <div className={`h-1 flex-1 rounded-full ${step >= 1 ? 'ppl-gradient' : 'bg-border'}`} />
          <div className={`h-1 flex-1 rounded-full ${step >= 2 ? 'ppl-gradient' : 'bg-border'}`} />
        </div>

        <div className="ppl-card">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">
              {error}
            </div>
          )}

          {step === 1 && (
            <>
              {/* Social Sign-Up Buttons */}
              <div className="space-y-3 mb-6">
                <div id="google-signup-btn" className="flex justify-center [&>div]:!w-full" />

                <button
                  type="button"
                  onClick={() => setError('Apple Sign-In is coming soon!')}
                  className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg border border-border bg-white text-black font-medium text-sm hover:bg-gray-50 transition-colors"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                  </svg>
                  Sign up with Apple
                </button>
              </div>

              {/* Divider */}
              <div className="relative mb-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-3 bg-surface text-muted">or register with email</span>
                </div>
              </div>

              <form onSubmit={handleStep1} className="space-y-4">
                <div>
                  <label htmlFor="fullName" className="block text-sm font-medium text-foreground mb-1.5">
                    Full Name
                  </label>
                  <input
                    id="fullName"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="John Smith"
                    className="ppl-input"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="regEmail" className="block text-sm font-medium text-foreground mb-1.5">
                    Email
                  </label>
                  <input
                    id="regEmail"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="ppl-input"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="regPhone" className="block text-sm font-medium text-foreground mb-1.5">
                    Phone Number
                  </label>
                  <input
                    id="regPhone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(555) 123-4567"
                    className="ppl-input"
                  />
                </div>

                <div>
                  <label htmlFor="regPassword" className="block text-sm font-medium text-foreground mb-1.5">
                    Password
                  </label>
                  <input
                    id="regPassword"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="ppl-input"
                    required
                    minLength={8}
                  />
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground mb-1.5">
                    Confirm Password
                  </label>
                  <input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your password"
                    className="ppl-input"
                    required
                  />
                </div>

                <button type="submit" className="ppl-btn ppl-btn-primary w-full py-3 text-base">
                  Continue
                </button>
              </form>
            </>
          )}

          {step === 2 && (
            <form onSubmit={handleStep2Submit} className="space-y-4">
              <h2 className="text-lg font-semibold text-foreground mb-2">Training Details</h2>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Select Your Location
                </label>
                <div className="space-y-2">
                  {locations.map((loc) => (
                    <button
                      key={loc.id}
                      type="button"
                      onClick={() => setLocationId(loc.id)}
                      className={`w-full text-left p-3 rounded-lg border transition-all ${
                        locationId === loc.id
                          ? 'border-ppl-dark-green bg-ppl-dark-green/10'
                          : 'border-border hover:border-border-light'
                      }`}
                    >
                      <span className="font-medium text-foreground">{loc.name}</span>
                      {loc.address && (
                        <span className="block text-sm text-muted mt-0.5">{loc.address}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Age Group
                </label>
                <div className="space-y-2">
                  {[
                    { value: 'youth', label: 'Youth', desc: '12 and under' },
                    { value: 'ms_hs', label: 'Middle School / High School', desc: 'Ages 13-18' },
                    { value: 'college', label: 'College', desc: 'College athletes' },
                  ].map((group) => (
                    <button
                      key={group.value}
                      type="button"
                      onClick={() => setAgeGroup(group.value)}
                      className={`w-full text-left p-3 rounded-lg border transition-all ${
                        ageGroup === group.value
                          ? 'border-ppl-dark-green bg-ppl-dark-green/10'
                          : 'border-border hover:border-border-light'
                      }`}
                    >
                      <span className="font-medium text-foreground">{group.label}</span>
                      <span className="block text-sm text-muted mt-0.5">{group.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                {!isOAuthOnboarding && (
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="ppl-btn ppl-btn-secondary flex-1 py-3"
                  >
                    Back
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isLoading}
                  className={`ppl-btn ppl-btn-primary py-3 text-base ${isOAuthOnboarding ? 'w-full' : 'flex-1'}`}
                >
                  {isLoading ? 'Setting up...' : isOAuthOnboarding ? 'Complete Setup' : 'Create Account'}
                </button>
              </div>
            </form>
          )}

          <div className="mt-6 text-center">
            <p className="text-sm text-muted">
              Already have an account?{' '}
              <Link href="/login" className="text-ppl-light-green hover:text-ppl-dark-green transition-colors">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
