'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, SessionWithAvailability, Booking, MyWeekData, BookingWithCancelInfo } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

const SESSION_TYPE_LABELS: Record<string, string> = {
  COLLEGE_PITCHING: 'College Pitching',
  MS_HS_PITCHING: 'MS/HS Pitching',
  YOUTH_PITCHING: 'Youth Pitching',
};

type BookingMode = 'single' | 'plan-week';

export default function ClientBookPage() {
  const { user } = useAuth();

  // Core data
  const [sessions, setSessions] = useState<SessionWithAvailability[]>([]);
  const [myWeek, setMyWeek] = useState<MyWeekData | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [bookingInProgress, setBookingInProgress] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Adaptive booking mode
  const [bookingMode, setBookingMode] = useState<BookingMode>('single');
  const [selectedForBatch, setSelectedForBatch] = useState<Set<string>>(new Set());
  const [showModeChoice, setShowModeChoice] = useState(false);

  // Current week starting Monday
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay() + 1);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const locationId = user?.homeLocation?.id;

  // Determine membership type for adaptive UX
  const sessionsPerWeek = myWeek?.membership?.sessionsPerWeek ?? null;
  const isUnlimited = myWeek?.membership?.isUnlimited ?? false;
  const canMultiBook = sessionsPerWeek === null || (sessionsPerWeek !== null && sessionsPerWeek >= 2);

  // Load all data
  const loadData = useCallback(async () => {
    if (!locationId) return;
    setIsLoading(true);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    try {
      const [sessionsRes, weekRes] = await Promise.all([
        api.getSessions({
          locationId,
          start: weekStart.toISOString(),
          end: weekEnd.toISOString(),
        }),
        api.getMyWeek(),
      ]);

      if (sessionsRes.data) setSessions(sessionsRes.data);
      if (weekRes.data) setMyWeek(weekRes.data);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [locationId, weekStart]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Generate week days
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  // Sessions for selected date
  const selectedDateSessions = selectedDate
    ? sessions.filter((s) => {
        const sDate = new Date(s.startTime);
        return sDate.toDateString() === selectedDate.toDateString();
      })
    : [];

  // Check if client is already booked
  const isBooked = (sessionId: string) =>
    myWeek?.bookings.some((b) => b.sessionId === sessionId && b.status === 'CONFIRMED') ?? false;

  // Check if registration is still open
  const isRegistrationOpen = (session: SessionWithAvailability) => {
    const cutoff = new Date(session.startTime);
    cutoff.setHours(cutoff.getHours() - session.registrationCutoffHours);
    return new Date() < cutoff;
  };

  // Check if cancellation is still allowed (4hr cutoff)
  const canCancelBooking = (booking: BookingWithCancelInfo) => {
    return booking.canCancel;
  };

  // Sessions per day count
  const sessionsCountByDay = weekDays.map((day) =>
    sessions.filter((s) => new Date(s.startTime).toDateString() === day.toDateString()).length
  );

  // ── BOOKING HANDLERS ──

  const handleBook = async (session: SessionWithAvailability) => {
    setMessage(null);
    setBookingInProgress(true);
    try {
      const res = await api.bookSession(session.id);
      setMessage({ type: 'success', text: res.message || 'Session booked!' });
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Booking failed';
      setMessage({ type: 'error', text: msg });
    } finally {
      setBookingInProgress(false);
    }
  };

  const handleBatchBook = async () => {
    if (selectedForBatch.size === 0) return;
    setMessage(null);
    setBookingInProgress(true);
    try {
      const res = await api.batchBookSessions(Array.from(selectedForBatch));
      setMessage({
        type: 'success',
        text: res.message || `${selectedForBatch.size} session(s) booked!`,
      });
      setSelectedForBatch(new Set());
      setBookingMode('single');
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Booking failed';
      setMessage({ type: 'error', text: msg });
    } finally {
      setBookingInProgress(false);
    }
  };

  const handleCancel = async (bookingId: string) => {
    setMessage(null);
    try {
      const res = await api.cancelBooking(bookingId);
      setMessage({
        type: 'success',
        text: res.message || 'Session cancelled. Your credit has been restored.',
      });
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Cancellation failed';
      setMessage({ type: 'error', text: msg });
    }
  };

  const toggleBatchSelect = (sessionId: string) => {
    setSelectedForBatch((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        // Check credit limits for limited plans
        if (myWeek?.credits && next.size >= myWeek.credits.remaining) {
          setMessage({
            type: 'error',
            text: `You only have ${myWeek.credits.remaining} credit(s) left this week.`,
          });
          return prev;
        }
        next.add(sessionId);
      }
      return next;
    });
  };

  const navigateWeek = (direction: number) => {
    setSelectedDate(null);
    setSelectedForBatch(new Set());
    setMessage(null);
    setWeekStart((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + direction * 7);
      return d;
    });
  };

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const formatDay = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  // ── RENDER ──

  return (
    <div className="max-w-2xl mx-auto pb-24">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Book a Session</h1>
        <p className="text-muted text-sm mt-1">
          {user?.homeLocation
            ? `${SESSION_TYPE_LABELS[sessions[0]?.sessionType] || 'Sessions'} at ${user.homeLocation.name}`
            : 'Select a date to see available sessions'}
        </p>
      </div>

      {/* ── MY WEEK CARD ── */}
      {myWeek?.membership && (
        <div className="mb-6 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-foreground">My Week</h2>
            {myWeek.credits ? (
              <div className="flex items-center gap-1.5">
                {Array.from({ length: myWeek.credits.total }, (_, i) => (
                  <div
                    key={i}
                    className={`w-3 h-3 rounded-full ${
                      i < myWeek.credits!.used
                        ? 'bg-muted/30'
                        : 'bg-accent'
                    }`}
                  />
                ))}
                <span className="text-xs text-muted ml-1.5">
                  {myWeek.credits.remaining} left
                </span>
              </div>
            ) : (
              <span className="text-xs font-medium text-accent-text px-2 py-0.5 rounded-full bg-accent/10">
                Unlimited
              </span>
            )}
          </div>

          {myWeek.bookings.length === 0 ? (
            <p className="text-sm text-muted">No sessions booked this week yet. Pick a day below to get started!</p>
          ) : (
            <div className="space-y-2">
              {myWeek.bookings.map((booking) => (
                <div
                  key={booking.id}
                  className="flex items-center justify-between bg-surface/60 rounded-xl px-3 py-2.5"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {formatDay(booking.session.startTime)} at {formatTime(booking.session.startTime)}
                    </p>
                    <p className="text-xs text-muted truncate">
                      {booking.session.room?.name || ''}
                      {booking.session.coach ? ` · ${booking.session.coach.fullName}` : ''}
                    </p>
                  </div>
                  {canCancelBooking(booking) ? (
                    <button
                      onClick={() => handleCancel(booking.id)}
                      className="ml-2 text-xs text-danger hover:text-danger/80 font-medium px-2 py-1 rounded-lg hover:bg-danger/10 transition-colors"
                    >
                      Cancel
                    </button>
                  ) : (
                    <span className="ml-2 text-xs text-muted/50">Locked</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Status message */}
      {message && (
        <div
          className={`mb-4 p-3 rounded-lg text-sm ${
            message.type === 'success'
              ? 'bg-primary/10 border border-primary/20 text-accent-text'
              : 'bg-danger/10 border border-danger/20 text-danger'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* ── BOOKING MODE SELECTOR (only for 2x+/unlimited) ── */}
      {canMultiBook && !showModeChoice && myWeek?.membership && (
        <div className="mb-4 flex gap-2">
          <button
            onClick={() => {
              setBookingMode('single');
              setSelectedForBatch(new Set());
            }}
            className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-medium transition-all ${
              bookingMode === 'single'
                ? 'ppl-gradient text-white shadow-md'
                : 'bg-surface border border-border text-muted hover:text-foreground hover:border-border-light'
            }`}
          >
            Book a Session
          </button>
          <button
            onClick={() => setBookingMode('plan-week')}
            className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-medium transition-all ${
              bookingMode === 'plan-week'
                ? 'ppl-gradient text-white shadow-md'
                : 'bg-surface border border-border text-muted hover:text-foreground hover:border-border-light'
            }`}
          >
            Plan My Week
          </button>
        </div>
      )}

      {/* Plan My Week instructions */}
      {bookingMode === 'plan-week' && (
        <div className="mb-4 p-3 rounded-lg bg-surface border border-border text-sm text-muted">
          Tap sessions across any day to select them, then confirm all at once.
          {myWeek?.credits && (
            <span className="font-medium text-foreground">
              {' '}You have {myWeek.credits.remaining} credit{myWeek.credits.remaining !== 1 ? 's' : ''} to use.
            </span>
          )}
        </div>
      )}

      {/* Week Navigation */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => navigateWeek(-1)} className="ppl-btn ppl-btn-secondary px-3">
          ← Prev
        </button>
        <span className="text-sm font-medium text-foreground">
          {weekStart.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} –{' '}
          {weekDays[6].toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
        </span>
        <button onClick={() => navigateWeek(1)} className="ppl-btn ppl-btn-secondary px-3">
          Next →
        </button>
      </div>

      {/* ── DATE PICKER ── */}
      <div className="grid grid-cols-7 gap-2 mb-6">
        {weekDays.map((day, i) => {
          const isToday = day.toDateString() === new Date().toDateString();
          const isSelected = selectedDate?.toDateString() === day.toDateString();
          const isPast = day < new Date() && !isToday;
          const sessionCount = sessionsCountByDay[i];

          return (
            <button
              key={i}
              onClick={() => {
                setSelectedDate(day);
                setMessage(null);
              }}
              disabled={isPast}
              className={`p-3 rounded-xl text-center transition-all ${
                isSelected
                  ? 'ppl-gradient text-white shadow-lg scale-105'
                  : isPast
                  ? 'bg-surface text-muted/50 cursor-not-allowed'
                  : isToday
                  ? 'bg-primary/10 border border-primary text-foreground hover:bg-primary/20'
                  : 'bg-surface border border-border text-foreground hover:border-border-light hover:bg-surface-hover'
              }`}
            >
              <p className="text-xs uppercase opacity-70">
                {day.toLocaleDateString('en-US', { weekday: 'short' })}
              </p>
              <p className="text-xl font-bold mt-0.5">{day.getDate()}</p>
              {sessionCount > 0 && !isPast && (
                <p className={`text-xs mt-1 ${isSelected ? 'text-white/80' : 'text-accent-text'}`}>
                  {sessionCount} session{sessionCount !== 1 ? 's' : ''}
                </p>
              )}
            </button>
          );
        })}
      </div>

      {/* ── SESSIONS LIST ── */}
      {selectedDate && (
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-3">
            {selectedDate.toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          </h2>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((n) => (
                <div key={n} className="ppl-card animate-pulse h-20" />
              ))}
            </div>
          ) : selectedDateSessions.length === 0 ? (
            <div className="ppl-card text-center py-8">
              <p className="text-muted">No sessions available on this date.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {selectedDateSessions
                .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
                .map((session) => {
                  const booked = isBooked(session.id);
                  const regOpen = isRegistrationOpen(session);
                  const full = session.spotsRemaining <= 0;
                  const myBooking = myWeek?.bookings.find(
                    (b) => b.sessionId === session.id && b.status === 'CONFIRMED'
                  );
                  const isSelectedForBatch = selectedForBatch.has(session.id);

                  return (
                    <div
                      key={session.id}
                      className={`ppl-card flex items-center justify-between transition-all ${
                        booked
                          ? 'border-primary'
                          : isSelectedForBatch
                          ? 'border-accent bg-primary/5'
                          : ''
                      }`}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-foreground">
                            {formatTime(session.startTime)} – {formatTime(session.endTime)}
                          </span>
                          {booked && (
                            <span className="ppl-badge ppl-badge-active">Booked ✓</span>
                          )}
                          {full && !booked && (
                            <span className="text-xs font-bold text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full">
                              Full
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted">
                          {SESSION_TYPE_LABELS[session.sessionType] || session.title}
                          {session.room && <span> · {session.room.name}</span>}
                          {session.coach && <span> · {session.coach.fullName}</span>}
                        </p>
                        <p className="text-xs text-muted mt-1">
                          {full
                            ? 'No spots available'
                            : `${session.spotsRemaining} spot${session.spotsRemaining !== 1 ? 's' : ''} open`}
                        </p>
                      </div>

                      <div className="ml-3">
                        {booked && myBooking ? (
                          // Already booked — show cancel only if within cutoff window
                          canCancelBooking(myBooking) ? (
                            <button
                              onClick={() => handleCancel(myBooking.id)}
                              className="text-xs text-danger font-medium px-3 py-1.5 rounded-lg border border-danger/30 hover:bg-danger/10 transition-colors"
                            >
                              Cancel
                            </button>
                          ) : null /* Cancel button disappears after cutoff */
                        ) : full ? (
                          // Session is full — just show "Full" text
                          <span className="text-xs text-red-400/70 font-medium">Full</span>
                        ) : !regOpen ? (
                          // Registration closed
                          <span className="text-xs text-muted">Closed</span>
                        ) : bookingMode === 'plan-week' ? (
                          // Plan My Week mode — toggle selection
                          <button
                            onClick={() => toggleBatchSelect(session.id)}
                            className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                              isSelectedForBatch
                                ? 'ppl-gradient text-white shadow-md'
                                : 'border-2 border-border hover:border-accent'
                            }`}
                          >
                            {isSelectedForBatch && (
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </button>
                        ) : (
                          // Single book mode
                          <button
                            onClick={() => handleBook(session)}
                            disabled={bookingInProgress}
                            className="ppl-btn ppl-btn-primary text-sm"
                          >
                            {bookingInProgress ? 'Booking...' : 'Book'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* ── BATCH CONFIRM BAR (fixed at bottom) ── */}
      {bookingMode === 'plan-week' && selectedForBatch.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-surface/95 backdrop-blur-sm border-t border-border p-4 z-50">
          <div className="max-w-2xl mx-auto flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">
                {selectedForBatch.size} session{selectedForBatch.size !== 1 ? 's' : ''} selected
              </p>
              {myWeek?.credits && (
                <p className="text-xs text-muted">
                  {myWeek.credits.remaining - selectedForBatch.size} credit{(myWeek.credits.remaining - selectedForBatch.size) !== 1 ? 's' : ''} will remain
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setSelectedForBatch(new Set());
                  setBookingMode('single');
                }}
                className="ppl-btn ppl-btn-secondary text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleBatchBook}
                disabled={bookingInProgress}
                className="ppl-btn ppl-btn-primary text-sm"
              >
                {bookingInProgress ? 'Booking...' : `Confirm ${selectedForBatch.size} Session${selectedForBatch.size !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
