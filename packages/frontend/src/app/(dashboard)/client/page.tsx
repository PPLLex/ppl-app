'use client';

/**
 * Client dashboard — the landing page for every CLIENT user after login.
 *
 * Renders role-appropriate widgets via the modular `modules/dashboard/`
 * framework. Parent users (managing one or more athlete kids) see the
 * parent config; self-managing athletes (college / pro / ms_hs solo)
 * see the athlete config.
 *
 * What this page still owns directly (NOT widgets):
 *   • Greeting header ("Good morning, Chad")
 *   • Account-on-hold banner (PAST_DUE / SUSPENDED → dummy mode)
 *   • Cancelled-membership banner
 * Everything else is a widget from modules/dashboard.
 */

import { useEffect, useState } from 'react';
import Link from '@/components/PageTransitionLink';
import { useAuth } from '@/contexts/AuthContext';
import { api, MembershipDetail } from '@/lib/api';
import { DashboardGrid } from '@/modules/dashboard/DashboardGrid';
import { parentDashboardConfig } from '@/modules/dashboard/configs/parent';
import { athleteDashboardConfig } from '@/modules/dashboard/configs/athlete';
import { WaiverBanner } from '@/components/WaiverBanner';
import { BirthdayCelebration } from '@/components/BirthdayCelebration';

/**
 * Decide which dashboard a CLIENT user should see.
 *
 *   College + Pro athletes always manage themselves → athlete view.
 *   Youth + MS/HS users with a parent account → parent view (default).
 *   MS/HS solo athletes currently land on parent view, which shows the
 *     same widgets a parent would. Can be refined once we have a
 *     reliable solo-vs-parent flag on the user payload.
 *
 * Kept simple on purpose; a more nuanced signal (e.g. a `managesOwn`
 * boolean on /auth/me) lands in a follow-up pass.
 */
function resolveDashboardType(user: { ageGroup?: string | null } | null): 'parent' | 'athlete' {
  const ageGroup = (user?.ageGroup || '').toLowerCase();
  if (ageGroup === 'college' || ageGroup === 'pro') return 'athlete';
  return 'parent';
}

export default function ClientDashboard() {
  const { user } = useAuth();
  const [membership, setMembership] = useState<MembershipDetail | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getMyMembership();
        if (!cancelled) setMembership(res.data ?? null);
      } catch {
        if (!cancelled) setMembership(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const dashboardType = resolveDashboardType(user);
  const config = dashboardType === 'parent' ? parentDashboardConfig : athleteDashboardConfig;
  const mem = membership?.membership;

  return (
    <div>
      {/* Birthday confetti — only renders when today is the athlete's
          birthday and they haven't dismissed it today. Drops out otherwise. */}
      <BirthdayCelebration />

      {/* Greeting header — personalized copy, not a widget (stays constant
          regardless of which role config is rendered below). */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">
          {greeting()}, {user?.fullName?.split(' ')[0]}
        </h1>
        <p className="text-muted mt-1">
          {user?.homeLocation
            ? `Training at ${user.homeLocation.name}`
            : 'Ready to train'}
        </p>
      </div>

      {/* ACCOUNT ON HOLD — dummy mode banner. Preserved from the old
          dashboard because this is the first thing a PAST_DUE user must
          see. Also prevents membershipGuard 403s from feeling confusing. */}
      {mem && (mem.status === 'PAST_DUE' || mem.status === 'SUSPENDED') && (
        <div className="mb-6 p-6 bg-red-500/10 border-2 border-red-500/30 rounded-xl">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
              <svg
                className="w-6 h-6 text-red-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-red-400">Account On Hold</h2>
              <p className="text-sm text-foreground mt-1">
                {mem.status === 'PAST_DUE'
                  ? 'Your recent payment failed. Your account access is restricted until your payment is resolved.'
                  : 'Your membership has been suspended. Please contact us to restore access.'}
              </p>
              <p className="text-xs text-muted mt-2">
                While your account is on hold, you cannot book sessions, access training programs,
                or use any PPL features. You can update your payment method or change your
                membership below.
              </p>
              <div className="flex gap-3 mt-4">
                <Link href="/client/membership" className="ppl-btn ppl-btn-primary text-sm">
                  Update Payment Method
                </Link>
                <Link href="/client/membership" className="ppl-btn ppl-btn-secondary text-sm">
                  Change Membership
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CANCELLED membership banner — softer than on-hold but still
          prominent, invites them back. */}
      {mem?.status === 'CANCELLED' && (
        <div className="mb-6 p-6 bg-surface border border-border rounded-xl">
          <h2 className="text-lg font-bold text-foreground">Membership Ended</h2>
          <p className="text-sm text-muted mt-1">
            Your membership has been cancelled. Sign up for a new membership to get back to training.
          </p>
          <Link
            href="/client/membership"
            className="ppl-btn ppl-btn-primary text-sm mt-3 inline-block"
          >
            Restart Membership
          </Link>
        </div>
      )}

      {/* Liability-waiver banner — appears whenever any athlete in the
          family lacks a signature against the current waiver version. */}
      <WaiverBanner />

      {/* ──────────────────────────────────────────────────────────────
          DASHBOARD WIDGETS — rendered from the role-scoped config. Drop
          widgets in / out by editing the config file. See the module
          README for the widget contract.
          ────────────────────────────────────────────────────────────── */}
      <DashboardGrid config={config} role="CLIENT" />
    </div>
  );
}
