'use client';

/**
 * SameTimeOtherDaysModal — intelligent post-booking prompt.
 *
 * After a client books a session (e.g. Monday 3:30pm Pitching), this
 * modal pops up if there are other sessions in the same week at the
 * same clock time with the same session type / room bucket that are
 * still available. The client picks the days they also want, and we
 * batch-book them in one call.
 *
 * Designed after the staff-permissions day picker Chad referenced —
 * big thumb-friendly chips, one tap per day, visual state that reads
 * at a glance. Skips entirely when there are no matching other-day
 * sessions; never interrupts the user for nothing.
 */

import { useMemo, useState } from 'react';
import { haptic } from '@/lib/haptic';
import type { SessionWithAvailability } from '@/lib/api';

interface Props {
  /** The session the user just booked — anchors time-of-day + type. */
  anchorSession: SessionWithAvailability;
  /** Every session this week, unfiltered (we filter internally). */
  allSessions: SessionWithAvailability[];
  /** Sessions the user already has booked this week (for exclusion). */
  alreadyBookedSessionIds: Set<string>;
  /** Credits remaining in the user's week, null for unlimited. */
  creditsRemaining: number | null;
  onClose: () => void;
  onConfirm: (sessionIds: string[]) => Promise<void>;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Same clock-time on the same calendar day? (HH:MM match, day-of-week match) */
function isSameTimeOfDay(a: Date, b: Date): boolean {
  return a.getHours() === b.getHours() && a.getMinutes() === b.getMinutes();
}

export function SameTimeOtherDaysModal({
  anchorSession,
  allSessions,
  alreadyBookedSessionIds,
  creditsRemaining,
  onClose,
  onConfirm,
}: Props) {
  const anchorStart = new Date(anchorSession.startTime);
  const anchorDayOfWeek = anchorStart.getDay();
  const anchorHHMM = `${String(anchorStart.getHours()).padStart(2, '0')}:${String(
    anchorStart.getMinutes()
  ).padStart(2, '0')}`;

  // Find candidate sessions: same week, same type, same clock time, DIFFERENT
  // day-of-week from the anchor, still has a spot, not already booked, and
  // not in the past.
  const candidates = useMemo(() => {
    const now = new Date();
    return allSessions
      .filter((s) => {
        if (s.id === anchorSession.id) return false;
        if (alreadyBookedSessionIds.has(s.id)) return false;
        if (s.sessionType !== anchorSession.sessionType) return false;
        if (s.spotsRemaining <= 0) return false;
        const st = new Date(s.startTime);
        if (st < now) return false;
        if (st.getDay() === anchorDayOfWeek) return false;
        return isSameTimeOfDay(st, anchorStart);
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSessions, anchorSession.id, anchorSession.sessionType, alreadyBookedSessionIds]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isBooking, setIsBooking] = useState(false);

  const toggle = (sessionId: string) => {
    haptic.light();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  const selectAll = () => {
    haptic.light();
    // Respect credit limit — don't let the user over-select and fail server-side.
    const limit =
      creditsRemaining === null ? candidates.length : Math.min(candidates.length, creditsRemaining);
    setSelected(new Set(candidates.slice(0, limit).map((c) => c.id)));
  };

  const clearAll = () => {
    haptic.light();
    setSelected(new Set());
  };

  const submit = async () => {
    if (selected.size === 0) {
      onClose();
      return;
    }
    setIsBooking(true);
    try {
      await onConfirm(Array.from(selected));
    } finally {
      setIsBooking(false);
    }
  };

  // Nothing matches — close silently so the UX isn't interrupted with
  // "sorry, no other options." Parent shouldn't even render this modal
  // in that case, but defensive early-return keeps it safe.
  if (candidates.length === 0) {
    return null;
  }

  const timeLabel = anchorStart.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  const overLimit =
    creditsRemaining !== null && selected.size > creditsRemaining;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-lg sm:text-xl uppercase tracking-[0.04em] text-foreground leading-tight">
                Book {timeLabel} another day this week?
              </h2>
              <p className="text-sm text-muted mt-1.5 leading-relaxed">
                Your {timeLabel} slot on{' '}
                <span className="text-foreground font-medium">
                  {DAY_NAMES_LONG[anchorDayOfWeek]}
                </span>{' '}
                is booked. Tap any other day below to grab the same time.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-muted hover:text-foreground text-2xl leading-none -mt-1"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {/* Day chips */}
          <div className="mt-5 grid grid-cols-2 gap-2">
            {candidates.map((s) => {
              const st = new Date(s.startTime);
              const dow = st.getDay();
              const dateLabel = st.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              });
              const isSelected = selected.has(s.id);
              const isTight = s.spotsRemaining <= 2;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggle(s.id)}
                  className={`flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-all text-left ${
                    isSelected
                      ? 'border-highlight bg-highlight/10'
                      : 'border-border hover:border-border-light bg-surface'
                  }`}
                >
                  <div>
                    <div className="font-accent italic font-black uppercase tracking-[0.04em] text-foreground text-base leading-none">
                      {DAY_NAMES[dow]}
                    </div>
                    <div className="text-[11px] text-muted mt-1">{dateLabel}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {isTight && (
                      <span className="text-[10px] uppercase tracking-[0.12em] text-amber-400">
                        {s.spotsRemaining} left
                      </span>
                    )}
                    <span
                      className={`w-5 h-5 rounded-md border-2 flex items-center justify-center ${
                        isSelected
                          ? 'border-highlight bg-highlight'
                          : 'border-border'
                      }`}
                    >
                      {isSelected && (
                        <svg
                          className="w-3 h-3 text-background"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={3}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Bulk select controls */}
          <div className="mt-3 flex items-center gap-3 text-xs">
            <button
              type="button"
              onClick={selectAll}
              className="text-accent-text hover:brightness-110 font-medium"
            >
              Select all {candidates.length}
            </button>
            <span className="text-muted">·</span>
            <button
              type="button"
              onClick={clearAll}
              className="text-muted hover:text-foreground"
            >
              Clear
            </button>
          </div>

          {/* Credit check */}
          {creditsRemaining !== null && (
            <p
              className={`text-xs mt-4 ${
                overLimit ? 'text-destructive' : 'text-muted'
              }`}
            >
              {overLimit
                ? `You only have ${creditsRemaining} credit${
                    creditsRemaining === 1 ? '' : 's'
                  } left this week — remove a day to continue.`
                : `${creditsRemaining} credit${
                    creditsRemaining === 1 ? '' : 's'
                  } left this week`}
            </p>
          )}

          {/* Actions */}
          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="text-sm font-medium text-muted hover:text-foreground px-3 py-3"
            >
              Not now
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={isBooking || selected.size === 0 || overLimit}
              className="ppl-btn ppl-btn-primary flex-1 py-3 text-base disabled:opacity-60"
            >
              {isBooking
                ? 'Booking…'
                : selected.size === 0
                  ? 'Skip'
                  : `Book ${selected.size} more`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
