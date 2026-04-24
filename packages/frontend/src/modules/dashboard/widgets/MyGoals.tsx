'use client';

/**
 * MyGoalsWidget — self-managed athlete dashboard.
 *
 * Pulls from GET /api/goals/my?status=ACTIVE and renders up to 4 goals
 * with a clamped progress bar. Links out to /client/goals for detail.
 */

import { useEffect, useState } from 'react';
import Link from '@/components/PageTransitionLink';
import { api } from '@/lib/api';
import { PlaceholderBody } from './shared/PlaceholderBody';
import type { WidgetProps } from '../types';

interface Goal {
  id: string;
  title: string;
  description?: string | null;
  type?: string | null;
  status: string;
  targetValue?: number | null;
  currentValue?: number | null;
  unit?: string | null;
  progressPct?: number | null;
  createdAt: string;
}

export function MyGoalsWidget(_props: WidgetProps) {
  const [goals, setGoals] = useState<Goal[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getMyGoals({ status: 'ACTIVE' });
        if (!cancelled) setGoals((res.data as Goal[]) || []);
      } catch {
        if (!cancelled) setGoals([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (goals === null) {
    return (
      <div className="space-y-3">
        <div className="ppl-skeleton h-4" aria-hidden="true" />
        <div className="ppl-skeleton h-2" aria-hidden="true" />
        <div className="ppl-skeleton h-4" aria-hidden="true" />
        <div className="ppl-skeleton h-2" aria-hidden="true" />
      </div>
    );
  }

  if (goals.length === 0) {
    return (
      <PlaceholderBody
        line="No active goals yet."
        cta="Your coach will set goals after your first session"
      />
    );
  }

  const top = goals.slice(0, 4);

  return (
    <div className="flex flex-col h-full">
      <ul className="flex-1 space-y-3">
        {top.map((g) => {
          let pct = typeof g.progressPct === 'number' ? g.progressPct : null;
          if (pct === null && typeof g.currentValue === 'number' && typeof g.targetValue === 'number' && g.targetValue > 0) {
            pct = Math.round((g.currentValue / g.targetValue) * 100);
          }
          const clamped = Math.max(0, Math.min(100, pct ?? 0));
          return (
            <li key={g.id}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm text-foreground truncate">{g.title}</p>
                <span className="text-[11px] text-muted tabular-nums whitespace-nowrap">
                  {clamped}%
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-border/60 overflow-hidden">
                <div
                  className="h-full bg-accent"
                  style={{ width: `${clamped}%`, transition: 'width 600ms ease-out' }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <Link
        href="/client/goals"
        className="mt-3 text-xs font-medium text-accent-text hover:brightness-110 self-start"
      >
        All goals →
      </Link>
    </div>
  );
}
