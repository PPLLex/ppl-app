'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { api, Location, MembershipPlan, SubscribeResult } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Script from 'next/script';
import StripeCheckout from '@/components/payments/StripeCheckout';

// ---------------------------------------------------------------------------
// PPL registration — 6-step onboarding.
//
//   1  Playing Level          — the big determinant for every later screen
//   2  People on this account — parent + athlete fields adapting to step 1
//   3  New / Returning        — reveals the $300 onboarding fee up front
//   4  Training Setup         — location + in-person/remote/hybrid preference
//   5  Membership Plan        — plans filtered by playing level
//   6  Checkout               — Stripe Elements for the weekly subscription
//
// Rules enforced client-side (and re-validated server-side in POST /register):
//   • Youth and Middle/High School MUST have a parent/guardian account.
//     The parent becomes the primary login; the athlete gets a linked profile.
//   • College may register solo with an explicit self-management checkbox.
//     Otherwise a parent is attached.
//   • Pro always registers solo, no parent step.
//
// Ordering notes for humans reading this file:
//   • We intentionally lead with Playing Level (soft one-click question)
//     before asking anyone to type — it sets every downstream field.
//   • "People on this account" is deliberately the densest screen. One
//     heavy form is less friction than three light ones.
//   • The $300 onboarding fee uses the existing Stripe Checkout redirect
//     mid-flow. We come back to step 4 via ?step=after-fee&payment=success.
//   • The weekly subscription uses Stripe Elements (inline) on step 6 so
//     the user never leaves the register page for the final charge.
// ---------------------------------------------------------------------------

type PlayingLevel = 'youth' | 'ms_hs' | 'college' | 'pro';
type AthleteSelection = 'new' | 'returning' | 'youth_graduate' | 'free_assessment';
type TrainingPref = 'IN_PERSON' | 'REMOTE' | 'HYBRID';

const LEVEL_LABEL: Record<PlayingLevel, string> = {
  youth: 'Youth',
  ms_hs: 'Middle School / High School',
  college: 'College',
  pro: 'Pro',
};

