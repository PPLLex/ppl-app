'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { api, Location, MembershipPlan, SubscribeResult } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Script from 'next/script';
import { toast } from 'sonner';
import StripeCheckout from '@/components/payments/StripeCheckout';
import { PasswordInput } from '@/components/auth/PasswordInput';
import { isCommonPassword } from '@/lib/common-passwords';
import { haptic } from '@/lib/haptic';
import { AnimatedPrice } from '@/components/AnimatedPrice';

/**
 * View Transitions API wrapper — crossfade/slide between steps rather than
 * a hard cut. Falls back to the raw setter on browsers without support
 * (older Safari / Firefox <127). The ::view-transition-* animations in
 * globals.css paint the transition.
 */
function transitionStep(fn: () => void) {
  // Newer TS DOM libs have startViewTransition; older ones don't. Gracefully
  // fall through on any browser missing the API (older Safari / Firefox <127).
  const doc = typeof document !== 'undefined'
    ? (document as Document & { startViewTransition?: (cb: () => void) => void })
    : null;
  if (doc?.startViewTransition) {
    doc.startViewTransition(fn);
  } else {
    fn();
  }
}

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

/**
 * Per-playing-level recommendation. The plan ID listed here gets a
 * "MOST POPULAR" badge on step 5 when that age group's plans are shown.
 * Intentionally hardcoded — these are business decisions (what PPL
 * wants to steer people toward), not data-driven.
 *
 * Recommendations (per Chad 2026-04-23):
 *   Youth   → Youth 1x/Week           (only option, reinforces the plan)
 *   MS/HS   → Unlimited Pitching      (flagship upgrade over 1x)
 *   College → Unlimited College       (only option)
 *   Pro     → Programming + Access    ($175/mo bundle, flagship Pro tier)
 *
 * If the user toggles "+ Add Hitting Training" on a recommended pitching
 * card, the combo sibling is considered the same recommendation (not a
 * downgrade). Matching is done on the BASE plan id regardless of toggle.
 */
