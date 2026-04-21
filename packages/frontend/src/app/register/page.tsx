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

// Total steps: 1=Account, 2=New/Returning, 3=Payment (if new), 4=Training Preference, 5=Location+AgeGroup
type AthleteSelection = 'new' | 'returning' | 'youth_graduate' | 'free_assessment';
type TrainingPref = 'IN_PERSON' | 'REMOTE' | 'HYBRID';

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loginWithGoogle, routeByRole, user } = useAuth();

  // Check URL params
  const oauthProvider = searchParams.get('oauth');
  const stepParam = searchParams.get('step');
  const paymentStatus = searchParams.get('payment');

  // Determine starting step
  const getInitialStep = () => {
    if (stepParam === 'location' && paymentStatus === 'success') return 4; // returning from Stripe success â training pref
    if (stepParam === '2' && oauthProvider) return 2; // OAuth user needs onboarding
    return 1;
  };

  const [step, setStep] = useState(getInitialStep);
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
  const [athleteSelection, setAthleteSelection] = useState<AthleteSelection | ''>('');

  // Step 4 fields
  const [trainingPreference, setTrainingPreference] = useState<TrainingPref | ''>('');

  // Step 5 fields
  const [locationId, setLocationId] = useState('');
  const [ageGroup, setAgeGroup] = useState('');

  // Payment state
  const [requiresPayment, setRequiresPayment] = useState(false);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);

  useEffect(() => {
    api.getLocations().then((res) => {
      if (res.data) setLocations(res.data);
    });
  }, []);

  // If returning from Stripe payment success, confirm the payment
  useEffect(() => {
    if (paymentStatus === 'success' && (step === 4 || step === 5)) {
      api.confirmOnboardingPayment().then((res) => {
        if (res.data?.paid) {
          setPaymentConfirmed(true);
        }
      });
    }
  }, [paymentStatus, step]);

  // If payment was cancelled, go back to step 2
  useEffect(() => {
    if (stepParam === 'payment' && paymentStatus === 'cancelled') {
      setStep(2);
      setError('Payment was cancelled. You can try again or select a different option.');
    }
  }, [stepParam, paymentStatus]);

  const isOAuthOnboarding = getInitialStep() === 2 && oauthProvider;

  // Google Sign-In callback for registration
  const handleGoogleResponse = useCallback(async (response: { credential: string }) => {
    setError('');
    setIsLoading(true);
    try {
      const result = await loginWithGoogle(response.credential);
      if (result.isNewUser) {
        setStep(2);
      }
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

  // Step 2: Submit athlete status selection
  const handleStep2Submit = async () => {
    if (!athleteSelection) {
      setError('Please select your athlete status');
      return;
    }

    setError('');
    setIsLoading(true);

    try {
      // For OAuth users or if we have a token already, call the API
      // For email registration, we'll set this after account creation
      const token = localStorage.getItem('ppl_token');
      if (token || isOAuthOnboarding) {
        const res = await api.setOnboardingStatus(athleteSelection);
        if (res.data) {
          setRequiresPayment(res.data.requiresPayment);

          if (res.data.requiresPayment) {
            // New athlete â redirect to Stripe
            setStep(3);
          } else {
            // Returning athlete â skip payment, go to training preference
            setStep(4);
          }
        }
      } else {
        // Email registration: we don't have an account yet.
        // Determine payment requirement locally and proceed.
        const needsPayment = athleteSelection !== 'returning';
        setRequiresPayment(needsPayment);
        if (needsPayment) {
          setStep(3);
        } else {
          setStep(4);
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save status';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  // Step 3: Initiate Stripe checkout
  const handlePaymentCheckout = async () => {
    setError('');
    setIsLoading(true);

    try {
      const token = localStorage.getItem('ppl_token');

      if (!token && !isOAuthOnboarding) {
        // Need to create the account first, then redirect to Stripe
        const regRes = await api.register({
          fullName,
          email,
          phone,
          password,
          locationId: '', // Will be set after payment
          ageGroup: '',
        });

        if (regRes.data) {
          localStorage.setItem('ppl_token', regRes.data.token);

          // Now set onboarding status
          await api.setOnboardingStatus(athleteSelection as AthleteSelection);
        }
      }

      // Create checkout session and redirect
      const res = await api.createOnboardingCheckout();
      if (res.data && 'checkoutUrl' in res.data && res.data.checkoutUrl) {
        window.location.href = res.data.checkoutUrl;
        return;
      } else if (res.data && 'alreadyPaid' in res.data) {
        setPaymentConfirmed(true);
        setStep(4); // Go to training preference
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Payment setup failed. Please try again.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  // Step 4: Final submit â location + age group
  const handleFinalSubmit = async (e: React.FormEvent) => {
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await api.updateProfile({ homeLocationId: locationId, clientProfile: { ageGroup }, trainingPreference: trainingPreference || undefined } as any);
        routeByRole(user.role);
      } else {
        const token = localStorage.getItem('ppl_token');

        if (token) {
          // Account already created (payment flow or OAuth) â update profile
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await api.updateProfile({ homeLocationId: locationId, clientProfile: { ageGroup }, trainingPreference: trainingPreference || undefined } as any);
          router.push('/client');
        } else {
          // Standard email registration (returning athlete, no payment step)
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

            // Set onboarding status after account creation
            if (athleteSelection) {
              await api.setOnboardingStatus(athleteSelection as AthleteSelection);
            }

            router.push('/client');
          }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Registration failed. Please try again.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  // Total visual steps (payment step only shows for new athletes)
  const totalSteps = requiresPayment ? 5 : 4;
  const visualStep = () => {
    if (step === 1) return 1;
    if (step === 2) return 2;
    if (step === 3) return 3; // payment
    if (step === 4) return requiresPayment ? 4 : 3; // training preference
    if (step === 5) return requiresPayment ? 5 : 4; // location
    return step;
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
              : step === 3
                ? 'Complete your onboarding fee to get started'
                : step === 4
                  ? 'How would you like to train?'
                  : 'Create your account to start training'}
          </p>
        </div>

        {/* Progress indicator */}
        <div className="flex items-center gap-2 mb-6">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full ${visualStep() > i ? 'ppl-gradient' : 'bg-border'}`}
            />
          ))}
        </div>

        <div className="ppl-card">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">
              {error}
            </div>
          )}

          {/* ============================================ */}
          {/* STEP 1: Account Info                         */}
          {/* ============================================ */}
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

          {/* ============================================ */}
          {/* STEP 2: New vs Returning Athlete             */}
          {/* ============================================ */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-foreground mb-1">Have you trained at PPL before?</h2>
                <p className="text-sm text-muted">
                  This helps us set up the right experience for you. New athletes have a one-time $300 onboarding fee.
                </p>
              </div>

              <div className="space-y-3">
                {/* Returning Athlete Option */}
                <button
                  type="button"
                  onClick={() => setAthleteSelection('returning')}
                  className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                    athleteSelection === 'returning'
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-border-light'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      athleteSelection === 'returning' ? 'border-primary' : 'border-muted'
                    }`}>
                      {athleteSelection === 'returning' && (
                        <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                      )}
                    </div>
                    <span className="font-semibold text-foreground text-base">Returning Athlete</span>
                  </div>
                  <p className="text-sm text-muted ml-8">
                    I have trained at PPL before, already paid the onboarding fee, or I pitch for a PPL Partner school.
                  </p>
                </button>

                {/* New Athlete Option */}
                <button
                  type="button"
                  onClick={() => setAthleteSelection('new')}
                  className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                    athleteSelection === 'new'
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-border-light'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      athleteSelection === 'new' ? 'border-primary' : 'border-muted'
                    }`}>
                      {athleteSelection === 'new' && (
                        <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                      )}
                    </div>
                    <span className="font-semibold text-foreground text-base">New Athlete</span>
                  </div>
                  <p className="text-sm text-muted ml-8">
                    I am brand new to PPL and have never trained here before.
                  </p>
                </button>

                {/* Youth Graduate Option */}
                <button
                  type="button"
                  onClick={() => setAthleteSelection('youth_graduate')}
                  className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                    athleteSelection === 'youth_graduate'
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-border-light'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      athleteSelection === 'youth_graduate' ? 'border-primary' : 'border-muted'
                    }`}>
                      {athleteSelection === 'youth_graduate' && (
                        <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                      )}
                    </div>
                    <span className="font-semibold text-foreground text-base">PPL Youth Graduate</span>
                  </div>
                  <p className="text-sm text-muted ml-8">
                    I trained in the PPL Youth program and am moving up to the 13+ age groups.
                  </p>
                </button>

                {/* Free Assessment Option */}
                <button
                  type="button"
                  onClick={() => setAthleteSelection('free_assessment')}
                  className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                    athleteSelection === 'free_assessment'
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-border-light'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      athleteSelection === 'free_assessment' ? 'border-primary' : 'border-muted'
                    }`}>
                      {athleteSelection === 'free_assessment' && (
                        <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                      )}
                    </div>
                    <span className="font-semibold text-foreground text-base">Free Assessment Participant</span>
                  </div>
                  <p className="text-sm text-muted ml-8">
                    I did a free assessment at PPL but haven&apos;t started training yet.
                  </p>
                </button>
              </div>

              {/* Fee notice for non-returning selections */}
              {athleteSelection && athleteSelection !== 'returning' && (
                <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm text-foreground">
                  <span className="font-medium">One-time onboarding fee:</span> $300 â covers your initial assessment, program setup, and personalized training plan.
                </div>
              )}

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
                  type="button"
                  onClick={handleStep2Submit}
                  disabled={!athleteSelection || isLoading}
                  className={`ppl-btn ppl-btn-primary py-3 text-base ${isOAuthOnboarding ? 'w-full' : 'flex-1'}`}
                >
                  {isLoading ? 'Saving...' : 'Continue'}
                </button>
              </div>
            </div>
          )}

          {/* ============================================ */}
          {/* STEP 3: Payment (New athletes only)          */}
          {/* ============================================ */}
          {step === 3 && (
            <div className="space-y-5">
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
                  <svg className="w-8 h-8 text-primary-text" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
                  </svg>
                </div>
                <h2 className="text-lg font-semibold text-foreground mb-1">Onboarding Fee</h2>
                <p className="text-sm text-muted">
                  One-time fee to get you started at PPL. This covers your initial assessment, personalized program setup, and training plan.
                </p>
              </div>

              <div className="p-4 rounded-lg bg-surface border border-border">
                <div className="flex justify-between items-center">
                  <span className="font-medium text-foreground">PPL Onboarding Fee</span>
                  <span className="text-2xl font-bold text-foreground">$300</span>
                </div>
                <p className="text-xs text-muted mt-1">One-time payment â secure checkout via Stripe</p>
              </div>

              <button
                type="button"
                onClick={handlePaymentCheckout}
                disabled={isLoading}
                className="ppl-btn ppl-btn-primary w-full py-3 text-base"
              >
                {isLoading ? 'Setting up payment...' : 'Pay $300 & Continue'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setStep(2);
                  setAthleteSelection('');
                  setRequiresPayment(false);
                }}
                className="w-full text-center text-sm text-muted hover:text-foreground transition-colors"
              >
                Go back and change selection
              </button>
            </div>
          )}

          {/* ============================================ */}
          {/* STEP 4: Training Preference                  */}
          {/* ============================================ */}
          {step === 4 && (
            <div className="space-y-5">
              {paymentConfirmed && (
                <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm mb-2">
                  Payment confirmed! Now let us know how you&apos;d like to train.
                </div>
              )}

              <div>
                <h2 className="text-lg font-semibold text-foreground mb-1">How would you like to train?</h2>
                <p className="text-sm text-muted">
                  Choose your preferred training style. You can always change this later in your profile settings.
                </p>
              </div>

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setTrainingPreference('IN_PERSON')}
                  className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                    trainingPreference === 'IN_PERSON'
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-border-light'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      trainingPreference === 'IN_PERSON' ? 'border-primary' : 'border-muted'
                    }`}>
                      {trainingPreference === 'IN_PERSON' && (
                        <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                      )}
                    </div>
                    <span className="font-semibold text-foreground text-base">In-Person</span>
                  </div>
                  <p className="text-sm text-muted ml-8">
                    Train on-site at your PPL location with hands-on coaching.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setTrainingPreference('REMOTE')}
                  className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                    trainingPreference === 'REMOTE'
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-border-light'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      trainingPreference === 'REMOTE' ? 'border-primary' : 'border-muted'
                    }`}>
                      {trainingPreference === 'REMOTE' && (
                        <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                      )}
                    </div>
                    <span className="font-semibold text-foreground text-base">Remote</span>
                  </div>
                  <p className="text-sm text-muted ml-8">
                    Train virtually with video check-ins and remote programming from your PPL coach.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setTrainingPreference('HYBRID')}
                  className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                    trainingPreference === 'HYBRID'
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-border-light'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      trainingPreference === 'HYBRID' ? 'border-primary' : 'border-muted'
                    }`}>
                      {trainingPreference === 'HYBRID' && (
                        <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                      )}
                    </div>
                    <span className="font-semibold text-foreground text-base">Hybrid</span>
                  </div>
                  <p className="text-sm text-muted ml-8">
                    Mix of in-person sessions and remote training â the best of both worlds.
                  </p>
                </button>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(requiresPayment ? 3 : 2)}
                  className="ppl-btn ppl-btn-secondary flex-1 py-3"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!trainingPreference) {
                      setError('Please select your training preference');
                      return;
                    }
                    setError('');
                    setStep(5);
                  }}
                  disabled={!trainingPreference}
                  className="ppl-btn ppl-btn-primary flex-1 py-3 text-base"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* ============================================ */}
          {/* STEP 5: Location + Age Group                 */}
          {/* ============================================ */}
          {step === 5 && (
            <form onSubmit={handleFinalSubmit} className="space-y-4">
              <h2 className="text-lg font-semibold text-foreground mb-2">
                {trainingPreference === 'REMOTE' ? 'Home Base & Age Group' : 'Training Details'}
              </h2>
              {trainingPreference === 'REMOTE' && (
                <p className="text-sm text-muted -mt-1 mb-2">
                  Even as a remote athlete, pick a home location for check-ins and coach assignments.
                </p>
              )}

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
                          ? 'border-primary bg-primary/10'
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
                          ? 'border-primary bg-primary/10'
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
                <button
                  type="button"
                  onClick={() => setStep(4)}
                  className="ppl-btn ppl-btn-secondary flex-1 py-3"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="ppl-btn ppl-btn-primary flex-1 py-3 text-base"
                >
                  {isLoading ? 'Setting up...' : isOAuthOnboarding ? 'Complete Setup' : 'Create Account'}
                </button>
              </div>
            </form>
          )}

          <div className="mt-6 text-center">
            <p className="text-sm text-muted">
              Already have an account?{' '}
              <Link href="/login" className="text-accent-text hover:text-primary-text transition-colors">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
