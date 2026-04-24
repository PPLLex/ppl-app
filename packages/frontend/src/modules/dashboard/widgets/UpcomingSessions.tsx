'use client';

/**
 * UpcomingSessions widget — parent dashboard's primary CTA.
 *
 * Shows the next 3 upcoming bookings across all athletes on the account,
 * with a "Book a session" button that routes to the schedule. Empty
 * state invites the user to book their first session.
 *
 * Data source: /api/bookings?upcoming=true (existing endpoint).
 */

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import Link from '@/components/PageTransitionLink';
import type { WidgetProps } from '../types';

interface BookingRow {
  id: string;
  startTime: string;
  endTime: string;
  sessionTitle: string;
  locationName?: string | null;
  athleteName?: string | null;
}

export function UpcomingSessionsWidget(_props: WidgetProps) {
  const [bookings, setBookings] = useState<BookingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Shape may evolve — the grid renders gracefully when the array
        // is empty or the call fails.
        const res = await api.request<{ bookings?: BookingRow[] }>(
          '/bookings?upcoming=true&limit=3'
        );
        if (cancelled) return;
        const rows = (res.data?.bookings ?? []) as BookingRow[];
        setBookings(rows);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load');
        setBookings([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const formatWhen = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  if (bookings === null) {
    // Loading state — shimmer rows.
    return (
      <div className="space-y-2">
        <div className="ppl-skeleton h-12" aria-hidden="true" />
        <div className="ppl-skeleton h-12" aria-hidden="true" />
      </div>
    );
  }

  if (error || bookings.length === 0) {
    return (
      <div className="flex flex-col items-start justify-between h-full gap-3">
        <p className="text-sm text-muted leading-snug">
          No sessions booked yet. Pick a time that works for you.
        </p>
        <Link
          href="/client/schedule"
          className="ppl-btn ppl-btn-primary text-sm"
        >
          Book a session
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-3">
      <ul className="space-y-2 flex-1">
        {bookings.map((b) => (
          <li
            key={b.id}
            className="rounded-lg border border-border bg-background/50 px-3 py-2 flex items-center justify-between gap-3"
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground truncate">
                {b.sessionTitle}
              </div>
              <div className="text-[11px] text-muted mt-0.5 truncate">
                {formatWhen(b.startTime)}
                {b.locationName ? ` · ${b.locationName}` : ''}
              </div>
            </div>
            {b.athleteName && (
              <span className="text-[11px] uppercase tracking-[0.12em] text-accent-text whitespace-nowrap">
                {b.athleteName}
              </span>
            )}
          </li>
        ))}
      </ul>
      <Link
        href="/client/schedule"
        className="text-xs font-medium text-accent-text hover:brightness-110 self-start"
      >
        Book another session →
      </Link>
    </div>
  );
}
