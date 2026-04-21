'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { api, DashboardStats, DashboardTodaySession } from '@/lib/api';

export default function AdminDashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDashboard();
    // Auto-refresh every 60 seconds
    const interval = setInterval(loadDashboard, 60000);
    return () => clearInterval(interval);
  }, []);

  async function loadDashboard() {
    try {
      const res = await api.getDashboardStats();
      if (res.data) {
        setStats(res.data);
        setError(null);
      }
    } catch (err) {
      console.error('Dashboard load error:', err);
      setError('Failed to load dashboard');
    } finally {
      setIsLoading(false);
    }
  }

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const formatPrice = (cents: number) =>
    `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const formatActionLabel = (action: string) => {
    return action
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .replace(/^(Create|Update|Delete|Cancel|Retry|Send|Mark|Bulk)/, (m) => m);
  };

  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  // Skeleton loader
  if (isLoading) {
    return (
      <div>
        <div className="mb-8">
          <div className="h-8 w-64 bg-surface animate-pulse rounded-lg" />
          <div className="h-4 w-48 bg-surface animate-pulse rounded-lg mt-2" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[1, 2, 3, 4].map((n) => <div key={n} className="ppl-card animate-pulse h-28" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 ppl-card animate-pulse h-72" />
          <div className="ppl-card animate-pulse h-72" />
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="text-center py-16">
        <p className="text-red-400">{error || 'Failed to load dashboard'}</p>
        <button onClick={loadDashboard} className="ppl-btn ppl-btn-primary mt-4 text-sm">
          Retry
        </button>
      </div>
    );
  }

  const { today, membership, revenue, weeklyBookingTrend, utilizationRate, atRiskMembers, pendingActions, recentActivity } = stats;

  // Compute max for the booking trend bar chart
  const maxTrend = Math.max(...weeklyBookingTrend.map((d) => d.count), 1);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {greeting()}, {user?.fullName?.split(' ')[0]}
          </h1>
          <p className="text-muted mt-1">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        {pendingActions.total > 0 && (
          <Link href="/admin/billing" className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg hover:bg-red-500/20 transition-colors">
            <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
            <span className="text-sm font-medium text-red-400">{pendingActions.total} action{pendingActions.total !== 1 ? 's' : ''} needed</span>
          </Link>
        )}
      </div>

      {/* ── Top Metric Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* Active Members */}
        <Link href="/admin/members" className="ppl-card hover:border-primary/50 transition-colors group">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted">Active Members</p>
            <svg className="w-4 h-4 text-muted group-hover:text-accent-text transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <p className="text-3xl font-bold mt-2 text-accent-text">{membership.active}</p>
          {membership.newSignups7d > 0 && (
            <p className="text-xs text-accent-text mt-1">+{membership.newSignups7d} this week</p>
          )}
        </Link>

        {/* MRR */}
        <Link href="/admin/revenue" className="ppl-card hover:border-primary/50 transition-colors group">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted">Monthly Revenue</p>
            <svg className="w-4 h-4 text-muted group-hover:text-accent-text transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-3xl font-bold mt-2 text-accent-text">{formatPrice(revenue.mrr)}</p>
          {revenue.revenueChange !== 0 && (
            <p className={`text-xs mt-1 ${revenue.revenueChange > 0 ? 'text-accent-text' : 'text-red-400'}`}>
              {revenue.revenueChange > 0 ? '↑' : '↓'} {Math.abs(revenue.revenueChange)}% vs prev 30d
            </p>
          )}
        </Link>

        {/* Today's Sessions */}
        <Link href="/admin/checkin" className="ppl-card hover:border-primary/50 transition-colors group">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted">Today&apos;s Sessions</p>
            <svg className="w-4 h-4 text-muted group-hover:text-accent-text transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <p className="text-3xl font-bold mt-2 text-foreground">{today.totalSessions}</p>
          <p className="text-xs text-muted mt-1">
            {today.totalBookings} booked · {today.totalCheckedIn} checked in
          </p>
        </Link>

        {/* Utilization */}
        <div className="ppl-card">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted">Utilization (7d)</p>
            <svg className="w-4 h-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <p className={`text-3xl font-bold mt-2 ${utilizationRate >= 70 ? 'text-accent-text' : utilizationRate >= 40 ? 'text-amber-400' : 'text-red-400'}`}>
            {utilizationRate}%
          </p>
          <div className="h-2 bg-surface rounded-full overflow-hidden mt-2">
            <div
              className={`h-full rounded-full transition-all ${utilizationRate >= 70 ? 'ppl-gradient' : utilizationRate >= 40 ? 'bg-amber-400' : 'bg-red-400'}`}
              style={{ width: `${Math.min(utilizationRate, 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* ── Main Content Grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">

        {/* Today's Schedule (2/3 width) */}
        <div className="lg:col-span-2 ppl-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground">Today&apos;s Schedule</h3>
            <div className="flex items-center gap-3">
              <Link href="/admin/checkin" className="text-xs text-accent-text hover:underline">
                Check In →
              </Link>
              <Link href="/admin/schedule" className="text-xs text-muted hover:text-foreground">
                Full Schedule →
              </Link>
            </div>
          </div>
          {today.sessions.length > 0 ? (
            <div className="space-y-2">
              {today.sessions.map((s: DashboardTodaySession) => (
                <div key={s.id} className={`flex items-center justify-between p-3 rounded-lg ${s.isActive ? 'bg-primary/10 border border-primary/30' : 'bg-surface'}`}>
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Time column */}
                    <div className="w-16 flex-shrink-0 text-center">
                      <p className="text-sm font-medium text-foreground">{formatTime(s.startTime)}</p>
                      {s.isActive && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-accent-text uppercase">
                          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                          Live
                        </span>
                      )}
                      {s.isPast && (
                        <span className="text-[10px] text-muted uppercase">Done</span>
                      )}
                    </div>
                    {/* Info */}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{s.title}</p>
                      <p className="text-xs text-muted">
                        {s.coach?.name || 'No coach'}
                        {s.room ? ` · ${s.room.name}` : ''}
                      </p>
                    </div>
                  </div>
                  {/* Attendance mini-bar */}
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="flex items-center gap-2 text-xs">
                      {s.checkedIn > 0 && (
                        <span className="flex items-center gap-1 text-accent-text">
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                          {s.checkedIn}
                        </span>
                      )}
                      {s.noShows > 0 && (
                        <span className="flex items-center gap-1 text-red-400">
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                          {s.noShows}
                        </span>
                      )}
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-bold ${s.enrolled >= s.maxCapacity ? 'text-red-400' : 'text-foreground'}`}>
                        {s.enrolled}/{s.maxCapacity}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-muted text-sm">No sessions scheduled today</p>
            </div>
          )}
        </div>

        {/* Right sidebar column */}
        <div className="space-y-4">
          {/* Action Items */}
          <div className="ppl-card">
            <h3 className="font-semibold text-foreground mb-3">Action Items</h3>
            {pendingActions.total > 0 ? (
              <div className="space-y-2">
                {pendingActions.pastDue > 0 && (
                  <Link href="/admin/billing" className="flex items-center justify-between p-2.5 bg-red-500/5 border border-red-500/20 rounded-lg hover:bg-red-500/10 transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-red-400" />
                      <span className="text-sm text-foreground">Past due accounts</span>
                    </div>
                    <span className="text-sm font-bold text-red-400">{pendingActions.pastDue}</span>
                  </Link>
                )}
                {pendingActions.cancelRequests > 0 && (
                  <Link href="/admin/billing" className="flex items-center justify-between p-2.5 bg-amber-500/5 border border-amber-500/20 rounded-lg hover:bg-amber-500/10 transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-400" />
                      <span className="text-sm text-foreground">Cancel requests</span>
                    </div>
                    <span className="text-sm font-bold text-amber-400">{pendingActions.cancelRequests}</span>
                  </Link>
                )}
                {pendingActions.cardChanges > 0 && (
                  <Link href="/admin/billing" className="flex items-center justify-between p-2.5 bg-blue-500/5 border border-blue-500/20 rounded-lg hover:bg-blue-500/10 transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-blue-400" />
                      <span className="text-sm text-foreground">Card updates</span>
                    </div>
                    <span className="text-sm font-bold text-blue-400">{pendingActions.cardChanges}</span>
                  </Link>
                )}
              </div>
            ) : (
              <div className="text-center py-3">
                <p className="text-sm text-accent-text font-medium">All clear!</p>
              </div>
            )}
          </div>

          {/* Weekly Booking Trend Mini-Chart */}
          <div className="ppl-card">
            <h3 className="font-semibold text-foreground mb-3">Bookings This Week</h3>
            <div className="flex items-end gap-1.5 h-24">
              {weeklyBookingTrend.map((d) => {
                const isToday = d.date === new Date().toISOString().slice(0, 10);
                const height = maxTrend > 0 ? (d.count / maxTrend) * 100 : 0;
                return (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] text-muted">{d.count}</span>
                    <div className="w-full relative" style={{ height: '64px' }}>
                      <div
                        className={`absolute bottom-0 w-full rounded-sm transition-all ${isToday ? 'ppl-gradient' : 'bg-surface-hover'}`}
                        style={{ height: `${Math.max(height, 4)}%` }}
                      />
                    </div>
                    <span className={`text-[10px] ${isToday ? 'text-accent-text font-bold' : 'text-muted'}`}>
                      {d.day}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom Row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* At-Risk Members */}
        <div className="ppl-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-foreground">At-Risk Members</h3>
            <span className="text-xs text-muted">No bookings in 7+ days</span>
          </div>
          {atRiskMembers.length > 0 ? (
            <div className="space-y-2">
              {atRiskMembers.slice(0, 5).map((m) => (
                <Link
                  key={m.clientId}
                  href={`/admin/members/${m.clientId}`}
                  className="flex items-center justify-between p-2.5 bg-surface rounded-lg hover:bg-surface-hover transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center">
                      <span className="text-xs font-bold text-amber-400">
                        {m.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{m.name}</p>
                      <p className="text-xs text-muted">{m.plan}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-amber-400">
                      {m.daysSinceLastBooking !== null ? `${m.daysSinceLastBooking}d` : 'Never'}
                    </p>
                    <p className="text-[10px] text-muted">ago</p>
                  </div>
                </Link>
              ))}
              {atRiskMembers.length > 5 && (
                <Link href="/admin/members" className="block text-center text-xs text-accent-text hover:underline py-1">
                  View all {atRiskMembers.length} at-risk members
                </Link>
              )}
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-accent-text font-medium">Everyone&apos;s been training!</p>
            </div>
          )}
        </div>

        {/* Recent Activity Feed */}
        <div className="ppl-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-foreground">Recent Activity</h3>
            <Link href="/admin/audit-logs" className="text-xs text-muted hover:text-foreground">
              All Logs →
            </Link>
          </div>
          {recentActivity.length > 0 ? (
            <div className="space-y-1.5">
              {recentActivity.slice(0, 8).map((a) => (
                <div key={a.id} className="flex items-start gap-2 py-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-muted mt-1.5 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-foreground">
                      <span className="font-medium">{a.userName}</span>{' '}
                      <span className="text-muted">{formatActionLabel(a.action).toLowerCase()}</span>
                      {a.resourceType && (
                        <span className="text-muted"> · {a.resourceType.toLowerCase()}</span>
                      )}
                    </p>
                  </div>
                  <span className="text-[10px] text-muted whitespace-nowrap flex-shrink-0">{timeAgo(a.createdAt)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted py-4 text-center">No recent activity</p>
          )}
        </div>
      </div>
    </div>
  );
}
