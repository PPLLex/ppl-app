'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { api, Location, MembershipPlan } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Script from 'next/script';
import StripeCheckout from '@/components/payments/StripeCheckout';

export default function JoinPage() {
  return (
    <Suspense>
      <JoinFlow />
    </Suspense>
  );
}

/* ------------------------------------------------------------------ */
/*  Step labels for progress bar                                       */
/* ------------------------------------------------------------------ */
const STEPS = ['Account', 'Details', 'Plan', 'Payment'];

/* ------------------------------------------------------------------ */
/*  Age-group helpers                                                   */
/* ------------------------------------------------------------------ */
const AGE_GROUPS = [
  { value: 'youth', label: 'Youth', desc: 'Ages 12 & Under' },
  { value: 'ms_hs', label: 'Middle School / High School', desc: 'Ages 13-18' },
  { value: 'college', label: 'College', desc: 'Current College Players or Incoming College Freshmen' },
];

/* ------------------------------------------------------------------ */
/*  Main flow                                                           */
/* ------------------------------------------------------------------ */
function JoinFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loginWithGoogle, routeByRole, user, refreshUser } = useAuth();
  const { branding } = useTheme();

  // OAuth returning users land on step=2
  const oauthProvider = searchParams.get('oauth');
  const startStep = searchParams.get('step') === '2' && oauthProvider ? 2 : 1;

  const [step, setStep] = useState(startStep);
  const [locations, setLocations] = useState<Location[]>([]);
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [googleLoaded, setGoogleLoaded] = useState(false);

  // Step 1 - account fields
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Step 2 - details
  const [locationId, setLocationId] = useState('');
  const [ageGroup, setAgeGroup] = useState('');

  // Step 3 - plan
  const [selectedPlan, setSelectedPlan] = useState<MembershipPlan | null>(null);

  // Step 4 - Stripe
  const [clientSecret, setClientSecret] = useState('');
  const [billingDay, setBillingDay] = useState('');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [subscriptionId, setSubscriptionId] = useState('');

  // Success screen
  const [showSuccess, setShowSuccess] = useState(false);

  const isOAuthOnboarding = startStep === 2 && oauthProvider;

  /* ---------- load reference data ---------- */
  useEffect(() => {
    api.getLocations().then((res) => {
      if (res.data) setLocations(res.data);
    });
    api.getMembershipPlans().then((res) => {
      if (res.data) setPlans(res.data.filter((p) => p.isActive));
    });
  }, []);

  /* ---------- Google Sign-In ---------- */
  const handleGoogleResponse = useCallback(
    async (response: { credential: string }) => {
      setError('');
      setIsLoading(true);
      try {
        const result = await loginWithGoogle(response.credential);
        if (result.isNewUser) {
          setStep(2);
        } else {
          // existing user - skip to plan selection
          setStep(3);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Google sign-up failed';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [loginWithGoogle]
  );

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
      const container = document.getElementById('google-join-btn');
      if (container) {
        // @ts-expect-error - Google Identity Services
        window.google.accounts.id.renderButton(container, {
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

  /* ---------- step handlers ---------- */

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

  const handleStep2 = async (e: React.FormEvent) => {
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

    // If OAuth onboarding, update profile now
    if (isOAuthOnboarding && user) {
      setIsLoading(true);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await api.updateProfile({ homeLocationId: locationId, clientProfile: { ageGroup } } as any);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to save details';
        setError(message);
        setIsLoading(false);
        return;
      }
      setIsLoading(false);
    }

    setStep(3);
  };

  const handleSelectPlan = (plan: MembershipPlan) => {
    setSelectedPlan(plan);
  };

  const handleStep3 = async () => {
    if (!selectedPlan) {
      setError('Please select a membership plan');
      return;
    }
    setError('');
    setIsLoading(true);

    try {
      // If not yet registered (email/password flow), register first
      if (!user && !isOAuthOnboarding) {
        const regRes = await api.register({
          fullName,
          email,
          phone,
          password,
          locationId,
          ageGroup,
        });
        if (regRes.data) {
          localStorage.setItem('ppl_token', regRes.data.token);
          await refreshUser();
        }
      }

      // Now subscribe
      const subRes = await api.subscribe(selectedPlan.id);
      if (subRes.data) {
        setClientSecret(subRes.data.clientSecret);
        setBillingDay(subRes.data.billingDay);
        setSubscriptionId(subRes.data.subscriptionId);
        setStep(4);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePaymentSuccess = async () => {
    setShowSuccess(true);
    // refresh auth state so dashboard has membership info
    await refreshUser();
  };

  const handleSkipPayment = () => {
    // Allow people to skip payment and just create account
    router.push('/client');
  };

  /* ---------- filtered plans by age group ---------- */
  const filteredPlans = ageGroup
    ? plans.filter((p) => p.ageGroup === ageGroup || p.ageGroup === 'all')
    : plans;

  /* ---------- success screen ---------- */
  if (showSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-highlight/20 mb-6">
            <svg className="w-10 h-10 text-accent-text" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">You&apos;re All Set!</h1>
          <p className="text-muted mb-8">
            Your membership is active. You can now book training sessions and start crushing it.
          </p>
          <button
            onClick={() => router.push('/client')}
            className="ppl-btn ppl-btn-primary w-full py-3 text-base"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  /* ---------- render ---------- */
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={() => setGoogleLoaded(true)}
      />

      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          {branding.logoData ? (
            <div className="inline-flex items-center justify-center w-24 h-24 rounded-2xl overflow-hidden mb-4 shadow-lg shadow-emerald-900/20 ring-1 ring-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={branding.logoData}
                alt={branding.businessName}
                className="w-full h-full object-contain bg-white/5"
              />
            </div>
          ) : (
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full ppl-gradient mb-4">
              <span className="text-white text-3xl font-bold">P</span>
            </div>
          )}
          <h1 className="text-2xl font-bold text-foreground">Join {branding.businessName || 'PPL'}</h1>
          <p className="text-muted mt-1">
            {step === 1 && 'Create your account to start training'}
            {step === 2 && 'Tell us a bit about yourself'}
            {step === 3 && 'Choose your membership plan'}
            {step === 4 && 'Complete your payment'}
          </p>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-1.5 mb-2">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                i + 1 <= step ? 'ppl-gradient' : 'bg-border'
              }`}
            />
          ))}
        </div>
        <div className="flex justify-between mb-6">
          {STEPS.map((label, i) => (
            <span
              key={label}
              className={`text-xs font-medium transition-colors ${
                i + 1 <= step ? 'text-accent-text' : 'text-muted'
              }`}
            >
              {label}
            </span>
          ))}
        </div>

        <div className="ppl-card">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">
              {error}
            </div>
          )}

          {/* ============ STEP 1 - Account ============ */}
          {step === 1 && (
            <>
              {/* Social sign-up */}
              <div className="space-y-3 mb-6">
                <div id="google-join-btn" className="flex justify-center [&>div]:!w-full" />
                <button
                  type="button"
                  onClick={() => setError('Apple Sign-In is coming soon!')}
                  className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg border border-border bg-white text-black font-medium text-sm hover:bg-gray-50 transition-colors"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                  </svg>
                  Sign up with Apple
                </button>
              </div>

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
                  <label htmlFor="joinName" className="block text-sm font-medium text-foreground mb-1.5">
                    Full Name
                  </label>
                  <input
                    id="joinName"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="John Smith"
                    className="ppl-input"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="joinEmail" className="block text-sm font-medium text-foreground mb-1.5">
                    Email
                  </label>
                  <input
                    id="joinEmail"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="ppl-input"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="joinPhone" className="block text-sm font-medium text-foreground mb-1.5">
                    Phone Number
                  </label>
                  <input
                    id="joinPhone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(555) 123-4567"
                    className="ppl-input"
                  />
                </div>

                <div>
                  <label htmlFor="joinPassword" className="block text-sm font-medium text-foreground mb-1.5">
                    Password
                  </label>
                  <input
                    id="joinPassword"
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
                  <label htmlFor="joinConfirmPw" className="block text-sm font-medium text-foreground mb-1.5">
                    Confirm Password
                  </label>
                  <input
                    id="joinConfirmPw"
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

          {/* ============ STEP 2 - Details ============ */}
          {step === 2 && (
            <form onSubmit={handleStep2} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Select Your Training Location
                </label>
                <div className="space-y-2">
                  {locations.map((loc) => (
                    <button
                      key={loc.id}
                      type="button"
                      onClick={() => setLocationId(loc.id)}
                      className={`w-full text-left p-3 rounded-lg border transition-all ${
                        locationId === loc.id
                          ? 'border-highlight bg-highlight/10'
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
                  {AGE_GROUPS.map((group) => (
                    <button
                      key={group.value}
                      type="button"
                      onClick={() => {
                        setAgeGroup(group.value);
                        setSelectedPlan(null); // reset plan when age changes
                      }}
                      className={`w-full text-left p-3 rounded-lg border transition-all ${
                        ageGroup === group.value
                          ? 'border-highlight bg-highlight/10'
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
                  {isLoading ? 'Saving...' : 'Continue'}
                </button>
              </div>
            </form>
          )}

          {/* ============ STEP 3 - Membership Plan ============ */}
          {step === 3 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold text-foreground">Choose Your Plan</h2>

              {filteredPlans.length === 0 && (
                <p className="text-muted text-sm py-4 text-center">
                  No plans available for this age group yet. Check back soon!
                </p>
              )}

              <div className="space-y-3">
                {filteredPlans.map((plan) => {
                  const selected = selectedPlan?.id === plan.id;
                  return (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() => handleSelectPlan(plan)}
                      className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                        selected
                          ? 'border-highlight bg-highlight/10'
                          : 'border-border hover:border-border-light'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <span className="font-semibold text-foreground">{plan.name}</span>
                          {plan.description && (
                            <span className="block text-sm text-muted mt-1">{plan.description}</span>
                          )}
                          {plan.sessionsPerWeek && (
                            <span className="block text-xs text-muted mt-1">
                              {plan.sessionsPerWeek} session{plan.sessionsPerWeek > 1 ? 's' : ''} per week
                            </span>
                          )}
                        </div>
                        <div className="text-right ml-4 shrink-0">
                          <span className="text-2xl font-bold text-accent-text">
                            ${(plan.priceCents / 100).toFixed(0)}
                          </span>
                          <span className="block text-xs text-muted">
                            /{plan.billingCycle === 'WEEKLY' ? 'week' : 'month'}
                          </span>
                        </div>
                      </div>
                      {selected && (
                        <div className="mt-2 flex items-center gap-1.5 text-accent-text text-xs font-medium">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          Selected
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="ppl-btn ppl-btn-secondary flex-1 py-3"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleStep3}
                  disabled={!selectedPlan || isLoading}
                  className="ppl-btn ppl-btn-primary flex-1 py-3 text-base"
                >
                  {isLoading ? 'Setting up...' : 'Continue to Payment'}
                </button>
              </div>

              {/* Skip option - just create account without paying */}
              <button
                type="button"
                onClick={handleSkipPayment}
                className="w-full text-center text-sm text-muted hover:text-foreground transition-colors mt-2"
              >
                Skip for now &mdash; I&apos;ll choose a plan later
              </button>
            </div>
          )}

          {/* Step 4 shows waiting message inside card while modal overlays */}
          {step === 4 && (
            <div className="text-center py-6">
              <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full mx-auto mb-3" />
              <p className="text-muted text-sm">Complete your payment in the window above...</p>
              <button
                type="button"
                onClick={() => setStep(3)}
                className="text-sm text-muted hover:text-foreground mt-4 transition-colors"
              >
                Go back to plan selection
              </button>
            </div>
          )}

          {/* Footer link */}
          {step < 4 && (
            <div className="mt-6 text-center">
              <p className="text-sm text-muted">
                Already have an account?{' '}
                <Link href="/login" className="text-accent-text hover:text-primary-text transition-colors">
                  Sign in
                </Link>
              </p>
            </div>
          )}
        </div>

        {/* Stripe modal renders outside the card as a full-screen overlay */}
        {step === 4 && selectedPlan && clientSecret && (
          <StripeCheckout
            clientSecret={clientSecret}
            planName={selectedPlan.name}
            priceCents={selectedPlan.priceCents}
            billingDay={billingDay}
            onSuccess={handlePaymentSuccess}
            onCancel={() => setStep(3)}
          />
        )}
      </div>
    </div>
  );
}
