'use client';

/**
 * AttachedAthletesWidget — outside-coach dashboard.
 *
 * Lists every athlete who has added the signed-in coach as an outside
 * coach (via OutsideCoachLink.coachEmail). Clicking an athlete would
 * future-route to an athlete detail view; for MVP we just render a
 * compact list with names, ages, and affiliations.
 */

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { PlaceholderBody } from './shared/PlaceholderBody';
import type { WidgetProps } from '../types';

interface AttachedAthlete {
  linkId: string;
  organization: string | null;
  coachRole: string | null;
  athlete: {
    id: string;
    firstName: string;
    lastName: string;
    ageGroup: string | null;
    userId: string;
  };
}

const LEVEL_LABELS: Record<string, string> = {
  youth: 'Youth',
  ms_hs: 'MS/HS',
  college: 'College',
  pro: 'Pro',
};

export function AttachedAthletesWidget(_props: WidgetProps) {
  const [list, setList] = useState<AttachedAthlete[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.request<AttachedAthlete[]>('/outside-coaches/athletes');
        if (!cancelled) setList(res.data ?? []);
      } catch {
        if (!cancelled) setList([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (list === null) {
    return (
      <div className="space-y-2">
        <div className="ppl-skeleton h-10" aria-hidden="true" />
        <div className="ppl-skeleton h-10" aria-hidden="true" />
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <PlaceholderBody
        line="No athletes have added you yet."
        cta="Ask a parent to link you from their account"
      />
    );
  }

  return (
    <ul className="space-y-2">
      {list.map((l) => (
        <li
          key={l.linkId}
          className="rounded-lg border border-border bg-background/50 px-3 py-2 flex items-center justify-between gap-3"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground truncate">
              {l.athlete.firstName} {l.athlete.lastName}
            </p>
            <p className="text-[11px] text-muted mt-0.5">
              {[
                l.athlete.ageGroup ? LEVEL_LABELS[l.athlete.ageGroup] || l.athlete.ageGroup : null,
                l.organization,
                l.coachRole,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
