'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { api, MembershipDetail, Booking } from '@/lib/api';

export default function ClientDashboard() {
  const { user } = useAuth();
  const [membership, setMembership] = useState<MembershipDetail | null>(null);
  const [upcomingBookings, setUpcomingBookings] = useState<Booking[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    setIsLoading(true);
    try {
      const [memRes, bookingsRes] = await Promise.all([
        api.getMyMembership(),
        api.getUpcomingBookings({ upcoming: true }),
      ]);
      if (memRes.data !== undefined) setMembership(memRes.data);
      if (bookingsRes.data) {
        setUpcomingBookings(
          bookingsRes.data
            .filter((b: Booking) => b.status === 'CONFIRMED')
            .sort((a: Booking, b: Booking) => new Date(a.session.startTime).getTime() - new Date(b.session.startTime).getTime())
        );
      }
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setIsLoading(false);
    }
  }

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const mem = membership?.membership;
  const credits = membership?.credits;
  const nextBooking = upcomingBookings[0] || null;

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">
          {greeting()}, {user?.fullName?.split(' ')[0]}
        </h1>
        <p className="text-muted mt-1">
          {user?.homeLocation
            ? `Training at ${user.homeLocation.name}`
            : 'Ready to train'}
        </p>
      </div>

      {/* ACCOUNT LOCKED — Dummy Mode */}
      {mem && (mem.status === 'PAST_DUE' || mem.status === 'SUSPENDED') && (
        <div className="mb-6 p-6 bg-red-500/10 border-2 border-red-500/30 rounded-xl">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-red-400">Account On Hold</h2>
              <p className="text-sm text-foreground mt-1">
                {mem.status === 'PAST_DUE'
                  ? 'Your recent payment failed. Your account access is restricted until your payment is resolved.'
                  : 'Your membership has been suspended. Please contact us to restore access.'}
              </p>
              <p className="text-xs text-muted mt-2">
                While your account is on hold, you cannot book sessions, access training programs, or use any PPL features.
                You can update your payment method or change your membership below.
              </p>
              <div className="flex gap-3 mt-4">
                <Link href="/client/membership" className="ppl-btn ppl-btn-primary text-sm">
                  Update Payment Method
                </Link>
                <Link href="/client/membership" className="ppl-btn ppl-btn-secondary text-sm">
                  Change Membership
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Membership Cancelled */}
      {mem?.status === 'CANCELLED' && (
        <div className="mb-6 p-6 bg-surface border border-border rounded-xl">
          <h2 className="text-lg font-bold text-foreground">Membership Ended</h2>
          <p className="text-sm text-muted mt-1">
            Your membership has been cancelled. Sign up for a new membership to get back to training.
          </p>
          <Link href="/client/membership" className="ppl-btn ppl-btn-primary text-sm mt-3 inline-block">
            Restart Membership
          </Link>
        </div>
      )}

      {/* Quick Stats */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {[1, 2, 3].map((n) => <div key={n} className="ppl-card animate-pulse h-28" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {/* Membership Status */}
          <Link href="/client/membership" className="ppl-card hover:border-highlight/50 transition-colors">
            <p className="text-sm text-muted">Membership</p>
            {mem ? (
              <>
                <p className="text-lg font-bold text-accent-text mt-1">{mem.plan.name}</p>
                <span
                  className={`ppl-badge text-xs mt-2 ${
                    mem.status === 'ACTIVE'
                      ? 'ppl-badge-active'
                      : mem.status === 'PAST_DUE'
                      ? 'ppl-badge-danger'
                      : 'bg-surface text-muted'
                  }`}
                >
                  {mem.status === 'PAST_DUE' ? 'Past Due' : mem.status}
                </span>
              </>
            ) : (
              <>
                <p className="text-lg font-bold text-muted mt-1">No active plan</p>
                <span className="text-xs text-accent-text">Set up membership →</span>
              </>
            )}
          </Link>

          {/* Credits */}
          <div className="ppl-card">
            <p className="text-sm text-muted">Credits This Week</p>
            {credits ? (
              <>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-3xl font-bold text-accent-text">{credits.remaining}</span>
                  <span className="text-sm text-muted">/ {credits.total}</span>
                </div>
                <div className="h-2 bg-surface rounded-full overflow-hidden mt-2">
                  <div
                    className="h-full ppl-gradient rounded-full"
                    style={{ width: `${(credits.remaining / credits.total) * 100}%` }}
                  />
                </div>
              </>
            ) : mem?.plan.sessionsPerWeek === null ? (
              <>
                <p className="text-3xl font-bold text-accent-text mt-1">∞</p>
                <p className="text-xs text-muted">Unlimited sessions</p>
              </>
            ) : (
              <>
                <p className="text-2xl font-bold text-muted mt-1">—</p>
                <p className="text-xs text-muted">No membership</p>
              </>
            )}
          </div>

          {/* Next Session */}
          <div className="ppl-card">
            <p className="text-sm text-muted">Next Session</p>
            {nextBooking ? (
              <>
                <p className="text-lg font-bold text-foreground mt-1">{nextBooking.session.title}</p>
                <p className="text-xs text-muted mt-0.5">
                  {formatDate(nextBooking.session.startTime)} at {formatTime(nextBooking.session.startTime)}
                </p>
                {nextBooking.session.coach && (
                  <p className="text-xs text-muted">Coach: {nextBooking.session.coach.fullName}</p>
                )}
              </>
            ) : (
              <>
                <p className="text-lg font-bold text-muted mt-1">None booked</p>
                <Link href="/client/book" className="ppl-btn ppl-btn-primary text-xs mt-3 inline-block">
                  Book a Session
                </Link>
              </>
            )}
          </div>
        </div>
      )}

      {/* Upcoming Sessions */}
      <div className="ppl-card mb-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-foreground">Upcoming Sessions</h3>
          <Link href="/client/book" className="text-sm text-accent-text hover:underline">
            Book more →
          </Link>
        </div>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map((n) => <div key={n} className="h-16 bg-surface animate-pulse rounded-lg" />)}
          </div>
        ) : upcomingBookings.length > 0 ? (
          <div className="space-y-2">
            {upcomingBookings.slice(0, 5).map((booking) => {
              const isToday =
                new Date(booking.session.startTime).toDateString() === new Date().toDateString();
              const isTomorrow = (() => {
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                return new Date(booking.session.startTime).toDateString() === tomorrow.toDateString();
              })();

              return (
                <div key={booking.id} className="flex items-center justify-between p-3 bg-surface rounded-lg">
                  <div className="flex items-center gap-3">
                    {/* Date badge */}
                    <div className="w-12 h-12 rounded-lg bg-background flex flex-col items-center justify-center">
                      <span className="text-xs text-muted uppercase">
                        {new Date(booking.session.startTime).toLocaleDateString('en-US', { weekday: 'short' })}
                      </span>
                      <span className="text-lg font-bold text-foreground leading-none">
                        {new Date(booking.session.startTime).getDate()}
                      </span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground">{booking.session.title}</p>
                        {isToday && (
                          <span className="text-xs ppl-badge bg-highlight/20 text-accent-text border border-highlight/30">
                            TODAY
                          </span>
                        )}
                        {isTomorrow && (
                          <span className="text-xs ppl-badge bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            TOMORROW
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted">
                        {formatTime(booking.session.startTime)}
                        {booking.session.coach && ` · ${booking.session.coach.fullName}`}
                        {booking.session.room && ` · ${booking.session.room.name}`}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
            {upcomingBookings.length > 5 && (
              <Link
                href="/client/history"
                className="block text-center text-sm text-accent-text hover:underline py-2"
              >
                View all {upcomingBookings.length} upcoming sessions
              </Link>
            )}
          </div>
        ) : (
          <div className="text-center py-8">
            <div className="w-14 h-14 rounded-full bg-surface-hover flex items-center justify-center mx-auto mb-3">
              <svg className="w-7 h-7 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              </svg>
            </div>
            <p className="text-muted text-sm">No upcoming sessions</p>
            <Link href="/client/book" className="ppl-btn ppl-btn-primary text-sm mt-3 inline-block">
              Browse Available Sessions
            </Link>
          </div>
        )}
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/client/history"
          className="ppl-card text-center py-4 hover:border-highlight/50 transition-colors"
        >
          <p className="text-sm font-medium text-foreground">Booking History</p>
          <p className="text-xs text-muted mt-0.5">View past sessions</p>
        </Link>
        <Link
          href="/client/messages"
          className="ppl-card text-center py-4 hover:border-highlight/50 transition-colors"
        >
          <p className="text-sm font-medium text-foreground">Messages</p>
          <p className="text-xs text-muted mt-0.5">Chat with your coach</p>
        </Link>
      </div>
    </div>
  );
}
