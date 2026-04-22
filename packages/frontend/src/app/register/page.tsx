'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { api, Location, MembershipPlan, SubscribeResult } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
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
  youth: 'Ages 12 & Under',
  ms_hs: 'Ages 13–18',
  college: 'Current College Players or Incoming College Freshmen',
  pro: 'MLB, MiLB, or Independent',
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
  const { branding } = useTheme();

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
  // MS/HS has a harder opt-out than College — TWO acknowledgments required,
  // because we really do expect most MS/HS kids to have a parent on the account.
  const [msHsSoloAck1, setMsHsSoloAck1] = useState(false);
  const [msHsSoloAck2, setMsHsSoloAck2] = useState(false);

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
  const isYouth = playingLevel === 'youth';
  const isMsHs = playingLevel === 'ms_hs';
  const isCollege = playingLevel === 'college';
  const isPro = playingLevel === 'pro';

  // MS/HS opt-out gate: must tick BOTH acknowledgments to go solo
  const msHsOptedOut = isMsHs && msHsSoloAck1 && msHsSoloAck2;

  // Parent section is visible whenever a parent/guardian MIGHT be attached
  const showsParentSection = isYouth || isMsHs || isCollege;

  // Parent fields are REQUIRED when:
  //   • Youth — always
  //   • MS/HS — unless the two opt-out boxes are both ticked
  //   • College — unless the single opt-out box is ticked
  const parentRequired =
    isYouth || (isMsHs && !msHsOptedOut) || (isCollege && !collegeOptOut);

  // Backwards-compat flag used by the rest of the code that cares whether
  // a parent account is being attached at all.
  const hasParent =
    parentRequired ||
    (isCollege && !collegeOptOut && parentEmail.trim().length > 0) ||
    (isMsHs && msHsOptedOut && parentEmail.trim().length > 0);

  const primaryEmail = hasParent ? parentEmail.trim().toLowerCase() : athleteEmail.trim().toLowerCase();
  const primaryFullName = hasParent
    ? `${parentFirstName} ${parentLastName}`.trim()
    : `${athleteFirstName} ${athleteLastName}`.trim();
  const primaryPhone = hasParent ? parentPhone : athletePhone;

  // If the user un-ticks the first box, always clear the second.
  useEffect(() => {
    if (!msHsSoloAck1 && msHsSoloAck2) setMsHsSoloAck2(false);
  }, [msHsSoloAck1, msHsSoloAck2]);

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

    // ──────────────────────────────────────────────────────────
    // Athlete required fields
    // ──────────────────────────────────────────────────────────
    if (!athleteFirstName.trim() || !athleteLastName.trim()) {
      setError("Please enter the athlete's first and last name.");
      return;
    }

    // ──────────────────────────────────────────────────────────
    // Parent/guardian required fields
    //   • Youth → parent ALWAYS required
    //   • MS/HS → parent required UNLESS BOTH solo-ack boxes ticked
    //   • College → parent required UNLESS single self-management opt-out
    //   • Pro → no parent section
    // ──────────────────────────────────────────────────────────
    if (parentRequired) {
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
    } else if (isMsHs && msHsOptedOut) {
      // MS/HS athlete managing the account themselves.
      if (!athleteEmail.trim()) {
        setError("Please enter the athlete's email — this will be the login.");
        return;
      }
      if (!athletePhone.trim()) {
        setError("Please enter the athlete's phone number.");
        return;
      }
      // If they entered ANY parent info, require all of it (same rule as College).
      const anyParentField =
        parentFirstName.trim() ||
        parentLastName.trim() ||
        parentEmail.trim() ||
        parentPhone.trim();
      if (
        anyParentField &&
        (!parentFirstName.trim() ||
          !parentLastName.trim() ||
          !parentEmail.trim() ||
          !parentPhone.trim())
      ) {
        setError(
          'Please fill in ALL parent/guardian fields, or clear them to finish signing up solo.'
        );
        return;
      }
    } else if (isCollege) {
      if (!athleteEmail.trim()) {
        setError("Please enter the athlete's email — this will be the login.");
        return;
      }
      if (!athletePhone.trim()) {
        setError("Please enter the athlete's phone number.");
        return;
      }
      const anyParentField =
        parentFirstName.trim() ||
        parentLastName.trim() ||
        parentEmail.trim() ||
        parentPhone.trim();
      if (anyParentField) {
        if (
          !parentFirstName.trim() ||
          !parentLastName.trim() ||
          !parentEmail.trim() ||
          !parentPhone.trim()
        ) {
          setError(
            'Please fill in ALL parent/guardian fields, or leave them blank and tick the self-management box below.'
          );
          return;
        }
      } else if (!collegeOptOut) {
        setError(
          'Either provide parent/guardian information OR tick the self-management box below.'
        );
        return;
      }
    } else {
      // Pro — solo only
      if (!athleteEmail.trim()) {
        setError("Please enter the athlete's email — this will be the login.");
        return;
      }
      if (!athletePhone.trim()) {
        setError("Please enter the athlete's phone number.");
        return;
      }
    }

    // ──────────────────────────────────────────────────────────
    // Athlete ≠ Parent/Guardian — block duplicate identity
    //   Runs only when a parent/guardian is actually attached.
    // ──────────────────────────────────────────────────────────
    const parentAttached =
      parentRequired ||
      (isCollege && parentEmail.trim().length > 0) ||
      (isMsHs && msHsOptedOut && parentEmail.trim().length > 0);
    if (parentAttached) {
      const aName = `${athleteFirstName.trim().toLowerCase()} ${athleteLastName.trim().toLowerCase()}`;
      const pName = `${parentFirstName.trim().toLowerCase()} ${parentLastName.trim().toLowerCase()}`;
      if (aName && pName && aName === pName) {
        setError(
          'The athlete and parent/guardian cannot have the same name. Please enter separate information for each.'
        );
        return;
      }

      const aEmail = athleteEmail.trim().toLowerCase();
      const pEmail = parentEmail.trim().toLowerCase();
      if (aEmail && pEmail && aEmail === pEmail) {
        setError(
          'The athlete and parent/guardian must have different email addresses.'
        );
        return;
      }

      const aPhoneDigits = athletePhone.replace(/\D/g, '');
      const pPhoneDigits = parentPhone.replace(/\D/g, '');
      if (aPhoneDigits && pPhoneDigits && aPhoneDigits === pPhoneDigits) {
        setError(
          'The athlete and parent/guardian must have different phone numbers.'
        );
        return;
      }
    }

    // ──────────────────────────────────────────────────────────
    // Password
    // ──────────────────────────────────────────────────────────
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
      case 1: return "What's Your Playing Level?";
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
        <div className="flex flex-col items-center text-center mb-8">
          {branding.logoData ? (
            <div className="flex items-center justify-center w-48 h-48 rounded-full overflow-hidden mb-5 shadow-xl shadow-emerald-900/25 ring-1 ring-border bg-white/5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={branding.logoData}
                alt={branding.businessName}
                className="w-full h-full object-contain"
              />
            </div>
          ) : (
            <div className="flex items-center justify-center w-48 h-48 rounded-full ppl-gradient mb-5">
              <span className="text-white text-6xl font-bold">P</span>
            </div>
          )}
          <h1 className="font-display text-xl sm:text-2xl font-bold tracking-[0.08em] text-foreground uppercase text-center leading-tight">
            Get Started with<br className="hidden sm:block" /> Pitching Performance Lab
          </h1>
          <p className="text-sm text-muted mt-2 text-center">{stepHeading}</p>
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

              <form onSubmit={handleStep2Submit} className="space-y-6">
                {/* ─── ATHLETE SECTION — PPL light green (#95C83C accent) ─── */}
                <section
                  className="rounded-xl overflow-hidden border-2 shadow-lg"
                  style={{
                    borderColor: 'color-mix(in srgb, var(--color-accent) 70%, transparent)',
                    backgroundColor: 'color-mix(in srgb, var(--color-accent) 8%, transparent)',
                    boxShadow: '0 10px 24px -12px color-mix(in srgb, var(--color-accent) 30%, transparent)',
                  }}
                >
                  {/* Bold banner header */}
                  <div
                    className="flex items-center gap-2.5 px-4 py-2.5 text-black"
                    style={{ backgroundColor: 'var(--color-accent)' }}
                  >
                    <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="8" r="4" />
                      <path d="M20 21a8 8 0 1 0-16 0" />
                    </svg>
                    <span className="font-display text-sm font-bold uppercase tracking-[0.15em]">
                      Step 1 — Athlete
                    </span>
                  </div>
                  <div className="p-4 space-y-3">
                    <p className="text-[11px] text-muted -mt-1">
                      The person who will be training at PPL.
                    </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted block mb-1">
                        Athlete first name<span className="text-[color:var(--color-accent)] ml-0.5">*</span>
                      </label>
                      <input
                        type="text"
                        value={athleteFirstName}
                        onChange={(e) => setAthleteFirstName(e.target.value)}
                        className="ppl-input"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted block mb-1">
                        Athlete last name<span className="text-[color:var(--color-accent)] ml-0.5">*</span>
                      </label>
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
                      <label className="text-xs text-muted block mb-1">
                        Date of birth<span className="text-[color:var(--color-accent)] ml-0.5">*</span>
                      </label>
                      <input
                        type="date"
                        value={athleteDob}
                        onChange={(e) => setAthleteDob(e.target.value)}
                        className="ppl-input"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted block mb-1">
                        Athlete email<span className="text-[color:var(--color-accent)] ml-0.5">*</span>
                      </label>
                      <input
                        type="email"
                        value={athleteEmail}
                        onChange={(e) => setAthleteEmail(e.target.value)}
                        className="ppl-input"
                        placeholder="athlete@example.com"
                        required
                      />
                    </div>
                  </div>
                  <div className="mt-3">
                    <label className="text-xs text-muted block mb-1">
                      Athlete phone<span className="text-[color:var(--color-accent)] ml-0.5">*</span>
                    </label>
                    <input
                      type="tel"
                      value={athletePhone}
                      onChange={(e) => setAthletePhone(e.target.value)}
                      className="ppl-input"
                      placeholder={parentRequired ? "Use parent's cell if athlete has none" : ''}
                      required
                    />
                  </div>
                  </div>
                </section>

                {/* ─── MS/HS SELF-MANAGEMENT GATE (between sections) ─────
                    Appears right after athlete info so solo athletes don't have
                    to scroll past the parent section first. Two checkboxes, second
                    only revealed after the first — a deliberately harder gate
                    than College because most MS/HS athletes DO have a parent
                    on the account. */}
                {isMsHs && (
                  <div className="space-y-2.5 rounded-xl border border-border bg-surface/60 p-3">
                    <p className="text-[11px] text-muted leading-snug">
                      Most MS/HS athletes register with a parent or guardian.
                      If you&apos;re managing this account by yourself, tick both boxes
                      below — otherwise please complete the parent/guardian fields
                      in Step&nbsp;2.
                    </p>
                    <label className="flex gap-3 p-3 rounded-lg border border-border bg-background cursor-pointer hover:border-[color:var(--color-primary)]/50 transition-colors">
                      <input
                        type="checkbox"
                        checked={msHsSoloAck1}
                        onChange={(e) => setMsHsSoloAck1(e.target.checked)}
                        className="mt-0.5 accent-[color:var(--color-primary)]"
                      />
                      <span className="text-xs text-foreground/90 leading-snug">
                        I&apos;m managing this account myself — I understand I&apos;m responsible
                        for my own scheduling, cancellations, and billing.
                      </span>
                    </label>
                    {msHsSoloAck1 && (
                      <label
                        className="flex gap-3 p-3 rounded-lg border-2 cursor-pointer"
                        style={{
                          borderColor: 'color-mix(in srgb, var(--color-primary) 60%, transparent)',
                          backgroundColor: 'color-mix(in srgb, var(--color-primary) 10%, transparent)',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={msHsSoloAck2}
                          onChange={(e) => setMsHsSoloAck2(e.target.checked)}
                          className="mt-0.5 accent-[color:var(--color-primary)]"
                        />
                        <span className="text-xs text-foreground leading-snug">
                          <strong>Are you 100% sure?</strong> All billing reminders,
                          payment issues, and cancellation windows will go to you — not to a parent.
                        </span>
                      </label>
                    )}
                  </div>
                )}

                {/* ─── COLLEGE SELF-MANAGEMENT GATE ───
                    Shown whenever playing level is College. Parent/Guardian
                    starts MANDATORY; checking this box fades + deactivates
                    the parent section above. */}
                {isCollege && (
                  <label
                    className="flex gap-3 p-3 rounded-xl border border-border bg-surface/60 cursor-pointer hover:border-[color:var(--color-primary)]/50 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={collegeOptOut}
                      onChange={(e) => setCollegeOptOut(e.target.checked)}
                      className="mt-0.5 accent-[color:var(--color-primary)]"
                    />
                    <span className="text-xs text-foreground/90 leading-snug">
                      I&apos;m managing this account myself — I understand I&apos;m responsible
                      for my own scheduling, cancellations, and billing.
                    </span>
                  </label>
                )}

                {/* ─── PARENT / GUARDIAN SECTION — PPL dark green (#5E9E50 primary) ─── */}
                {showsParentSection && (
                  <section
                    className={`rounded-xl overflow-hidden border-2 shadow-lg transition-opacity duration-300 ${
                      parentRequired ? 'opacity-100' : 'opacity-30'
                    }`}
                    style={{
                      borderColor: 'color-mix(in srgb, var(--color-primary) 70%, transparent)',
                      backgroundColor: 'color-mix(in srgb, var(--color-primary) 8%, transparent)',
                      boxShadow: '0 10px 24px -12px color-mix(in srgb, var(--color-primary) 30%, transparent)',
                    }}
                  >
                    {/* Bold banner header */}
                    <div
                      className="flex items-center gap-2.5 px-4 py-2.5 text-white"
                      style={{ backgroundColor: 'var(--color-primary)' }}
                    >
                      <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                      <span className="font-display text-sm font-bold uppercase tracking-[0.15em]">
                        Step 2 — Parent / Guardian
                      </span>
                      {!parentRequired && (
                        <span className="ml-auto text-[10px] font-semibold normal-case tracking-normal bg-white/15 px-2 py-0.5 rounded">
                          not required — solo mode
                        </span>
                      )}
                    </div>
                    <div className="p-4 space-y-3">
                      <p className="text-[11px] text-muted -mt-1">
                        {parentRequired
                          ? 'The parent or legal guardian responsible for this account.'
                          : "Who should we contact if we can't reach the athlete?"}
                      </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-muted block mb-1">
                          Parent/guardian first name
                          {parentRequired && <span className="text-[color:var(--color-primary-text)] ml-0.5">*</span>}
                        </label>
                        <input
                          type="text"
                          value={parentFirstName}
                          onChange={(e) => setParentFirstName(e.target.value)}
                          className="ppl-input"
                          required={parentRequired}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted block mb-1">
                          Parent/guardian last name
                          {parentRequired && <span className="text-[color:var(--color-primary-text)] ml-0.5">*</span>}
                        </label>
                        <input
                          type="text"
                          value={parentLastName}
                          onChange={(e) => setParentLastName(e.target.value)}
                          className="ppl-input"
                          required={parentRequired}
                        />
                      </div>
                    </div>
                    <div className="mt-3">
                      <label className="text-xs text-muted block mb-1">
                        Parent/guardian email
                        {parentRequired && <span className="text-[color:var(--color-primary-text)] ml-0.5">*</span>}
                      </label>
                      <input
                        type="email"
                        value={parentEmail}
                        onChange={(e) => setParentEmail(e.target.value)}
                        className="ppl-input"
                        placeholder="parent@example.com"
                        required={parentRequired}
                      />
                      {parentRequired && (
                        <p className="text-[11px] text-muted mt-1">
                          This will be the account login. You&apos;ll manage billing and scheduling.
                        </p>
                      )}
                    </div>
                    <div className="mt-3">
                      <label className="text-xs text-muted block mb-1">
                        Parent/guardian phone
                        {parentRequired && <span className="text-[color:var(--color-primary-text)] ml-0.5">*</span>}
                      </label>
                      <input
                        type="tel"
                        value={parentPhone}
                        onChange={(e) => setParentPhone(e.target.value)}
                        className="ppl-input"
                        required={parentRequired}
                      />
                    </div>
                    </div>
                  </section>
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