const LEVEL_DESC: Record<PlayingLevel, string> = {
  youth: '12 and under',
  ms_hs: 'Ages 13–18',
  college: 'College athletes',
  pro: 'Professional athletes',
};

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
  const { loginWithGoogle } = useAuth();

  // URL params — let the user return to the right step after a $300 Stripe
  // Checkout redirect, and let OAuth users jump into onboarding mid-flow.
  const oauthProvider = searchParams.get('oauth');
  const stepParam = searchParams.get('step');
  const paymentStatus = searchParams.get('payment');

  const getInitialStep = (): number => {
    if (stepParam === 'after-fee' && paymentStatus === 'success') return 4;
    if (oauthProvider) return 3; // OAuth user — account already exists, needs rest
    return 1;
  };

  const [step, setStep] = useState<number>(getInitialStep);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Step 1
  const [playingLevel, setPlayingLevel] = useState<PlayingLevel | ''>('');

  // Step 2 — people on this account
  const [parentFirstName, setParentFirstName] = useState('');
  const [parentLastName, setParentLastName] = useState('');
  const [parentEmail, setParentEmail] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [athleteFirstName, setAthleteFirstName] = useState('');
  const [athleteLastName, setAthleteLastName] = useState('');
  const [athleteEmail, setAthleteEmail] = useState('');
  const [athleteDob, setAthleteDob] = useState('');
  const [athletePhone, setAthletePhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [collegeOptOut, setCollegeOptOut] = useState(false);

  // Step 3 / 4 / 5
  const [athleteSelection, setAthleteSelection] = useState<AthleteSelection | ''>('');
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState('');
  const [trainingPreference, setTrainingPreference] = useState<TrainingPref | ''>('');
  const [plans, setPlans] = useState<MembershipPlan[]>([]);

  // Step 6 (Stripe Elements)
  const [checkoutData, setCheckoutData] = useState<SubscribeResult | null>(null);

  // Google Sign-In setup
  const [googleLoaded, setGoogleLoaded] = useState(false);

  // Derived — who's on the account and who's primary
  const needsParent = playingLevel === 'youth' || playingLevel === 'ms_hs';
  const isCollege = playingLevel === 'college';
  const isPro = playingLevel === 'pro';
  const hasParent = needsParent || (isCollege && !collegeOptOut && parentEmail.trim().length > 0);
  const primaryEmail = hasParent ? parentEmail.trim().toLowerCase() : athleteEmail.trim().toLowerCase();
  const primaryFullName = hasParent
    ? `${parentFirstName} ${parentLastName}`.trim()
    : `${athleteFirstName} ${athleteLastName}`.trim();
  const primaryPhone = hasParent ? parentPhone : athletePhone;

  // Load locations once
  useEffect(() => {
    api.getLocations().then((res) => {
      if (res.data) setLocations(res.data);
    });
  }, []);

  // Load membership plans when we reach step 5
  useEffect(() => {
    if (step === 5 && plans.length === 0) {
      api.getMembershipPlans().then((res) => {
        if (res.data) setPlans(res.data);
      });
    }
  }, [step, plans.length]);

  // Confirm the $300 onboarding fee after returning from Stripe Checkout
  useEffect(() => {
    if (stepParam === 'after-fee' && paymentStatus === 'success') {
      api.confirmOnboardingPayment().catch(() => { /* non-fatal */ });
    }
  }, [stepParam, paymentStatus]);

  // Google Sign-In
  const handleGoogleResponse = useCallback(async (response: { credential: string }) => {
    setError('');
    setIsLoading(true);
    try {
      const result = await loginWithGoogle(response.credential);
      if (result.isNewUser) setStep(3);
      else router.push('/client');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-up failed');
    } finally {
      setIsLoading(false);
    }
  }, [loginWithGoogle, router]);

  useEffect(() => {
    if (!googleLoaded || step !== 2) return;
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) return;
    // @ts-expect-error - Google Identity Services global
    if (window.google?.accounts?.id) {
      // @ts-expect-error
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleResponse,
        auto_select: false,
      });
      const container = document.getElementById('google-signup-btn');
      if (container) {
        // @ts-expect-error
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

  // --------------------------------------------------------------------
  // STEP HANDLERS
  // --------------------------------------------------------------------

  const handleStep1Select = (level: PlayingLevel) => {
    setPlayingLevel(level);
    setError('');
    setStep(2);
  };

  const handleStep2Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!athleteFirstName.trim() || !athleteLastName.trim()) {
      setError("Please enter the athlete's first and last name.");
      return;
    }

    if (needsParent) {
      if (!parentFirstName.trim() || !parentLastName.trim()) {
        setError("Please enter the parent/guardian's first and last name.");
        return;
      }
      if (!parentEmail.trim()) {
        setError("Please enter the parent/guardian's email — this will be the login.");
        return;
      }
      if (!parentPhone.trim()) {
        setError("Please enter a parent/guardian phone number.");
        return;
      }
    } else {
      if (!athleteEmail.trim()) {
        setError("Please enter the athlete's email — this will be the login.");
        return;
      }
      if (!athletePhone.trim()) {
        setError("Please enter the athlete's phone number.");
        return;
      }
      if (isCollege && !parentEmail.trim() && !collegeOptOut) {
        setError(
          'Either provide a parent/guardian email OR tick the self-management box below.'
        );
        return;
      }
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsLoading(true);
    try {
      const registerPayload = {
        email: primaryEmail,
        password,
        fullName: primaryFullName,
        phone: primaryPhone,
        locationId: '', // will be set on step 4
        ageGroup: playingLevel || undefined,
        registeringAs: (hasParent ? 'PARENT' : 'SELF') as 'SELF' | 'PARENT',
        ...(hasParent && {
          athleteFirstName,
          athleteLastName,
          athleteDateOfBirth: athleteDob || undefined,
        }),
        ...(isCollege && !hasParent && collegeOptOut && { parentOptOut: true }),
      };

      const res = await api.register(registerPayload);
      if (res.data?.token) {
        localStorage.setItem('ppl_token', res.data.token);
      }
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your account.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStep3Select = async (sel: AthleteSelection) => {
    setAthleteSelection(sel);
    setError('');
    setIsLoading(true);
    try {
      const res = await api.setOnboardingStatus(sel);
      if (res.data?.requiresPayment) {
        // Redirect to the existing Stripe Checkout for the $300 fee.
        const checkoutRes = await api.createOnboardingCheckout();
        if (checkoutRes.data && 'checkoutUrl' in checkoutRes.data && checkoutRes.data.checkoutUrl) {
          window.location.href = checkoutRes.data.checkoutUrl;
          return;
        }
      }
      // Returning / Youth Graduate / Free Assessment — skip the fee.
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your status.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStep4Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!locationId) {
      setError('Please pick a training location.');
      return;
    }
    if (!trainingPreference) {
      setError('Please pick how you plan to train.');
      return;
    }
    setIsLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await api.updateProfile({
        homeLocationId: locationId,
        clientProfile: { ageGroup: playingLevel || undefined },
        trainingPreference,
      } as any);
      setStep(5);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your preferences.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStep5Select = async (planId: string) => {
    setError('');
    setIsLoading(true);
    try {
      const res = await api.subscribe(planId);
      if (res.data) {
        setCheckoutData(res.data);
        setStep(6);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start subscription.');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePaymentSuccess = () => {
    router.push('/client/book');
  };

  // --------------------------------------------------------------------
  // FILTERED PLANS (only those matching the playing level)
  // --------------------------------------------------------------------
  const relevantPlans = plans.filter((p) => {
    if (!playingLevel) return true;
    // Match ageGroup to playingLevel. Pro athletes currently use the ms_hs
    // plans (Unlimited / 1x week) until we split out a pro tier.
    if (playingLevel === 'pro') return p.ageGroup === 'ms_hs' || p.ageGroup === 'college';
    return p.ageGroup === playingLevel;
  });

  // --------------------------------------------------------------------
  // RENDER
  // --------------------------------------------------------------------

  const stepHeading = (() => {
    switch (step) {
      case 1: return 'What level are you playing at?';
      case 2: return 'Who\u2019s on this account?';
      case 3: return 'Have you trained at PPL before?';
      case 4: return 'Where and how will you train?';
      case 5: return 'Pick your membership';
      case 6: return 'Complete payment';
      default: return 'Join PPL';
    }
  })();

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={() => setGoogleLoaded(true)}
      />

      <div className="w-full max-w-md">
        {/* Logo + title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full ppl-gradient mb-4">
            <span className="text-white text-3xl font-bold">P</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">Join PPL</h1>
          <p className="text-muted mt-1">{stepHeading}</p>
        </div>

        {/* Progress indicator */}
        <div className="flex items-center gap-2 mb-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full ${
                step > i ? 'ppl-gradient' : 'bg-border'
              }`}
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
          {/* STEP 1 — Playing Level                       */}
          {/* ============================================ */}
          {step === 1 && (
            <div className="space-y-2.5">
              <p className="text-sm text-muted mb-2">
                One quick question before we get into details. This helps us
                show you the right options for everything that follows.
              </p>
              {(['youth', 'ms_hs', 'college', 'pro'] as PlayingLevel[]).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => handleStep1Select(lvl)}
                  className="w-full text-left p-4 rounded-xl border-2 border-border hover:border-border-light bg-surface transition-all"
                >
                  <div className="font-bold text-foreground text-base leading-tight">
                    {LEVEL_LABEL[lvl]}
                  </div>
                  <div className="text-xs text-muted/80 mt-1.5 font-normal">
                    {LEVEL_DESC[lvl]}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* ============================================ */}
          {/* STEP 2 — People on this account              */}
          {/* ============================================ */}
          {step === 2 && (
            <>
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm text-muted">
                  Selected: <strong className="text-foreground">{LEVEL_LABEL[playingLevel as PlayingLevel] || ''}</strong>
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setStep(1);
                    setError('');
                  }}
                  className="text-xs text-accent-text hover:underline"
                >
                  Change
                </button>
              </div>

              {/* OAuth buttons — optional shortcut */}
              <div className="space-y-2 mb-5">
                <div id="google-signup-btn" className="flex justify-center [&>div]:!w-full" />
              </div>
              <div className="relative mb-5">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="px-3 bg-surface text-muted">or sign up with email</span>
                </div>
              </div>

              <form onSubmit={handleStep2Submit} className="space-y-5">
                {/* Athlete block */}
                <section>
                  <h3 className="text-sm font-semibold text-foreground mb-2">
                    {needsParent ? "Your athlete" : 'Athlete information'}
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted block mb-1">First name</label>
                      <input
                        type="text"
                        value={athleteFirstName}
                        onChange={(e) => setAthleteFirstName(e.target.value)}
                        className="ppl-input"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted block mb-1">Last name</label>
                      <input
                        type="text"
                        value={athleteLastName}
                        onChange={(e) => setAthleteLastName(e.target.value)}
                        className="ppl-input"
                        required
                      />
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted block mb-1">Date of birth <span className="opacity-70">(optional)</span></label>
                      <input
                        type="date"
                        value={athleteDob}
                        onChange={(e) => setAthleteDob(e.target.value)}
                        className="ppl-input"
                      />
                    </div>
                    {playingLevel !== 'youth' && (
                      <div>
                        <label className="text-xs text-muted block mb-1">
                          Email {needsParent && <span className="opacity-70">(optional)</span>}
                        </label>
                        <input
                          type="email"
                          value={athleteEmail}
                          onChange={(e) => setAthleteEmail(e.target.value)}
                          className="ppl-input"
                          placeholder="athlete@example.com"
                          required={!needsParent}
                        />
                      </div>
                    )}
                  </div>
                  {!needsParent && (
                    <div className="mt-3">
                      <label className="text-xs text-muted block mb-1">Phone</label>
                      <input
                        type="tel"
                        value={athletePhone}
                        onChange={(e) => setAthletePhone(e.target.value)}
                        className="ppl-input"
                        required
                      />
                    </div>
                  )}
                </section>

                {/* Parent block — always shown for youth/ms_hs; collapsible for college */}
                {(needsParent || isCollege) && (
                  <section>
                    <h3 className="text-sm font-semibold text-foreground mb-2">
                      Parent or guardian {isCollege && <span className="text-xs text-muted font-normal">(optional for College)</span>}
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-muted block mb-1">First name</label>
                        <input
                          type="text"
                          value={parentFirstName}
                          onChange={(e) => setParentFirstName(e.target.value)}
                          className="ppl-input"
                          required={needsParent}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted block mb-1">Last name</label>
                        <input
                          type="text"
                          value={parentLastName}
                          onChange={(e) => setParentLastName(e.target.value)}
                          className="ppl-input"
                          required={needsParent}
                        />
                      </div>
                    </div>
                    <div className="mt-3">
                      <label className="text-xs text-muted block mb-1">Email</label>
                      <input
                        type="email"
                        value={parentEmail}
                        onChange={(e) => setParentEmail(e.target.value)}
                        className="ppl-input"
                        placeholder="parent@example.com"
                        required={needsParent}
                      />
                      {needsParent && (
                        <p className="text-[11px] text-muted mt-1">
                          This will be the account login. You&apos;ll manage billing and scheduling.
                        </p>
                      )}
                    </div>
                    <div className="mt-3">
                      <label className="text-xs text-muted block mb-1">Phone</label>
                      <input
                        type="tel"
                        value={parentPhone}
                        onChange={(e) => setParentPhone(e.target.value)}
                        className="ppl-input"
                        required={needsParent}
                      />
                    </div>
                  </section>
                )}

                {/* College-only self-management acknowledgment */}
                {isCollege && !parentEmail.trim() && (
                  <label className="flex gap-3 p-3 rounded-xl border border-border bg-surface cursor-pointer">
                    <input
                      type="checkbox"
                      checked={collegeOptOut}
                      onChange={(e) => setCollegeOptOut(e.target.checked)}
                      className="mt-0.5 accent-highlight"
                    />
                    <span className="text-xs text-foreground/90 leading-snug">
                      I&apos;m managing this account myself — I understand I&apos;m responsible
                      for my own scheduling, cancellations, and billing.
                    </span>
                  </label>
                )}

                {/* Password (primary login) */}
                <section>
                  <h3 className="text-sm font-semibold text-foreground mb-2">
                    Create a password
                  </h3>
                  <p className="text-[11px] text-muted mb-2">
                    This is the login for <strong className="text-foreground">{primaryEmail || 'your email'}</strong>.
                    At least 8 characters.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Password"
                      className="ppl-input"
                      required
                      minLength={8}
                    />
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm"
                      className="ppl-input"
                      required
                      minLength={8}
                    />
                  </div>
                </section>

                <div className="flex gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="ppl-btn ppl-btn-secondary flex-1 py-3"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="ppl-btn ppl-btn-primary flex-1 py-3 text-base"
                  >
                    {isLoading ? 'Creating…' : 'Continue'}
                  </button>
                </div>
              </form>
            </>
          )}

          {/* ============================================ */}
          {/* STEP 3 — New / Returning                     */}
          {/* ============================================ */}
          {step === 3 && (
            <div className="space-y-2.5">
              <p className="text-sm text-muted mb-2">
                This helps us route you correctly. New athletes pay a one-time
                <strong className="text-foreground"> $300 onboarding fee</strong>.
                Returning athletes and partner-school players don&apos;t.
              </p>
              {(
                [
                  { v: 'new' as const, label: 'New to PPL', desc: 'First-time athlete — includes the $300 onboarding fee.' },
                  { v: 'returning' as const, label: 'Returning athlete', desc: 'I\u2019ve trained at PPL before — no onboarding fee.' },
                  { v: 'youth_graduate' as const, label: 'PPL Youth graduate', desc: 'I moved up from the Youth program to 13+.' },
                  { v: 'free_assessment' as const, label: 'Free assessment', desc: 'I was invited for a complimentary assessment.' },
                ]
              ).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => handleStep3Select(opt.v)}
                  disabled={isLoading}
                  className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                    athleteSelection === opt.v
                      ? 'border-highlight bg-highlight/10'
                      : 'border-border hover:border-border-light bg-surface'
                  } ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div className="font-bold text-foreground text-base leading-tight">
                    {opt.label}
                  </div>
                  <div className="text-xs text-muted/80 mt-1.5 font-normal">
                    {opt.desc}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* ============================================ */}
          {/* STEP 4 — Location + Training Preference      */}
          {/* ============================================ */}
          {step === 4 && (
            <form onSubmit={handleStep4Submit} className="space-y-5">
              <section>
                <h3 className="text-sm font-semibold text-foreground mb-2">Training location</h3>
                <div className="space-y-2">
                  {locations.map((loc) => (
                    <button
                      key={loc.id}
                      type="button"
                      onClick={() => setLocationId(loc.id)}
                      className={`w-full text-left p-3.5 rounded-xl border-2 transition-all ${
                        locationId === loc.id
                          ? 'border-highlight bg-highlight/10'
                          : 'border-border hover:border-border-light bg-surface'
                      }`}
                    >
                      <div className="font-bold text-foreground text-sm leading-tight">{loc.name}</div>
                      {loc.address && (
                        <div className="text-xs text-muted/80 mt-1 font-normal">{loc.address}</div>
                      )}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-foreground mb-2">How will you train?</h3>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { v: 'IN_PERSON' as const, label: 'In person' },
                      { v: 'REMOTE' as const, label: 'Remote' },
                      { v: 'HYBRID' as const, label: 'Hybrid' },
                    ]
                  ).map((pref) => (
                    <button
                      key={pref.v}
                      type="button"
                      onClick={() => setTrainingPreference(pref.v)}
                      className={`p-3 rounded-xl border-2 text-sm font-medium transition-all ${
                        trainingPreference === pref.v
                          ? 'border-highlight bg-highlight/10 text-foreground'
                          : 'border-border hover:border-border-light bg-surface text-foreground/90'
                      }`}
                    >
                      {pref.label}
                    </button>
                  ))}
                </div>
              </section>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="ppl-btn ppl-btn-secondary flex-1 py-3"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="ppl-btn ppl-btn-primary flex-1 py-3 text-base"
                >
                  {isLoading ? 'Saving…' : 'Continue'}
                </button>
              </div>
            </form>
          )}

          {/* ============================================ */}
          {/* STEP 5 — Pick Membership                     */}
          {/* ============================================ */}
          {step === 5 && (
            <div className="space-y-2.5">
              <p className="text-sm text-muted mb-2">
                Plans shown below match your playing level. Weekly billing starts the first
                time you&apos;re charged; cancellation is request-based.
              </p>
              {relevantPlans.length === 0 ? (
                <div className="p-4 rounded-xl border border-border bg-surface text-sm text-muted">
                  Loading plans…
                </div>
              ) : (
                relevantPlans.map((plan) => (
                  <button
                    key={plan.id}
                    type="button"
                    onClick={() => handleStep5Select(plan.id)}
                    disabled={isLoading}
                    className={`w-full text-left p-4 rounded-xl border-2 border-border hover:border-border-light bg-surface transition-all ${
                      isLoading ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-foreground text-base leading-tight">
                          {plan.name}
                        </div>
                        {plan.description && (
                          <div className="text-xs text-muted/80 mt-1.5 font-normal leading-snug">
                            {plan.description}
                          </div>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-xl font-bold text-accent-text">
                          ${(plan.priceCents / 100).toFixed(0)}
                        </div>
                        <div className="text-[11px] text-muted">/ week</div>
                      </div>
                    </div>
                  </button>
                ))
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setStep(4)}
                  className="ppl-btn ppl-btn-secondary flex-1 py-3"
                >
                  Back
                </button>
              </div>
            </div>
          )}

          {/* ============================================ */}
          {/* STEP 6 — Stripe Checkout                     */}
          {/* ============================================ */}
          {step === 6 && checkoutData && (
            <StripeCheckout
              clientSecret={checkoutData.clientSecret}
              planName={plans.find((p) => p.id === relevantPlans.find((r) => r.id)?.id)?.name || 'PPL Membership'}
              priceCents={0 /* actual price comes from the subscription */}
              billingDay={checkoutData.billingDay}
              onSuccess={handlePaymentSuccess}
              onCancel={() => setStep(5)}
            />
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
