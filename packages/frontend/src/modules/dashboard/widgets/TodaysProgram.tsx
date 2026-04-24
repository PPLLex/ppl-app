'use client';

/**
 * TodaysProgramWidget — self-managed athlete dashboard.
 *
 * Pulls from GET /api/programs/my and surfaces the most recently
 * updated ACTIVE program's current week + day of exercises. Premium
 * "coming soon" fallback when no active program exists yet.
 */

import { useEffect, useState } from 'react';
import Link from '@/components/PageTransitionLink';
import { api } from '@/lib/api';
import { PlaceholderBody } from './shared/PlaceholderBody';
import type { WidgetProps } from '../types';

interface Exercise {
  id: string;
  sortOrder: number;
  setsTarget?: number | null;
  repsTarget?: number | null;
  exercise?: { id: string; name: string; category?: string | null };
}
interface Day {
  id: string;
  dayNum: number;
  title?: string | null;
  exercises: Exercise[];
}
interface Week {
  id: string;
  weekNum: number;
  days: Day[];
}
interface Program {
  id: string;
  title: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  updatedAt: string;
  weeks: Week[];
  coach?: { fullName: string } | null;
}

export function TodaysProgramWidget(_props: WidgetProps) {
  const [programs, setPrograms] = useState<Program[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getMyPrograms('ACTIVE');
        if (!cancelled) setPrograms((res.data as Program[]) || []);
      } catch {
        if (!cancelled) setPrograms([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (programs === null) {
    return (
      <div className="space-y-2">
        <div className="ppl-skeleton h-5 w-2/3" aria-hidden="true" />
        <div className="ppl-skeleton h-4" aria-hidden="true" />
        <div className="ppl-skeleton h-4" aria-hidden="true" />
        <div className="ppl-skeleton h-4 w-3/4" aria-hidden="true" />
      </div>
    );
  }

  if (programs.length === 0) {
    return (
      <PlaceholderBody
        line="Your coach hasn't assigned a program yet."
        cta="Check back after your first session"
      />
    );
  }

  // Pick the most recently updated active program
  const program = programs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  // Figure out today's day. Start date + dayOfWeek offset → dayNum.
  const today = new Date();
  const start = program.startDate ? new Date(program.startDate) : null;
  let currentWeek = program.weeks[0];
  let currentDay: Day | null = currentWeek?.days[0] || null;

  if (start && program.weeks.length > 0) {
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysSinceStart = Math.max(0, Math.floor((today.getTime() - start.getTime()) / msPerDay));
    const weekIdx = Math.min(Math.floor(daysSinceStart / 7), program.weeks.length - 1);
    const dayIdx = daysSinceStart % 7;
    currentWeek = program.weeks[weekIdx] || currentWeek;
    currentDay =
      currentWeek?.days.find((d) => d.dayNum === dayIdx + 1) ||
      currentWeek?.days[0] ||
      null;
  }

  const exercises = currentDay?.exercises || [];

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-base uppercase tracking-[0.04em] text-foreground truncate">
          {program.title}
        </h3>
        {currentWeek && (
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted whitespace-nowrap">
            Week {currentWeek.weekNum} · Day {currentDay?.dayNum ?? 1}
          </span>
        )}
      </div>

      {currentDay?.title && (
        <p className="text-sm text-foreground/80 mt-1">{currentDay.title}</p>
      )}

      <ul className="mt-3 flex-1 overflow-y-auto divide-y divide-border/60 -mx-1">
        {exercises.length === 0 ? (
          <li className="text-sm text-muted py-2">No exercises scheduled today. Rest day.</li>
        ) : (
          exercises.map((ex) => (
            <li key={ex.id} className="py-2 px-1 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-foreground truncate">
                  {ex.exercise?.name ?? 'Exercise'}
                </p>
                {ex.exercise?.category && (
                  <p className="text-[10px] uppercase tracking-[0.12em] text-muted mt-0.5">
                    {ex.exercise.category}
                  </p>
                )}
              </div>
              {(ex.setsTarget || ex.repsTarget) && (
                <span className="text-xs text-foreground/80 whitespace-nowrap font-stat tabular-nums">
                  {ex.setsTarget ?? '—'}×{ex.repsTarget ?? '—'}
                </span>
              )}
            </li>
          ))
        )}
      </ul>

      <div className="mt-3 pt-2 border-t border-border">
        <Link
          href={`/client/programs`}
          className="text-xs font-medium text-accent-text hover:brightness-110"
        >
          View full program →
        </Link>
      </div>
    </div>
  );
}
