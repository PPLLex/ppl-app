'use client';

/**
 * Outside Coach Dashboard.
 *
 * Outside coaches (private pitching coaches, high-school coaches,
 * travel-ball coaches) sign in with normal CLIENT credentials. Their
 * elevated access comes from matching OutsideCoachLink rows keyed on
 * their email. This page renders the outside-coach DashboardGrid
 * config (attached athletes, read-only notes/metrics, message PPL).
 *
 * If the signed-in user has no active OutsideCoachLink rows, they see
 * an empty-state card instead of broken widgets.
 */

import { useEffect, useState } from 'react';
import Link from '@/components/PageTransitionLink';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { DashboardGrid } from '@/modules/dashboard/DashboardGrid';
import { outsideCoachDashboardConfig } from '@/modules/dashboard/configs/outside-coach';

export default function OutsideCoachDashboard() {
  const { user } = useAuth();
  const [linkCount, setLinkCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.request<Array<unknown>>('/outside-coaches/athletes');
        if (!cancelled) setLinkCount((res.data as unknown[])?.length ?? 0);
      } catch {
        if (!cancelled) setLinkCount(0);
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

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">
          {greeting()}, {user?.fullName?.split(' ')[0]}
        </h1>
        <p className="text-muted mt-1">Outside Coach Portal</p>
      </div>

      {linkCount === 0 && (
        <div className="mb-6 p-5 rounded-xl border border-border bg-surface">
          <h2 className="font-display text-base uppercase tracking-[0.04em] text-foreground">
            No linked athletes yet
          </h2>
          <p className="text-sm text-muted mt-2 leading-relaxed">
            Outside coaches get read-only access to an athlete&apos;s reports, metrics, and coach
            notes once a parent or athlete links you from their account. Ask the athlete&apos;s
            family to add you as an outside coach using the email you signed in with
            {user?.email ? (
              <>
                {' '}(<span className="text-foreground font-medium">{user.email}</span>)
              </>
            ) : null}
            .
          </p>
          <Link href="/client" className="ppl-btn ppl-btn-secondary text-sm mt-3 inline-block">
            Back to client view
          </Link>
        </div>
      )}

      <DashboardGrid config={outsideCoachDashboardConfig} role="OUTSIDE_COACH" />
    </div>
  );
}
