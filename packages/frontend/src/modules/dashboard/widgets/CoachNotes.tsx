'use client';

/**
 * CoachNotesWidget — self-managed athlete dashboard.
 *
 * Pulls from GET /api/coach-notes/my and renders the 3 most recent
 * notes with coach name, session date, and a 2-line clamp of content.
 */

import { useEffect, useState } from 'react';
import Link from '@/components/PageTransitionLink';
import { api } from '@/lib/api';
import { PlaceholderBody } from './shared/PlaceholderBody';
import type { WidgetProps } from '../types';

interface Note {
  id: string;
  content: string;
  sessionDate: string;
  trainingCategory?: string | null;
  coach?: { fullName: string } | null;
}

export function CoachNotesWidget(_props: WidgetProps) {
  const [notes, setNotes] = useState<Note[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getMyAthleteNotes({ limit: 3 });
        if (!cancelled) setNotes((res.data as Note[]) || []);
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
        cta="After your next session, your coach's notes land here"
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
                {n.coach?.fullName || 'Coach'}
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
