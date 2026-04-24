'use client';

/**
 * BillingStatus widget — parent dashboard.
 *
 * Shows at-a-glance: current plan, billing day (Mon/Thu anchor), status
 * pill (Active / Past Due / Suspended / Cancelled), and a CTA routing
 * to the detailed membership page. Past-due gets visual emphasis — it's
 * blocking access (dummy mode).
 *
 * Data source: api.getMyMembership() — returns null if no membership.
 */

import { useEffect, useState } from 'react';
import { api, MembershipDetail } from '@/lib/api';
import Link from '@/components/PageTransitionLink';
import type { WidgetProps } from '../types';

export function BillingStatusWidget(_props: WidgetProps) {
  const [data, setData] = useState<MembershipDetail | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getMyMembership();
        if (!cancelled) setData(res.data ?? null);
      } catch {
        if (!cancelled) setData(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (data === undefined) {
    return (
      <div className="space-y-2">
        <div className="ppl-skeleton h-4 w-24" aria-hidden="true" />
        <div className="ppl-skeleton h-6 w-full" aria-hidden="true" />
        <div className="ppl-skeleton h-4 w-20" aria-hidden="true" />
      </div>
    );
  }

  if (!data?.membership) {
    return (
      <div className="flex flex-col h-full justify-between gap-3">
        <p className="text-sm text-muted leading-snug">
          No active membership yet. Start one to unlock booking and training.
        </p>
        <Link href="/client/membership" className="ppl-btn ppl-btn-primary text-sm">
          Choose a plan
        </Link>
      </div>
    );
  }

  const m = data.membership;
  const billingDay = (m.billingDay || '').toLowerCase();
  const isPastDue = m.status === 'PAST_DUE';
  const isCancelled = m.status === 'CANCELLED';
  const isSuspended = m.status === 'SUSPENDED';
  const statusLabel = isPastDue
    ? 'Past Due'
    : isSuspended
    ? 'Suspended'
    : isCancelled
    ? 'Cancelled'
    : 'Active';
  const badgeClass = isPastDue
    ? 'ppl-badge-danger'
    : isSuspended || isCancelled
    ? 'bg-surface text-muted'
    : 'ppl-badge-active';

  return (
    <div className="flex flex-col h-full gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-foreground text-sm truncate">
            {m.plan.name}
          </p>
          <p className="text-[11px] text-muted mt-0.5 capitalize">
            {billingDay === 'monday' || billingDay === 'thursday'
              ? `Billed every ${billingDay}`
              : 'Weekly billing'}
          </p>
        </div>
        <span className={`ppl-badge text-[10px] ${badgeClass} flex-shrink-0`}>
          {statusLabel}
        </span>
      </div>

      {isPastDue && (
        <p className="text-[11px] text-danger leading-snug mt-1">
          Payment failed. Update your card to restore access.
        </p>
      )}

      <div className="mt-auto">
        <Link
          href="/client/membership"
          className="text-xs font-medium text-accent-text hover:brightness-110"
        >
          {isPastDue ? 'Update payment →' : 'Manage billing →'}
        </Link>
      </div>
    </div>
  );
}