const RECOMMENDED_PLAN_IDS: Record<PlayingLevel, string> = {
  youth: 'plan-youth-1x',
  ms_hs: 'plan-unlimited-pitching',
  college: 'plan-unlimited-college',
  pro: 'plan-pro-programming-access',
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
  const { branding, isLoaded: brandingLoaded } = useTheme();

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

  const [step, setStepRaw] = useState<number>(getInitialStep);
  // Wrap every step change in a View Transitions crossfade so moving between
  // steps feels like a premium app, not a hard cut. Works across ALL call
  // sites because we aliased the raw setter above — no rewrites needed.
  // Falls back gracefully on browsers without startViewTransition support.
  const setStep: React.Dispatch<React.SetStateAction<number>> = useCallback(
    (newStep) => {
      transitionStep(() => setStepRaw(newStep));
    },
    []
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // ──────────────────────────────────────────────────────────────
  // Resume an abandoned registration.
  //
  // Audit issue #4: if a user completed step 2 (account created, token in
  // localStorage) but dropped off before finishing, they used to be stuck —
  // logging in dumped them at /client with "account on hold" and no way back
  // into the flow. Now we jump them to the right step based on what they've
  // already done server-side. Runs ONCE on mount when no explicit URL step
  // is already asking for a specific position.
  // ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const explicitUrlStep =
      (stepParam === 'after-fee' && paymentStatus === 'success') || !!oauthProvider;
    if (explicitUrlStep) return; // URL already tells us where to go
    if (typeof window === 'undefined') return;
    const token = localStorage.getItem('ppl_token');
    if (!token) return; // fresh signup — start at step 1

    (async () => {
      try {
        const [meRes, onboardRes] = await Promise.all([
          api.getMe(),
          api.getOnboardingStatus(),
        ]);
        const user = meRes.data;
        const onb = onboardRes.data;
        if (!user) return;

        // ONLY auto-resume for CLIENT users. Admins and staff visiting
        // /register (e.g. to preview what the flow looks like, or to register
        // an athlete on someone else's behalf) should always start at step 1.
        if (user.role !== 'CLIENT') return;

        // If they've already got an ACTIVE membership, they're fully
        // onboarded — ship them to the dashboard, not back into /register.
        const hasActiveMembership = user.memberships?.some(
          (m) => m.status === 'ACTIVE'
        );
        if (hasActiveMembership) {
          router.push('/client');
          return;
        }

        // Preload playingLevel so downstream steps render the right plans.
        // Pull from the /onboarding/me response which now includes the
        // AthleteProfile.ageGroup (the source of truth, per audit #11).
        // Fall back to user.ageGroup (legacy ClientProfile cache).
        const storedAgeGroup =
          (onb?.ageGroup as PlayingLevel | undefined) ||
          (user.ageGroup as PlayingLevel | undefined);
        if (storedAgeGroup) setPlayingLevel(storedAgeGroup);

        // Decide the resume step.
        // step 3 — account exists but no onboarding record yet
        // step 4 — onboarding picked but no location yet
        // step 5 — location picked but no membership yet
        //
        // Safety: if we can't determine ageGroup, we'd land on step 5 with
        // no filter and show every plan. Skip the resume in that case and
        // let the user start fresh instead of seeing all plans.
        if (!onb?.onboardingRecord) {
          setStep(3);
        } else if (!user.homeLocation?.id) {
          setStep(4);
        } else if (storedAgeGroup) {
          setStep(5);
        }
        // else: stay on step 1 — user must pick a playing level first
      } catch {
        // If /me fails (expired token, etc.) silently stay on step 1.
        // The normal register flow will overwrite the token on step 2.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Additional athletes (siblings) — only shown for PARENT registrations. Lets
  // a parent stage up to 3 extra kids during signup; backend creates one
  // AthleteProfile per entry under the same Family. The parent picks a plan
  // for the PRIMARY athlete during step 5, then goes to
  // /client/membership?athleteId=X for each sibling after signup completes.
  interface AdditionalAthleteDraft {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    ageGroup: '' | 'youth' | 'ms_hs' | 'college' | 'pro';
  }
  const [additionalAthletes, setAdditionalAthletes] = useState<AdditionalAthleteDraft[]>([]);

  // Step 3 / 4 / 5
  const [athleteSelection, setAthleteSelection] = useState<AthleteSelection | ''>('');
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState('');
  const [trainingPreference, setTrainingPreference] = useState<TrainingPref | ''>('');
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  // Per-plan toggle state: { [pitchingPlanId]: true } when the user has
  // flipped the "+ Add Hitting Training" switch. At submit time, a true
  // value causes the selected plan to swap to the paired combo's id.
  const [hittingToggled, setHittingToggled] = useState<Record<string, boolean>>({});

  // Step 6 (Stripe Elements)
  const [checkoutData, setCheckoutData] = useState<SubscribeResult | null>(null);

  // Google Sign-In setup
  const [googleLoaded, setGoogleLoaded] = useState(false);

  // ──────────────────────────────────────────────────────────────
  // SAVE-AND-FINISH-LATER (lightweight localStorage persistence)
  // ──────────────────────────────────────────────────────────────
  //
  // Persists step 1 + step 2 form state (EXCEPT password fields) to
  // localStorage so unauthenticated users who bounce mid-signup can pick
  // up where they left off. Authenticated users get the richer backend-
  // backed resume flow (/onboarding/me) handled in the earlier useEffect.
  //
  // Cleared the moment step 2 submits successfully — once their account
  // exists, backend resume takes over and we don't need the cache.
  const SAVE_KEY = 'ppl:register:draft:v1';
  const [restoredDraft, setRestoredDraft] = useState(false);

  // Restore on mount (once). Only runs if we actually find saved state;
  // never overwrites a user who came back to /register with a fresh goal.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (!d || typeof d !== 'object') return;
      // Only restore fields we recognize — prevents a corrupted/renamed
      // schema from blowing up the UI.
      if (d.playingLevel) setPlayingLevel(d.playingLevel);
      if (d.athleteFirstName) setAthleteFirstName(d.athleteFirstName);
      if (d.athleteLastName) setAthleteLastName(d.athleteLastName);
      if (d.athleteEmail) setAthleteEmail(d.athleteEmail);
      if (d.athleteDob) setAthleteDob(d.athleteDob);
      if (d.athletePhone) setAthletePhone(d.athletePhone);
      if (d.parentFirstName) setParentFirstName(d.parentFirstName);
      if (d.parentLastName) setParentLastName(d.parentLastName);
      if (d.parentEmail) setParentEmail(d.parentEmail);
      if (d.parentPhone) setParentPhone(d.parentPhone);
      if (Array.isArray(d.additionalAthletes)) {
        setAdditionalAthletes(
          d.additionalAthletes
            .slice(0, 3)
            .map((a: Partial<AdditionalAthleteDraft>) => ({
              firstName: String(a.firstName ?? ''),
              lastName: String(a.lastName ?? ''),
              dateOfBirth: String(a.dateOfBirth ?? ''),
              ageGroup:
                a.ageGroup === 'youth' ||
                a.ageGroup === 'ms_hs' ||
                a.ageGroup === 'college' ||
                a.ageGroup === 'pro'
                  ? a.ageGroup
                  : '',
            }))
        );
      }
      setRestoredDraft(true);
    } catch {
      // Malformed JSON — discard silently, no need to surface this.
      window.localStorage.removeItem(SAVE_KEY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save on field change. Debounced 400ms so we're not hammering
  // localStorage every keystroke. Password fields are intentionally
  // excluded — never store plaintext credentials, even client-side.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Don't save anything if the user hasn't touched the form at all
    // (prevents the "start fresh" banner from appearing after a 0-state mount).
    const anyValue =
      playingLevel ||
      athleteFirstName ||
      athleteLastName ||
      athleteEmail ||
      athleteDob ||
      athletePhone ||
      parentFirstName ||
      parentLastName ||
      parentEmail ||
      parentPhone ||
      additionalAthletes.length > 0;
    if (!anyValue) return;
    const t = setTimeout(() => {
      try {
        window.localStorage.setItem(
          SAVE_KEY,
          JSON.stringify({
            playingLevel,
            athleteFirstName,
            athleteLastName,
            athleteEmail,
            athleteDob,
            athletePhone,
            parentFirstName,
            parentLastName,
            parentEmail,
            parentPhone,
            additionalAthletes,
            savedAt: Date.now(),
          })
        );
      } catch {
        /* quota exceeded or disabled — silent no-op */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [
    playingLevel,
    athleteFirstName,
    athleteLastName,
    athleteEmail,
    athleteDob,
    athletePhone,
    parentFirstName,
    parentLastName,
    parentEmail,
    parentPhone,
    additionalAthletes,
  ]);

  const clearDraft = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(SAVE_KEY);
    }
    setRestoredDraft(false);
  }, []);

  const startFresh = useCallback(() => {
    clearDraft();
    setPlayingLevel('');
    setAthleteFirstName('');
    setAthleteLastName('');
    setAthleteEmail('');
    setAthleteDob('');
    setAthletePhone('');
    setParentFirstName('');
    setParentLastName('');
    setParentEmail('');
    setParentPhone('');
    setStep(1);
  }, [clearDraft, setStep]);

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

  // Auto-clear parent/guardian fields when the athlete opts out of a parent
  // account. Prevents stale values from being submitted with the solo form
  // AND gives the visual feedback Chad expects — the inputs go empty, not
  // just the section fades. Fires a one-time info toast on the transition
  // so the user understands why the data they typed disappeared (audit #13).
  useEffect(() => {
    const solo = (isMsHs && msHsOptedOut) || (isCollege && collegeOptOut);
    if (solo) {
      const hadAnyParentInfo =
        parentFirstName.trim() ||
        parentLastName.trim() ||
        parentEmail.trim() ||
        parentPhone.trim();
      setParentFirstName('');
      setParentLastName('');
      setParentEmail('');
      setParentPhone('');
      if (hadAnyParentInfo) {
        toast.info('Parent/guardian info cleared — you chose to manage this account yourself.');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMsHs, msHsOptedOut, isCollege, collegeOptOut]);

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
      const msg = err instanceof Error ? err.message : 'Google sign-up failed';
      toast.error(msg);
      setError(msg);
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
    haptic.medium();
    setPlayingLevel(level);
    setError('');
    setStep(2);
  };

  const handleStep2Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Belt-and-suspenders vs double-submit. The button has
    // disabled={isLoading} but Enter-key spam or super-fast taps can slip
    // through React's state batching. This early-return hard-blocks.
    if (isLoading) return;
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
    // Password — client-side gate. Backend re-validates (length,
    // common-password blocklist, HIBP breach set) on every request.
    // ──────────────────────────────────────────────────────────
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      toast.error('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      toast.error('Passwords do not match.');
      return;
    }
    if (isCommonPassword(password)) {
      setError('That password is too common. Please choose something unique.');
      toast.error('That password is too common. Please choose something unique.');
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
        // Athlete name + DOB are ALWAYS sent (for both PARENT and SELF
        // paths). Backend uses these to create the AthleteProfile with
        // actual names instead of splitting fullName (which produced
        // ugly "Drew Athlete" single-word fallbacks). Audit issue #7.
        athleteFirstName,
        athleteLastName,
        ...(athleteDob && { athleteDateOfBirth: athleteDob }),
        // Solo-mode opt-out is sent whenever the athlete opted out and no
        // parent was attached — College (single checkbox) or MS/HS (both
        // checkboxes). Backend uses this to skip the "parent required" guard.
        ...(!hasParent && (
          (isCollege && collegeOptOut) ||
          (isMsHs && msHsOptedOut)
        ) && { parentOptOut: true }),
        // Additional athletes — only include when (a) this is a parent
        // registration and (b) at least one entry has a full name.
        // Strips incomplete rows so the backend never sees a half-filled
        // sibling (backend already validates, but don't tempt it).
        ...(hasParent && additionalAthletes.length > 0 && {
          additionalAthletes: additionalAthletes
            .filter((a) => a.firstName.trim() && a.lastName.trim())
            .map((a) => ({
              firstName: a.firstName.trim(),
              lastName: a.lastName.trim(),
              dateOfBirth: a.dateOfBirth || undefined,
              ageGroup: a.ageGroup || undefined,
            })),
        }),
      };

      const res = await api.register(registerPayload);
      if (res.data?.token) {
        localStorage.setItem('ppl_token', res.data.token);
      }
      // Wipe the localStorage draft now that the account exists — from here
      // on the authenticated resume flow (/onboarding/me) is in charge.
      clearDraft();
      haptic.success();
      toast.success('Account created');
      setStep(3);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not create your account.';
      toast.error(msg);
      setError(msg);
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
        toast.info('Redirecting to secure checkout…');
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
      const msg = err instanceof Error ? err.message : 'Could not save your status.';
      toast.error(msg);
      setError(msg);
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
      toast.success('Preferences saved');
      setStep(5);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not save your preferences.';
      toast.error(msg);
      setError(msg);
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
      const msg = err instanceof Error ? err.message : 'Could not start subscription.';
      toast.error(msg);
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePaymentSuccess = () => {
    toast.success('Welcome to PPL — let\u2019s book your first session');
    router.push('/client/book');
  };

  // --------------------------------------------------------------------
  // FILTERED PLANS (only those matching the playing level)
  // --------------------------------------------------------------------
  // If playingLevel isn't set, show NO plans — prevents a client being
  // shown every plan in the system (incl. Youth prices to a College athlete)
  // when the resume-flow fallback lands them on step 5 without a stored
  // ageGroup. The back-button on the step 5 UI also lets them pick a level.
  //
  // On PPL app, hitting is an ADD-ON — the combo plans never appear as
  // standalone cards. Instead each pitching-only card renders an
  // "+ Add Hitting Training" toggle that swaps the selected plan to the
  // paired combo at submit time. Filter combos out of the visible list.
  const relevantPlans = plans.filter((p) =>
    playingLevel ? p.ageGroup === playingLevel && !p.includesHitting : false
  );
  const resolvePlanId = (plan: MembershipPlan): string => {
    if (hittingToggled[plan.id] && plan.pairedWithPlanId) {
      return plan.pairedWithPlanId;
    }
    return plan.id;
  };
  const getComboPlan = (plan: MembershipPlan): MembershipPlan | null => {
    if (!plan.pairedWithPlanId) return null;
    return plans.find((p) => p.id === plan.pairedWithPlanId) ?? null;
  };

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
        {/* Logo + title.
            Uses the static /ppl-logo.webp (43KB) shipped with the app —
            zero network round-trip, paints on first frame. The branding
            API is still the source of truth for name/tagline/colors, but
            the logo image itself is static so it loads instantly. */}
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
          {/* Main heading removed per design — the sub-step heading in Bank
              Gothic acts as the page's H1 now.
              Sized with clamp() so it fills the row on every viewport without
              ever wrapping. Upper bound 20px keeps the longest step heading
              ("HAVE YOU TRAINED AT PPL BEFORE?" = 30 chars) inside the
              max-w-md (448px) container even at the widest viewport. */}
          <h1
            className="font-display font-bold tracking-[0.08em] uppercase text-foreground leading-none text-center whitespace-nowrap"
            style={{ fontSize: 'clamp(0.85rem, 4.2vw, 1.25rem)' }}
          >
            {stepHeading}
          </h1>
        </div>

        {/* Progress indicator — 6 bars + contextual label. The label tells
            users how far they are in the flow ("Step 1 of 6 · Playing Level"),
            which drops abandonment on multi-step forms. The active bar is
            brighter PPL green; completed bars are solid; future bars are border. */}
        <div className="mb-6">
          <div className="flex items-center gap-2">
            {(() => {
              const labels = ['Playing Level', 'Your Info', 'History', 'Training', 'Membership', 'Checkout'];
              return labels.map((_, i) => {
                const stepNum = i + 1;
                const isComplete = step > stepNum;
                const isActive = step === stepNum;
                return (
                  <div
                    key={stepNum}
                    aria-current={isActive ? 'step' : undefined}
                    className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                      isActive
                        ? 'bg-[#95C83C] shadow-[0_0_8px_rgba(149,200,60,0.5)]'
                        : isComplete
                        ? 'bg-[#5E9E50]'
                        : 'bg-border'
                    }`}
                  />
                );
              });
            })()}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.12em] text-muted">
            <span className="whitespace-nowrap flex-shrink-0">
              Step <span className="text-foreground font-bold tabular-nums">{step}</span> of 6
            </span>
            <span className="text-foreground/70 truncate min-w-0 text-right">
              {(['Playing Level', 'Your Info', 'History', 'Training', 'Membership', 'Checkout'] as const)[step - 1]}
            </span>
          </div>
        </div>

        {/* Save-and-finish-later restore banner — only visible on steps 1 & 2
            (where the draft is still relevant; after account creation the
            authenticated resume flow takes over). Discreet pill, not a modal. */}
        {restoredDraft && (step === 1 || step === 2) && (
          <div className="mb-4 flex items-center justify-between gap-3 p-3 rounded-lg border border-highlight/30 bg-highlight/5 text-sm">
            <span className="text-foreground/90 leading-snug flex-1">
              <strong className="text-foreground">Welcome back.</strong>{' '}
              We saved your progress — pick up where you left off.
            </span>
            <button
              type="button"
              onClick={startFresh}
              className="text-xs font-medium text-muted hover:text-foreground underline underline-offset-2 whitespace-nowrap"
            >
              Start fresh
            </button>
          </div>
        )}

        {/* view-transition-name gives the View Transitions API a named
            element to crossfade when `step` changes. The key forces a fresh
            subtree per step so the old/new view are properly distinct.
            view-transition-name is set via the .ppl-register-step class in
            globals.css (not as inline style because older TS lib.dom types
            don't yet include viewTransitionName). */}
        <div
          className="ppl-card ppl-register-step"
          key={`step-${step}`}
        >
          {error && (
            <div
              ref={(el) => {
                // Audit issue #12 — on mobile the error banner is at the top
                // of the form, above whatever the user was typing. Scroll it
                // into view when it appears so they actually see the message.
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
              className="mb-4 p-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm"
            >
              {error}
            </div>
          )}

          {/* ============================================ */}
          {/* STEP 1 — Playing Level                       */}
          {/* ============================================ */}
          {step === 1 && (
            <div className="space-y-2.5">
              {(['youth', 'ms_hs', 'college', 'pro'] as PlayingLevel[]).map((lvl, i) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => handleStep1Select(lvl)}
                  // Stagger-fade in on page load (~70ms between cards) for a
                  // "designed, not rendered" feel. Respects prefers-reduced-motion
                  // via the media query in globals.css.
                  className="ppl-fade-in group w-full text-left p-4 rounded-xl border-2 border-border bg-surface transition-all duration-150 hover:bg-[#95C83C] hover:border-[#95C83C] hover:shadow-lg hover:shadow-[#95C83C]/25 focus:bg-[#95C83C] focus:border-[#95C83C] focus:outline-none"
                  style={{ animationDelay: `${i * 70}ms` }}
                >
                  <div
                    className="font-accent italic font-black uppercase tracking-[0.04em] text-foreground text-sm leading-none transition-colors group-hover:text-black group-focus:text-black"
                    style={{
                      fontFamily: 'var(--font-transducer), Impact, "Arial Black", sans-serif',
                      fontWeight: 900,
                      fontStyle: 'italic',
                    }}
                  >
                    {LEVEL_LABEL[lvl]}
                  </div>
                  <div className="text-[11px] text-muted/80 mt-1.5 font-normal transition-colors group-hover:text-black/75 group-focus:text-black/75">
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

              {/* OAuth shortcut — Google button (SDK label already says
                  "Sign up with Google"). The email form below is the default
                  path, so no "or sign up with email" divider needed. */}
              <div data-ppl-marker="oauth-no-divider-v2" className="space-y-2 mb-6">
                <div id="google-signup-btn" className="flex justify-center [&>div]:!w-full" />
              </div>

              <form onSubmit={handleStep2Submit} className="space-y-6">
                {/* ─── ATHLETE SECTION — PPL light green #95C83C (hardcoded) ─── */}
                <section
                  className="rounded-xl overflow-hidden border-2 shadow-lg"
                  style={{
                    // Literal hex + alpha — no CSS vars, no color-mix (Safari/iOS-safe)
                    borderColor: 'rgba(149, 200, 60, 0.75)',
                    backgroundColor: 'rgba(149, 200, 60, 0.08)',
                    boxShadow: '0 10px 24px -12px rgba(149, 200, 60, 0.35)',
                  }}
                >
                  {/* Bold banner header */}
                  <div
                    className="flex items-center gap-2.5 px-4 py-2.5 text-black"
                    style={{ backgroundColor: '#95C83C' }}
                  >
                    <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="8" r="4" />
                      <path d="M20 21a8 8 0 1 0-16 0" />
                    </svg>
                    <span
                      className="text-base italic uppercase tracking-[0.06em]"
                      style={{
                        fontFamily: 'var(--font-transducer), Impact, "Arial Black", sans-serif',
                        fontWeight: 900,
                        fontStyle: 'italic',
                      }}
                    >
                      Athlete Info
                    </span>
                  </div>
                  <div className="p-4 space-y-3">
                    <p className="text-[11px] text-muted -mt-1">
                      The person who will be training at PPL.
                    </p>
                  <div className="grid grid-cols-1 [@media(min-width:420px)]:grid-cols-2 gap-3">
                    <div>
                      <label className="ppl-label">
                        Athlete first name<span className="text-[#95C83C] ml-0.5">*</span>
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
                      <label className="ppl-label">
                        Athlete last name<span className="text-[#95C83C] ml-0.5">*</span>
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
                  {/* Stack to single column below ~420px (sm breakpoint in
                      Tailwind ≈ 640px — but we want tighter for phones).
                      `@media (min-width: 420px)` via an arbitrary class
                      keeps DOB + email side-by-side on anything wider than
                      a very narrow phone. */}
                  <div className="mt-3 grid grid-cols-1 [@media(min-width:420px)]:grid-cols-2 gap-3">
                    <div>
                      <label className="ppl-label">
                        Date of birth<span className="text-[#95C83C] ml-0.5">*</span>
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
                      <label className="ppl-label">
                        Athlete email
                        {isYouth ? (
                          <span className="text-muted ml-1 text-[10px] normal-case tracking-normal">(optional)</span>
                        ) : (
                          <span className="text-[#95C83C] ml-0.5">*</span>
                        )}
                      </label>
                      <input
                        type="email"
                        value={athleteEmail}
                        onChange={(e) => setAthleteEmail(e.target.value)}
                        className="ppl-input"
                        placeholder={isYouth ? 'Leave blank — parent gets all messages' : 'athlete@example.com'}
                        required={!isYouth}
                      />
                    </div>
                  </div>
                  <div className="mt-3">
                    <label className="ppl-label">
                      Athlete phone
                      {isYouth ? (
                        <span className="text-muted ml-1 text-[10px] normal-case tracking-normal">(optional)</span>
                      ) : (
                        <span className="text-[#95C83C] ml-0.5">*</span>
                      )}
                    </label>
                    <input
                      type="tel"
                      value={athletePhone}
                      onChange={(e) => setAthletePhone(e.target.value)}
                      className="ppl-input"
                      placeholder={isYouth ? "Leave blank if athlete has no phone" : (parentRequired ? "Use parent's cell if athlete has none" : '')}
                      required={!isYouth}
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
                      below — otherwise please complete the parent/guardian fields.
                    </p>
                    <label className="flex gap-3 p-3 rounded-lg border border-border bg-background cursor-pointer hover:border-[#5E9E50]/50 transition-colors">
                      <input
                        type="checkbox"
                        checked={msHsSoloAck1}
                        onChange={(e) => setMsHsSoloAck1(e.target.checked)}
                        className="mt-0.5 accent-[#5E9E50]"
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
                          borderColor: 'rgba(94, 158, 80, 0.65)',
                          backgroundColor: 'rgba(94, 158, 80, 0.12)',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={msHsSoloAck2}
                          onChange={(e) => setMsHsSoloAck2(e.target.checked)}
                          className="mt-0.5 accent-[#5E9E50]"
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
                    className="flex gap-3 p-3 rounded-xl border border-border bg-surface/60 cursor-pointer hover:border-[#5E9E50]/50 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={collegeOptOut}
                      onChange={(e) => setCollegeOptOut(e.target.checked)}
                      className="mt-0.5 accent-[#5E9E50]"
                    />
                    <span className="text-xs text-foreground/90 leading-snug">
                      I&apos;m managing this account myself — I understand I&apos;m responsible
                      for my own scheduling, cancellations, and billing.
                    </span>
                  </label>
                )}

                {/* ─── PARENT / GUARDIAN SECTION — PPL dark green #5E9E50 (hardcoded) ─── */}
                {showsParentSection && (
                  <section
                    className={`rounded-xl overflow-hidden border-2 shadow-lg transition-opacity duration-300 ${
                      parentRequired ? 'opacity-100' : 'opacity-15'
                    }`}
                    style={{
                      // Literal hex + alpha — no CSS vars, no color-mix (Safari/iOS-safe)
                      borderColor: 'rgba(94, 158, 80, 0.75)',
                      backgroundColor: 'rgba(94, 158, 80, 0.08)',
                      boxShadow: '0 10px 24px -12px rgba(94, 158, 80, 0.35)',
                    }}
                  >
                    {/* Bold banner header */}
                    <div
                      className="flex items-center gap-2.5 px-4 py-2.5 text-white"
                      style={{ backgroundColor: '#5E9E50' }}
                    >
                      <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                      <span
                      className="text-base italic uppercase tracking-[0.06em]"
                      style={{
                        fontFamily: 'var(--font-transducer), Impact, "Arial Black", sans-serif',
                        fontWeight: 900,
                        fontStyle: 'italic',
                      }}
                    >
                        Parent / Guardian Info
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
                    <div className="grid grid-cols-1 [@media(min-width:420px)]:grid-cols-2 gap-3">
                      <div>
                        <label className="ppl-label">
                          Parent/guardian first name
                          {parentRequired && <span className="text-[#5E9E50] ml-0.5">*</span>}
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
                        <label className="ppl-label">
                          Parent/guardian last name
                          {parentRequired && <span className="text-[#5E9E50] ml-0.5">*</span>}
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
                      <label className="ppl-label">
                        Parent/guardian email
                        {parentRequired && <span className="text-[#5E9E50] ml-0.5">*</span>}
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
                      <label className="ppl-label">
                        Parent/guardian phone
                        {parentRequired && <span className="text-[#5E9E50] ml-0.5">*</span>}
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

                {/* ─── PASSWORD SECTION — matches Athlete/Parent pattern ─── */}
                <section
                  className="rounded-xl overflow-hidden border-2 shadow-lg"
                  style={{
                    borderColor: 'rgba(245, 245, 245, 0.75)',
                    backgroundColor: 'rgba(245, 245, 245, 0.05)',
                    boxShadow: '0 10px 24px -12px rgba(245, 245, 245, 0.20)',
                  }}
                >
                  {/* Bold banner header — white block with black text */}
                  <div
                    className="flex items-center gap-2.5 px-4 py-2.5 text-black"
                    style={{ backgroundColor: '#F5F5F5' }}
                  >
                    <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    <span
                      className="text-base italic uppercase tracking-[0.06em]"
                      style={{
                        fontFamily: 'var(--font-transducer), Impact, "Arial Black", sans-serif',
                        fontWeight: 900,
                        fontStyle: 'italic',
                      }}
                    >
                      Create Password
                    </span>
                  </div>
                  <div className="p-4 space-y-3">
                    <p className="text-[11px] text-muted -mt-1">
                      {primaryEmail ? (
                        <>
                          Your login will be{' '}
                          <strong className="text-foreground">{primaryEmail}</strong>. At least 8 characters.
                        </>
                      ) : (
                        <>Your login will be the email you entered above. At least 8 characters.</>
                      )}
                    </p>
                    <div className="grid grid-cols-1 [@media(min-width:420px)]:grid-cols-2 gap-3">
                      <div>
                        <label className="ppl-label" htmlFor="register-password">Password</label>
                        <PasswordInput
                          id="register-password"
                          variant="create"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          minLength={8}
                        />
                      </div>
                      <div>
                        <label className="ppl-label" htmlFor="register-confirm">Confirm</label>
                        <PasswordInput
                          id="register-confirm"
                          variant="create"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          matchValue={password}
                          required
                          minLength={8}
                        />
                      </div>
                    </div>
                  </div>
                </section>

                {/* Additional athletes — parent-registration-only. Lets a
                    parent stage siblings during signup; they're created at
                    submit time under the same Family. The parent will pick
                    a plan for the PRIMARY athlete in step 5, then use the
                    My Athletes widget on the dashboard to pick plans for
                    each sibling after signup. */}
                {hasParent && (
                  <section className="ppl-register-step">
                    <div className="rounded-xl border border-border p-4 sm:p-5 bg-card">
                      <div className="flex items-baseline justify-between gap-3">
                        <h3 className="font-display uppercase tracking-[0.04em] text-foreground text-sm">
                          Add a sibling (optional)
                        </h3>
                        <span className="text-[10px] uppercase tracking-[0.12em] text-muted">
                          {additionalAthletes.length}/3
                        </span>
                      </div>
                      <p className="text-xs text-muted mt-1 leading-relaxed">
                        Have more than one athlete? Add them here and you&apos;ll
                        pick plans for each one from your dashboard after
                        signup.
                      </p>

                      {additionalAthletes.map((a, idx) => (
                        <div
                          key={idx}
                          className="mt-4 pt-4 border-t border-border/60 space-y-3"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] uppercase tracking-[0.12em] text-muted">
                              Sibling {idx + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setAdditionalAthletes((prev) =>
                                  prev.filter((_, i) => i !== idx)
                                )
                              }
                              className="text-[11px] text-muted hover:text-destructive"
                            >
                              Remove
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="ppl-label">First name</label>
                              <input
                                type="text"
                                value={a.firstName}
                                onChange={(e) =>
                                  setAdditionalAthletes((prev) => {
                                    const next = [...prev];
                                    next[idx] = { ...next[idx], firstName: e.target.value };
                                    return next;
                                  })
                                }
                                className="ppl-input text-sm"
                              />
                            </div>
                            <div>
                              <label className="ppl-label">Last name</label>
                              <input
                                type="text"
                                value={a.lastName}
                                onChange={(e) =>
                                  setAdditionalAthletes((prev) => {
                                    const next = [...prev];
                                    next[idx] = { ...next[idx], lastName: e.target.value };
                                    return next;
                                  })
                                }
                                className="ppl-input text-sm"
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="ppl-label">Date of birth</label>
                              <input
                                type="date"
                                value={a.dateOfBirth}
                                onChange={(e) =>
                                  setAdditionalAthletes((prev) => {
                                    const next = [...prev];
                                    next[idx] = { ...next[idx], dateOfBirth: e.target.value };
                                    return next;
                                  })
                                }
                                className="ppl-input text-sm"
                              />
                            </div>
                            <div>
                              <label className="ppl-label">Playing level</label>
                              <select
                                value={a.ageGroup}
                                onChange={(e) =>
                                  setAdditionalAthletes((prev) => {
                                    const next = [...prev];
                                    next[idx] = {
                                      ...next[idx],
                                      ageGroup: e.target.value as AdditionalAthleteDraft['ageGroup'],
                                    };
                                    return next;
                                  })
                                }
                                className="ppl-input text-sm"
                              >
                                <option value="">Choose…</option>
                                <option value="youth">Youth (12 &amp; under)</option>
                                <option value="ms_hs">Middle / High School</option>
                                <option value="college">College</option>
                                <option value="pro">Pro</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      ))}

                      {additionalAthletes.length < 3 && (
                        <button
                          type="button"
                          onClick={() => {
                            haptic.light();
                            setAdditionalAthletes((prev) => [
                              ...prev,
                              { firstName: '', lastName: '', dateOfBirth: '', ageGroup: '' },
                            ]);
                          }}
                          className="mt-4 text-xs font-medium text-accent-text hover:brightness-110"
                        >
                          + Add another athlete
                        </button>
                      )}
                    </div>
                  </section>
                )}

                <div className="flex gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="text-sm font-medium text-muted hover:text-foreground transition-colors py-3 px-4"
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
                New athletes are required to pay a one-time
                <strong className="text-foreground"> $300 onboarding fee</strong>.
              </p>
              {(
                [
                  { v: 'new' as const, label: 'New to PPL', desc: 'First-time athlete. A one-time $300 onboarding fee will be added.' },
                  { v: 'returning' as const, label: 'Returning athlete', desc: 'I have trained at PPL before. No onboarding fee required.' },
                  { v: 'youth_graduate' as const, label: 'PPL Youth graduate', desc: 'I moved up from the Youth program to 13+.' },
                  { v: 'free_assessment' as const, label: 'I did a free assessment', desc: 'I either took advantage of a free offer or my team came in for free assessments.' },
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
                  <div className="font-accent italic font-black uppercase tracking-[0.04em] text-foreground text-base leading-none">
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
              <p className="text-sm text-muted -mt-1">
                Tell us where and how you want to train. You can adjust both from
                your account later.
              </p>
              <section>
                <h3 className="text-sm font-semibold text-foreground mb-2">Training location</h3>
                <div className="space-y-2">
                  {locations.length === 0 ? (
                    // Skeleton — 2 location-card placeholders with shimmer until the API returns.
                    // Much more professional than a text "Loading…" label.
                    <>
                      <div className="ppl-skeleton h-[68px]" aria-hidden="true" />
                      <div className="ppl-skeleton h-[68px]" aria-hidden="true" />
                      <span className="sr-only">Loading locations…</span>
                    </>
                  ) : (
                    locations.map((loc) => (
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
                    ))
                  )}
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-foreground mb-2">How will you train?</h3>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { v: 'IN_PERSON' as const, label: 'In person', desc: 'On-site with PPL coaches at your selected facility.' },
                      { v: 'REMOTE' as const, label: 'Remote', desc: 'Custom programming + video review, train wherever you are.' },
                      { v: 'HYBRID' as const, label: 'Hybrid', desc: 'Mix of in-person sessions and remote programming.' },
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
                {/* One-liner that updates based on the selected preference — keeps
                    the button row compact while still explaining what each means. */}
                <p className="text-[11px] text-muted mt-2 leading-snug min-h-[1.25em]">
                  {trainingPreference === 'IN_PERSON'
                    ? 'On-site with PPL coaches at your selected facility.'
                    : trainingPreference === 'REMOTE'
                    ? 'Custom programming + video review, train wherever you are.'
                    : trainingPreference === 'HYBRID'
                    ? 'Mix of in-person sessions and remote programming.'
                    : 'Tap one to see what it includes.'}
                </p>
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
                // Skeleton — 3 plan-card placeholders with shimmer. Height
                // matches the real card so there's no layout shift when
                // plans actually arrive.
                <>
                  <div className="ppl-skeleton h-[92px]" aria-hidden="true" />
                  <div className="ppl-skeleton h-[92px]" aria-hidden="true" />
                  <div className="ppl-skeleton h-[92px]" aria-hidden="true" />
                  <span className="sr-only">Loading plans…</span>
                </>
              ) : (
                relevantPlans.map((plan) => {
                  const combo = getComboPlan(plan);
                  const withHitting = !!hittingToggled[plan.id] && combo !== null;
                  const displayPriceCents = withHitting && combo ? combo.priceCents : plan.priceCents;
                  const deltaCents = combo ? combo.priceCents - plan.priceCents : 0;
                  // MOST POPULAR — matches the BASE plan id (pre-hitting-toggle) so
                  // flipping the combo toggle doesn't move the badge around. Skipped
                  // when there's only one plan for this level (no "choice" to make).
                  const isRecommended =
                    playingLevel &&
                    RECOMMENDED_PLAN_IDS[playingLevel as PlayingLevel] === plan.id &&
                    relevantPlans.length > 1;
                  // Outer wrapper is a div (not button) so the nested "+ Add Hitting"
                  // button doesn't produce invalid <button> inside <button> markup.
                  return (
                    <div
                      key={plan.id}
                      role="button"
                      tabIndex={0}
                      aria-disabled={isLoading}
                      aria-label={
                        isRecommended
                          ? `${plan.name} — most popular for your playing level`
                          : plan.name
                      }
                      onClick={() => !isLoading && handleStep5Select(resolvePlanId(plan))}
                      onKeyDown={(e) => {
                        if (!isLoading && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          handleStep5Select(resolvePlanId(plan));
                        }
                      }}
                      className={`group relative w-full text-left p-4 rounded-xl border-2 cursor-pointer transition-all ${
                        isRecommended
                          ? 'border-[#95C83C] bg-[#95C83C]/[0.06] shadow-lg shadow-[#95C83C]/15 hover:shadow-[#95C83C]/30'
                          : withHitting
                          ? 'border-highlight/60 bg-highlight/5 hover:border-highlight'
                          : 'border-border hover:border-border-light bg-surface'
                      } ${isRecommended ? 'mt-3' : ''} ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {isRecommended && (
                        <span
                          className="absolute left-1/2 -top-2.5 -translate-x-1/2 px-3 py-1 rounded-full text-black text-[12px] leading-none tracking-[0.16em] shadow-md"
                          style={{
                            backgroundColor: '#95C83C',
                            fontFamily: 'var(--font-bebas), Oswald, Impact, sans-serif',
                          }}
                          aria-hidden="true"
                        >
                          MOST POPULAR
                        </span>
                      )}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-foreground text-base leading-tight">
                            {withHitting && combo ? combo.name : plan.name}
                          </div>
                          {(withHitting && combo ? combo.description : plan.description) && (
                            <div className="text-xs text-muted/80 mt-1.5 font-normal leading-snug">
                              {withHitting && combo ? combo.description : plan.description}
                            </div>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0">
                          {/* Price — Bebas Neue for the scoreboard/menu-board
                              feel. Matches the PPL pitching-report aesthetic. */}
                          <div className="font-stat text-4xl leading-none tracking-wide text-accent-text">
                            <AnimatedPrice cents={displayPriceCents} />
                          </div>
                          <div className="text-[11px] text-muted mt-1">
                            / {plan.billingCycle === 'monthly' ? 'mo' : 'week'}
                          </div>
                        </div>
                      </div>

                      {/* + Add Hitting Training toggle — only shown when this
                          plan has a paired combo sibling. Tap toggles without
                          submitting the card. */}
                      {combo && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            haptic.light();
                            setHittingToggled((prev) => ({
                              ...prev,
                              [plan.id]: !prev[plan.id],
                            }));
                          }}
                          aria-pressed={withHitting}
                          className={`mt-3 w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                            withHitting
                              ? 'border-highlight bg-highlight/15 text-foreground'
                              : 'border-border bg-background/60 text-muted hover:border-border-light hover:text-foreground'
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            {/* Check / plus icon */}
                            <span
                              className={`inline-flex items-center justify-center w-4 h-4 rounded ${
                                withHitting ? 'bg-highlight text-on-accent' : 'bg-border/60 text-muted'
                              }`}
                              aria-hidden="true"
                            >
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                                {withHitting ? (
                                  <path d="M20 6 9 17l-5-5" />
                                ) : (
                                  <>
                                    <line x1="12" y1="5" x2="12" y2="19" />
                                    <line x1="5" y1="12" x2="19" y2="12" />
                                  </>
                                )}
                              </svg>
                            </span>
                            {withHitting ? 'Hitting Training Added' : 'Add Hitting Training'}
                          </span>
                          <span className={`text-xs tabular-nums ${withHitting ? 'text-foreground' : 'text-muted'}`}>
                            {withHitting ? 'included' : `+$${(deltaCents / 100).toFixed(0)}/wk`}
                          </span>
                        </button>
                      )}
                    </div>
                  );
                })
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
              // Use the plan the backend actually subscribed us to —
              // NOT relevantPlans[0]. Previous code had a bug that always
              // displayed the first plan in the filtered list regardless
              // of what the user picked (caught in 2026-04-23 audit).
              planName={checkoutData.plan?.name || 'PPL Membership'}
              priceCents={checkoutData.plan?.priceCents ?? 0}
              billingDay={checkoutData.billingDay}
              firstChargeCents={checkoutData.firstChargeCents}
              anchorDate={checkoutData.billingAnchorDate}
              billingCycle={checkoutData.plan?.billingCycle || 'weekly'}
              onSuccess={handlePaymentSuccess}
              onCancel={() => {
                const ok = window.confirm(
                  'Cancel and go back? Your $300 onboarding fee has already been charged — you\'ll need to resume from where you left off to finish signing up.'
                );
                if (ok) setStep(5);
              }}
            />
          )}

          <div className="mt-6 text-center">
            <p className="text-sm text-muted">
              Already have an account?{' '}
              <Link
                href="/login"
                className="font-bold transition-colors hover:brightness-110"
                style={{ color: '#95C83C' }}
              >
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
