'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { api, SessionWithAvailability } from '@/lib/api';

export default function StaffDashboard() {
  const { user } = useAuth();
  const [todaySessions, setTodaySessions] = useState<SessionWithAvailability[]>([]);
  const [tomorrowSessions, setTomorrowSessions] = useState<SessionWithAvailability[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    setIsLoading(true);
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayEnd = new Date(todayStart);
      todayEnd.setDate(todayEnd.getDate() + 1);
      const tomorrowEnd = new Date(todayStart);
      tomorrowEnd.setDate(tomorrowEnd.getDate() + 2);

      const [todayRes, tomorrowRes, notifRes] = await Promise.all([
        api.getSessions({ start: todayStart.toISOString(), end: todayEnd.toISOString() }),
        api.getSessions({ start: todayEnd.toISOString(), end: tomorrowEnd.toISOString() }),
        api.getNotifications({ unread: true }),
      ]);

      if (todayRes.data) {
        setTodaySessions(
          todayRes.data.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
        );
      }
      if (tomorrowRes.data) {
        setTomorrowSessions(
          tomorrowRes.data.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
        );
      }
      if (notifRes.data) setUnreadCount(notifRes.data.length);
    } catch (err) {
      console.error('Staff dashboard error:', err);
    } finally {
      setIsLoading(false);
    }
  }

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const now = new Date();
  const totalAthletesToday = todaySessions.reduce((sum, s) => sum + s.currentEnrolled, 0);
  const upcomingToday = todaySessions.filter((s) => new Date(s.startTime) > now);
  const completedToday = todaySessions.filter((s) => new Date(s.endTime) <= now);

  const greeting = () => {
    const hour = now.getHours();
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
        <p className="text-muted mt-1">
          {todaySessions.length > 0
            ? `You have ${upcomingToday.length} session${upcomingToday.length !== 1 ? 's' : ''} remaining today.`
            : 'No sessions scheduled for today.'}
        </p>
      </div>

      {/* Stats */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {[1, 2, 3].map((n) => <div key={n} className="ppl-card animate-pulse h-24" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="ppl-card">
            <p className="text-sm text-muted">Sessions Today</p>
            <p className="text-3xl font-bold text-accent mt-1">{todaySessions.length}</p>
            {completedToday.length > 0 && (
              <p className="text-xs text-muted mt-0.5">{completedToday.length} completed</p>
            )}
          </div>
          <div className="ppl-card">
            <p className="text-sm text-muted">Athletes Booked</p>
            <p className="text-3xl font-bold text-foreground mt-1">{totalAthletesToday}</p>
            <p className="text-xs text-muted mt-0.5">across all sessions</p>
          </div>
          <Link href="/staff/messages" className="ppl-card hover:border-primary/50 transition-colors">
            <p className="text-sm text-muted">Unread Messages</p>
            <p className={`text-3xl font-bold mt-1 ${unreadCount > 0 ? 'text-accent' : 'text-foreground'}`}>
              {unreadCount}
            </p>
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Today's Sessions */}
        <div className="ppl-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground">Today&apos;s Sessions</h3>
            <Link href="/staff/schedule" className="text-xs text-accent hover:underline">
              Full Schedule →
            </Link>
          </div>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((n) => <div key={n} className="h-16 bg-surface animate-pulse rounded-lg" />)}
            </div>
          ) : todaySessions.length > 0 ? (
            <div className="space-y-2">
              {todaySessions.map((s) => {
                const isPast = new Date(s.endTime) <= now;
                const isNow = new Date(s.startTime) <= now && new Date(s.endTime) > now;
                return (
                  <div
                    key={s.id}
                    className={`flex items-center justify-between p-3 rounded-lg ${
                      isNow
                        ? 'bg-primary/10 border border-primary/30'
                        : isPast
                        ? 'bg-surface opacity-60'
                        : 'bg-surface'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground">{s.title}</p>
                        {isNow && (
                          <span className="text-xs ppl-badge bg-primary/20 text-accent border border-primary/30">
                            NOW
                          </span>
                        )}
                        {isPast && (
                          <span className="text-xs text-muted">Done</span>
                        )}
                      </div>
                      <p className="text-xs text-muted">
                        {formatTime(s.startTime)} – {formatTime(s.endTime)}
                        {s.room && ` · ${s.room.name}`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-bold ${
                        s.currentEnrolled >= s.maxCapacity ? 'text-red-400' : 'text-accent'
                      }`}>
                        {s.currentEnrolled}/{s.maxCapacity}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted text-center py-6">No sessions today. Enjoy the day off!</p>
          )}
        </div>

        {/* Tomorrow Preview */}
        <div className="ppl-card">
          <h3 className="font-semibold text-foreground mb-4">Tomorrow&apos;s Preview</h3>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2].map((n) => <div key={n} className="h-14 bg-surface animate-pulse rounded-lg" />)}
            </div>
          ) : tomorrowSessions.length > 0 ? (
            <div className="space-y-2">
              {tomorrowSessions.map((s) => (
                <div key={s.id} className="flex items-center justify-between p-3 bg-surface rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-foreground">{s.title}</p>
                    <p className="text-xs text-muted">
                      {formatTime(s.startTime)} – {formatTime(s.endTime)}
                      {s.room && ` · ${s.room.name}`}
                    </p>
                  </div>
                  <p className="text-sm text-muted">{s.currentEnrolled}/{s.maxCapacity}</p>
                </div>
              ))}
              <p className="text-xs text-muted text-center pt-1">
                {tomorrowSessions.reduce((sum, s) => sum + s.currentEnrolled, 0)} athletes booked
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted text-center py-6">No sessions scheduled tomorrow.</p>
          )}
        </div>
      </div>
    </div>
  );
}
