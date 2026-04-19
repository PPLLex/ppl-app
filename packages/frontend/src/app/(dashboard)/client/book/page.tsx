'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, SessionWithAvailability, Booking } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

const SESSION_TYPE_LABELS: Record<string, string> = {
  COLLEGE_PITCHING: 'College Pitching',
  MS_HS_PITCHING: 'MS/HS Pitching',
  YOUTH_PITCHING: 'Youth Pitching',
};

export default function ClientBookPage() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<SessionWithAvailability[]>([]);
  const [myBookings, setMyBookings] = useState<Booking[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedSession, setSelectedSession] = useState<SessionWithAvailability | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [bookingInProgress, setBookingInProgress] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Current week starting Monday
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay() + 1);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const locationId = user?.homeLocation?.id;

  // Load sessions and bookings
  const loadData = useCallback(async () => {
    if (!locationId) return;
    setIsLoading(true);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    try {
      const [sessionsRes, bookingsRes] = await Promise.all([
        api.getSessions({
          locationId,
          start: weekStart.toISOString(),
          end: weekEnd.toISOString(),
        }),
        api.getUpcomingBookings({ upcoming: true }),
      ]);

      if (sessionsRes.data) setSessions(sessionsRes.data);
      if (bookingsRes.data) setMyBookings(bookingsRes.data);
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

  // Check if client is already booked for a session
  const isBooked = (sessionId: string) =>
    myBookings.some((b) => b.sessionId === sessionId && b.status === 'CONFIRMED');

  // Check if registration is still open
  const isRegistrationOpen = (session: SessionWithAvailability) => {
    const cutoff = new Date(session.startTime);
    cutoff.setHours(cutoff.getHours() - session.registrationCutoffHours);
    return new Date() < cutoff;
  };

  // Count sessions per day for the date picker
  const sessionsCountByDay = weekDays.map((day) => {
    return sessions.filter((s) => new Date(s.startTime).toDateString() === day.toDateString()).length;
  });

  const handleBook = async (session: SessionWithAvailability) => {
    setMessage(null);
    setBookingInProgress(true);

    try {
      const res = await api.bookSession(session.id);
      setMessage({ type: 'success', text: res.message || 'Session booked!' });
      setSelectedSession(null);
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Booking failed';
      setMessage({ type: 'error', text: msg });
    } finally {
      setBookingInProgress(false);
    }
  };

  const handleCancel = async (booking: Booking) => {
    setMessage(null);

    try {
      const res = await api.cancelBooking(booking.id);
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

  const handleJoinWaitlist = async (sessionId: string) => {
    setMessage(null);
    setBookingInProgress(true);

    try {
      const res = await api.request<{ position: number }>(`/sessions/${sessionId}/waitlist`, {
        method: 'POST',
      });
      setMessage({
        type: 'success',
        text: res.message || "You've been added to the waitlist! We'll notify you when a spot opens.",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to join waitlist';
      setMessage({ type: 'error', text: msg });
    } finally {
      setBookingInProgress(false);
    }
  };

  const navigateWeek = (direction: number) => {
    setSelectedDate(null);
    setSelectedSession(null);
    setWeekStart((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + direction * 7);
      return d;
    });
  };

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Book a Session</h1>
        <p className="text-muted text-sm mt-1">
          {user?.homeLocation ? `Showing sessions at ${user.homeLocation.name}` : 'Select a date to see available sessions'}
        </p>
      </div>

      {/* Status message */}
      {message && (
        <div
          className={`mb-4 p-3 rounded-lg text-sm ${
            message.type === 'success'
              ? 'bg-ppl-dark-green/10 border border-ppl-dark-green/20 text-ppl-light-green'
              : 'bg-danger/10 border border-danger/20 text-danger'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Week Navigation */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => navigateWeek(-1)} className="ppl-btn ppl-btn-secondary px-3">
          &larr; Prev
        </button>
        <span className="text-sm font-medium text-foreground">
          {weekStart.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} &ndash;{' '}
          {weekDays[6].toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
        </span>
        <button onClick={() => navigateWeek(1)} className="ppl-btn ppl-btn-secondary px-3">
          Next &rarr;
        </button>
      </div>

      {/* Calendly-style Date Picker */}
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
                setSelectedSession(null);
              }}
              disabled={isPast}
              className={`p-3 rounded-xl text-center transition-all ${
                isSelected
                  ? 'ppl-gradient text-white shadow-lg scale-105'
                  : isPast
                  ? 'bg-surface text-muted/50 cursor-not-allowed'
                  : isToday
                  ? 'bg-ppl-dark-green/10 border border-ppl-dark-green text-foreground hover:bg-ppl-dark-green/20'
                  : 'bg-surface border border-border text-foreground hover:border-border-light hover:bg-surface-hover'
              }`}
            >
              <p className="text-xs uppercase opacity-70">
                {day.toLocaleDateString('en-US', { weekday: 'short' })}
              </p>
              <p className="text-xl font-bold mt-0.5">{day.getDate()}</p>
              {sessionCount > 0 && !isPast && (
                <p className={`text-xs mt-1 ${isSelected ? 'text-white/80' : 'text-ppl-light-green'}`}>
                  {sessionCount} session{sessionCount !== 1 ? 's' : ''}
                </p>
              )}
            </button>
          );
        })}
      </div>

      {/* Available Sessions for Selected Date */}
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
                  const myBooking = myBookings.find(
                    (b) => b.sessionId === session.id && b.status === 'CONFIRMED'
                  );

                  return (
                    <div
                      key={session.id}
                      className={`ppl-card flex items-center justify-between transition-all ${
                        booked ? 'border-ppl-dark-green' : ''
                      }`}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-foreground">
                            {formatTime(session.startTime)} - {formatTime(session.endTime)}
                          </span>
                          {booked && <span className="ppl-badge ppl-badge-active">Booked</span>}
                          {full && !booked && <span className="ppl-badge ppl-badge-danger">Full</span>}
                        </div>
                        <p className="text-sm text-muted">
                          {SESSION_TYPE_LABELS[session.sessionType] || session.title}
                          {session.room && <span> &middot; {session.room.name}</span>}
                          {session.coach && <span> &middot; {session.coach.fullName}</span>}
                        </p>
                        <p className="text-xs text-muted mt-1">
                          {session.spotsRemaining} of {session.maxCapacity} spots remaining
                        </p>
                      </div>

                      <div>
                        {booked && myBooking ? (
                          <button
                            onClick={() => handleCancel(myBooking)}
                            className="ppl-btn ppl-btn-danger text-xs"
                          >
                            Cancel
                          </button>
                        ) : full ? (
                          <button
                            onClick={() => handleJoinWaitlist(session.id)}
                            disabled={bookingInProgress}
                            className="ppl-btn ppl-btn-secondary text-xs"
                          >
                            Join Waitlist
                          </button>
                        ) : !regOpen ? (
                          <span className="text-xs text-muted">Closed</span>
                        ) : (
                          <button
                            onClick={() => handleBook(session)}
                            disabled={bookingInProgress}
                            className="ppl-btn ppl-btn-primary"
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

      {/* My Upcoming Bookings */}
      {myBookings.filter((b) => b.status === 'CONFIRMED').length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-foreground mb-3">My Upcoming Sessions</h2>
          <div className="space-y-2">
            {myBookings
              .filter((b) => b.status === 'CONFIRMED')
              .map((booking) => (
                <div key={booking.id} className="ppl-card flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground text-sm">
                      {booking.session.title || SESSION_TYPE_LABELS[booking.session.sessionType]}
                    </p>
                    <p className="text-xs text-muted">
                      {new Date(booking.session.startTime).toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })}{' '}
                      at {formatTime(booking.session.startTime)}
                      {booking.session.room && <span> &middot; {booking.session.room.name}</span>}
                    </p>
                  </div>
                  <button
                    onClick={() => handleCancel(booking)}
                    className="ppl-btn ppl-btn-secondary text-xs text-danger border-danger/30 hover:bg-danger/10"
                  >
                    Cancel
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
