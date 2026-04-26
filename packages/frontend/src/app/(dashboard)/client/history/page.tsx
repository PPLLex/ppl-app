'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, BookingHistoryItem, SessionWithAvailability } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { EmptyState } from '@/components/EmptyState';

type StatusFilter = 'all' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export default function ClientBookingHistoryPage() {
  const { user } = useAuth();
  const [bookings, setBookings] = useState<BookingHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Reschedule modal state
  const [rescheduleTarget, setRescheduleTarget] = useState<BookingHistoryItem | null>(null);
  const [candidateSessions, setCandidateSessions] = useState<SessionWithAvailability[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [rescheduling, setRescheduling] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.getMyBookings({
        status: filter === 'all' ? undefined : filter,
        page,
      });
      if (res.data) setBookings(res.data);
      const raw = res as any;
      if (raw.pagination) setTotalPages(raw.pagination.totalPages);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [filter, page]);

  useEffect(() => {
    load();
  }, [load]);

  // When the user clicks Reschedule, fetch a 30-day window of bookable
  // sessions at the same location with the same session type, so they can
  // pick a replacement slot.
  const openReschedule = async (booking: BookingHistoryItem) => {
    setRescheduleTarget(booking);
    setLoadingCandidates(true);
    setCandidateSessions([]);
    try {
      const start = new Date();
      const end = new Date();
      end.setDate(end.getDate() + 30);
      // Resolve locationId via the user's homeLocation since BookingHistoryItem
      // surfaces locationName but not the id. Falls back to no-filter if we
      // can't resolve it.
      const locationId = user?.homeLocation?.id;
      const res = await api.getSessions({
        locationId,
        start: start.toISOString(),
        end: end.toISOString(),
        type: booking.session.type,
      });
      const all = res.data || [];
      // Exclude the current session, full sessions, and any session in the past.
      const now = Date.now();
      const filtered = all.filter(
        (s) =>
          s.id !== booking.session.id &&
          new Date(s.startTime).getTime() > now &&
          (s.maxCapacity ?? 0) - (s.currentEnrolled ?? 0) > 0
      );
      setCandidateSessions(filtered);
    } catch (err) {
      console.error('Failed to load reschedule candidates', err);
      setActionMessage({ kind: 'error', text: 'Could not load available sessions. Try again.' });
    } finally {
      setLoadingCandidates(false);
    }
  };

  const closeReschedule = () => {
    setRescheduleTarget(null);
    setCandidateSessions([]);
  };

  const confirmReschedule = async (newSessionId: string) => {
    if (!rescheduleTarget) return;
    setRescheduling(newSessionId);
    try {
      await api.rescheduleBooking(rescheduleTarget.id, newSessionId);
      setActionMessage({ kind: 'success', text: 'Session rescheduled. Confirmation email on the way.' });
      closeReschedule();
      await load();
    } catch (err) {
      setActionMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Failed to reschedule.',
      });
    } finally {
      setRescheduling(null);
    }
  };

  const handleCancel = async (booking: BookingHistoryItem) => {
    if (!confirm(`Cancel "${booking.session.title}"? Your credit will be returned to that week if you're within the cancellation window.`)) {
      return;
    }
    try {
      const res = await api.cancelBooking(booking.id, 'Cancelled from history page');
      const restored = res.data?.creditRestored;
      setActionMessage({
        kind: 'success',
        text: restored ? 'Cancelled and credit restored.' : 'Cancelled.',
      });
      await load();
    } catch (err) {
      setActionMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Failed to cancel.',
      });
    }
  };

  const STATUS_STYLES: Record<string, string> = {
    CONFIRMED: 'ppl-badge-active',
    COMPLETED: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
    CANCELLED: 'bg-red-500/10 text-red-400 border border-red-500/20',
    NO_SHOW: 'bg-orange-500/10 text-orange-400 border border-orange-500/20',
    WAITLISTED: 'ppl-badge-warning',
  };

  const filters: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'CONFIRMED', label: 'Upcoming' },
    { key: 'COMPLETED', label: 'Completed' },
    { key: 'CANCELLED', label: 'Cancelled' },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">My Bookings</h1>
        <p className="text-sm text-muted mt-0.5">Your session history and upcoming bookings</p>
      </div>

      {/* Toast-ish action result */}
      {actionMessage && (
        <div
          className={`mb-4 p-3 rounded-lg text-sm ${
            actionMessage.kind === 'success'
              ? 'bg-green-500/10 text-green-400 border border-green-500/20'
              : 'bg-red-500/10 text-red-400 border border-red-500/20'
          }`}
        >
          {actionMessage.text}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-1 mb-4 bg-surface rounded-lg p-1 w-fit">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => { setFilter(f.key); setPage(1); }}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              filter === f.key
                ? 'bg-highlight/20 text-accent-text'
                : 'text-muted hover:text-foreground'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Bookings List */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="ppl-card animate-pulse h-20" />
          ))}
        </div>
      ) : bookings.length > 0 ? (
        <div className="space-y-2">
          {bookings.map((booking) => {
            const start = new Date(booking.session.startTime);
            const end = new Date(booking.session.endTime);
            const isPast = start < new Date();
            const isConfirmedFuture = booking.status === 'CONFIRMED' && !isPast;

            return (
              <div
                key={booking.id}
                className={`ppl-card flex items-center gap-4 ${isPast ? 'opacity-70' : ''}`}
              >
                {/* Date Block */}
                <div className="w-14 h-14 rounded-lg bg-background flex flex-col items-center justify-center flex-shrink-0">
                  <span className="text-xs text-muted font-medium">
                    {start.toLocaleDateString('en-US', { month: 'short' })}
                  </span>
                  <span className="text-lg font-bold text-foreground leading-tight">
                    {start.getDate()}
                  </span>
                </div>

                {/* Session Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-foreground text-sm">{booking.session.title}</h3>
                    <span className={`ppl-badge text-xs ${STATUS_STYLES[booking.status] || ''}`}>
                      {booking.status}
                    </span>
                  </div>
                  <p className="text-xs text-muted mt-0.5">
                    {start.toLocaleDateString('en-US', { weekday: 'short' })}{' '}
                    {start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} –{' '}
                    {end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </p>
                  <p className="text-xs text-muted">
                    {booking.session.locationName}
                    {booking.session.roomName && ` — ${booking.session.roomName}`}
                  </p>
                </div>

                {/* Type Badge */}
                <span className="text-xs text-muted capitalize px-2 py-1 bg-background rounded hidden sm:inline-block">
                  {booking.session.type.replace(/_/g, ' ')}
                </span>

                {/* Actions */}
                {isConfirmedFuture && (
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => openReschedule(booking)}
                      className="ppl-btn ppl-btn-secondary text-xs px-3 py-1.5"
                    >
                      Reschedule
                    </button>
                    <button
                      onClick={() => handleCancel(booking)}
                      className="ppl-btn text-xs px-3 py-1.5 bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="ppl-btn ppl-btn-secondary text-xs disabled:opacity-30"
              >
                Previous
              </button>
              <span className="text-sm text-muted">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="ppl-btn ppl-btn-secondary text-xs disabled:opacity-30"
              >
                Next
              </button>
            </div>
          )}
        </div>
      ) : (
        <EmptyState
          icon="calendar"
          title="No sessions yet"
          description="Book your first session and your training history will start filling up here."
          href="/client/book"
          ctaLabel="Book a Session"
        />
      )}

      {/* Reschedule modal */}
      {rescheduleTarget && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={closeReschedule}
        >
          <div
            className="bg-surface border border-border rounded-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-border">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-foreground">Reschedule Session</h2>
                  <p className="text-xs text-muted mt-1">
                    Currently booked: {rescheduleTarget.session.title} on{' '}
                    {new Date(rescheduleTarget.session.startTime).toLocaleString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
                <button
                  onClick={closeReschedule}
                  className="text-muted hover:text-foreground p-1"
                  aria-label="Close"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {loadingCandidates ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((n) => (
                    <div key={n} className="ppl-card animate-pulse h-16" />
                  ))}
                </div>
              ) : candidateSessions.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted mb-2">
                    Pick a replacement slot — same location, same session type, next 30 days.
                    Your credit will move to whatever week you choose.
                  </p>
                  {candidateSessions.map((s) => {
                    const sStart = new Date(s.startTime);
                    const sEnd = new Date(s.endTime);
                    const remaining = (s.maxCapacity ?? 0) - (s.currentEnrolled ?? 0);
                    return (
                      <button
                        key={s.id}
                        onClick={() => confirmReschedule(s.id)}
                        disabled={rescheduling !== null}
                        className="w-full text-left ppl-card hover:border-highlight/40 transition-all flex items-center gap-3 disabled:opacity-50"
                      >
                        <div className="w-12 h-12 rounded-lg bg-background flex flex-col items-center justify-center flex-shrink-0">
                          <span className="text-[10px] text-muted">
                            {sStart.toLocaleDateString('en-US', { month: 'short' })}
                          </span>
                          <span className="text-base font-bold text-foreground leading-tight">
                            {sStart.getDate()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{s.title}</p>
                          <p className="text-xs text-muted">
                            {sStart.toLocaleDateString('en-US', { weekday: 'short' })}{' '}
                            {sStart.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} –{' '}
                            {sEnd.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                          </p>
                          {s.coach?.fullName && (
                            <p className="text-xs text-muted">Coach: {s.coach.fullName}</p>
                          )}
                        </div>
                        <span className="text-xs text-accent-text font-medium flex-shrink-0">
                          {remaining} spot{remaining !== 1 ? 's' : ''} left
                        </span>
                        {rescheduling === s.id && (
                          <span className="text-xs text-muted">Moving…</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-muted text-sm">
                  No matching sessions available in the next 30 days. You can cancel and rebook
                  later instead.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
