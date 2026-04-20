'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { api, MembershipStats, SessionWithAvailability } from '@/lib/api';

interface TodayStats {
  sessionsToday: number;
  bookingsToday: number;
  upcomingSessions: SessionWithAvailability[];
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const [memberStats, setMemberStats] = useState<MembershipStats | null>(null);
  const [todayStats, setTodayStats] = useState<TodayStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    setIsLoading(true);
    try {
      // Load membership stats
      const statsRes = await api.getMembershipStats();
      if (statsRes.data) setMemberStats(statsRes.data);

      // Load today's sessions
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayEnd = new Date(todayStart);
      todayEnd.setDate(todayEnd.getDate() + 1);

      const sessionsRes = await api.getSessions({
        start: todayStart.toISOString(),
        end: todayEnd.toISOString(),
      });

      if (sessionsRes.data) {
        const sessions = sessionsRes.data;
        const totalBookings = sessions.reduce((sum, s) => sum + s.currentEnrolled, 0);
        setTodayStats({
          sessionsToday: sessions.length,
          bookingsToday: totalBookings,
          upcomingSessions: sessions
            .filter((s) => new Date(s.startTime) > now)
            .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
            .slice(0, 5),
        });
      }
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setIsLoading(false);
    }
  }

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const formatPrice = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">
          {greeting()}, {user?.fullName?.split(' ')[0]}
        </h1>
        <p className="text-muted mt-1">Here&apos;s what&apos;s happening at PPL today.</p>
      </div>

      {/* Stats Grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="ppl-card animate-pulse h-24" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <Link href="/admin/members" className="ppl-card hover:border-ppl-dark-green/50 transition-colors">
            <p className="text-sm text-muted">Active Members</p>
            <p className="text-3xl font-bold mt-1 text-ppl-light-green">
              {memberStats?.activeMemberships ?? '—'}
            </p>
          </Link>
          <div className="ppl-card">
            <p className="text-sm text-muted">Sessions Today</p>
            <p className="text-3xl font-bold mt-1 text-foreground">
              {todayStats?.sessionsToday ?? '—'}
            </p>
            <p className="text-xs text-muted mt-0.5">
              {todayStats ? `${todayStats.bookingsToday} bookings` : ''}
            </p>
          </div>
          <Link href="/admin/revenue" className="ppl-card hover:border-ppl-dark-green/50 transition-colors">
            <p className="text-sm text-muted">Total Revenue</p>
            <p className="text-3xl font-bold mt-1 text-ppl-light-green">
              {memberStats ? formatPrice(memberStats.totalRevenueCents) : '—'}
            </p>
          </Link>
          <Link href="/admin/billing" className="ppl-card hover:border-ppl-dark-green/50 transition-colors">
            <p className="text-sm text-muted">Past Due</p>
            <p className={`text-3xl font-bold mt-1 ${(memberStats?.pastDueMemberships ?? 0) > 0 ? 'text-red-400' : 'text-foreground'}`}>
              {memberStats?.pastDueMemberships ?? '—'}
            </p>
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Today's Schedule */}
        <div className="ppl-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground">Today&apos;s Schedule</h3>
            <Link href="/admin/schedule" className="text-xs text-ppl-light-green hover:underline">
              View All →
            </Link>
          </div>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((n) => <div key={n} className="h-14 bg-surface animate-pulse rounded-lg" />)}
            </div>
          ) : todayStats && todayStats.upcomingSessions.length > 0 ? (
            <div className="space-y-2">
              {todayStats.upcomingSessions.map((s) => (
                <div key={s.id} className="flex items-center justify-between p-3 bg-surface rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-foreground">{s.title}</p>
                    <p className="text-xs text-muted">
                      {formatTime(s.startTime)}
                      {s.coach && ` · ${s.coach.fullName}`}
                      {s.room && ` · ${s.room.name}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-bold ${s.currentEnrolled >= s.maxCapacity ? 'text-red-400' : 'text-ppl-light-green'}`}>
                      {s.currentEnrolled}/{s.maxCapacity}
                    </p>
                    <p className="text-xs text-muted">spots</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted py-4 text-center">
              {todayStats?.sessionsToday === 0 ? 'No sessions scheduled today.' : 'All sessions complete for today.'}
            </p>
          )}
        </div>

        {/* Pending Actions */}
        <div className="ppl-card">
          <h3 className="font-semibold text-foreground mb-4">Action Items</h3>
          <div className="space-y-2">
            {memberStats && memberStats.pastDueMemberships > 0 && (
              <Link
                href="/admin/billing"
                className="flex items-center justify-between p-3 bg-red-500/5 border border-red-500/20 rounded-lg hover:bg-red-500/10 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-red-400" />
                  <span className="text-sm text-foreground">Past due accounts need attention</span>
                </div>
                <span className="text-sm font-bold text-red-400">{memberStats.pastDueMemberships}</span>
              </Link>
            )}
            {memberStats && memberStats.pendingCancelRequests > 0 && (
              <Link
                href="/admin/billing"
                className="flex items-center justify-between p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg hover:bg-amber-500/10 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span className="text-sm text-foreground">Cancellation requests pending</span>
                </div>
                <span className="text-sm font-bold text-amber-400">{memberStats.pendingCancelRequests}</span>
              </Link>
            )}
            {memberStats && memberStats.pendingCardChangeRequests > 0 && (
              <Link
                href="/admin/billing"
                className="flex items-center justify-between p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg hover:bg-blue-500/10 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-blue-400" />
                  <span className="text-sm text-foreground">Card update requests</span>
                </div>
                <span className="text-sm font-bold text-blue-400">{memberStats.pendingCardChangeRequests}</span>
              </Link>
            )}
            {memberStats &&
              memberStats.pastDueMemberships === 0 &&
              memberStats.pendingCancelRequests === 0 &&
              memberStats.pendingCardChangeRequests === 0 && (
                <div className="text-center py-4">
                  <p className="text-sm text-ppl-light-green font-medium">All clear — no pending actions!</p>
                </div>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}
