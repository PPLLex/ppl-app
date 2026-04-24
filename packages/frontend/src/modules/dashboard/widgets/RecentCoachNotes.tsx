'use client';

/**
 * RecentCoachNotesWidget — parent dashboard.
 *
 * Fetches the parent's family of athletes, then fans out one
 * coach-notes call per athlete and merges/sorts the 3 most recent
 * notes across all of them. Each line shows which kid, the coach, and
 * the most recent session date. Tapping a note links to the athlete
 * notes page.
 *
 * API usage:
 *   1. GET /api/account/athletes  — list family
 *   2. GET /api/coach-notes/athlete/:id?limit=3  — per athlete
 *      (we reuse the existing /athlete/:id endpoint; for the parent's
 *       own profile it enforces CLIENT→own only, which is fine because
 *       the parent's User.id IS the athlete's User.id in the self-
 *       managed case. For children, parents query via the same path
 *       and the backend allows it as long as the child is in their
 *       family — see coachNotes.ts authorization.)
 */

import { useEffect, useState } from 'react';
import Link from '@/components/PageTransitionLink';
import { api } from '@/lib/api';
import { PlaceholderBody } from './shared/PlaceholderBody';
import type { WidgetProps } from '../types';

interface MergedNote {
  id: string;
  athleteFirstName: string;
  athleteId: string;
  coachName: string;
  sessionDate: string;
  content: string;
}

export function RecentCoachNotesWidget(_props: WidgetProps) {
  const [notes, setNotes] = useState<MergedNote[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const athletesRes = await api.getMyAthletes();
        const athletes = athletesRes.data || [];
        if (athletes.length === 0) {
          if (!cancelled) setNotes([]);
          return;
        }

        const perAthlete = await Promise.all(
          athletes.map(async (a) => {
            try {
              // AthleteProfile.id differs from User.id; getCoachNotes
              // expects the athlete's User.id. Since only the User.id
              // is persisted on AthleteProfile.userId, fall back to a
              // direct request.
              const res = await api.request<
                Array<{
                  id: string;
                  content: string;
                  sessionDate: string;
                  coach?: { fullName: string } | null;
                  athleteId: string;
                }>
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
              >(`/coach-notes/athlete/${(a as any).userId ?? a.id}?limit=3`);
              return (res.data || []).map((n) => ({
                id: n.id,
                athleteFirstName: a.firstName,
                athleteId: n.athleteId,
                coachName: n.coach?.fullName ?? 'Coach',
                sessionDate: n.sessionDate,
                content: n.content,
              }));
            } catch {
              return [];
            }
          })
        );

        const merged = perAthlete
          .flat()
          .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate))
          .slice(0, 3);

        if (!cancelled) setNotes(merged);
      } catch {
        if (!cancelled) setNotes([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (notes === null) {
    return (
      <div className="space-y-2">
        <div className="ppl-skeleton h-4" aria-hidden="true" />
        <div className="ppl-skeleton h-4 w-5/6" aria-hidden="true" />
        <div className="ppl-skeleton h-4 w-4/6" aria-hidden="true" />
      </div>
    );
  }

  if (notes.length === 0) {
    return (
      <PlaceholderBody
        line="No coach notes yet."
        cta="After your kid's next session, notes land here"
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      <ul className="flex-1 space-y-3 overflow-y-auto">
        {notes.map((n) => (
          <li key={n.id} className="border-b border-border/60 pb-2 last:border-none">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs font-medium text-foreground truncate">
                {n.athleteFirstName} · {n.coachName}
              </p>
              <span className="text-[10px] text-muted whitespace-nowrap">
                {new Date(n.sessionDate).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            </div>
            <p className="text-xs text-foreground/80 mt-1 leading-relaxed line-clamp-2">
              {n.content}
            </p>
          </li>
        ))}
      </ul>
      <Link
        href="/client/notes"
        className="mt-2 text-xs font-medium text-accent-text hover:brightness-110 self-start"
      >
        All notes →
      </Link>
    </div>
  );
}
