'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, CheckinSession, CheckinRosterEntry } from '@/lib/api';

const SESSION_TYPE_LABELS: Record<string, string> = {
  COLLEGE_PITCHING: 'College Pitching',
  MS_HS_PITCHING: 'MS/HS Pitching',
  YOUTH_PITCHING: 'Youth Pitching',
  PRIVATE_LESSON: 'Private Lesson',
  CAGE_RENTAL: 'Cage Rental',
};

export default function StaffCheckinPage() {
  const [sessions, setSessions] = useState<CheckinSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadSessions = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.getTodaySessions();
      if (res.data) {
        setSessions(res.data);
        // Auto-select the currently active session, or the next upcoming one
        if (!activeSessionId) {
          const active = res.data.find((s) => s.isActive);
          const nextUpcoming = res.data.find((s) => !s.isPast && !s.isActive);
          setActiveSessionId(active?.id || nextUpcoming?.id || res.data[0]?.id || null);
        }
      }
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeSessionId]);

  useEffect(() => {
    loadSessions();
    // Auto-refresh every 30 seconds for real-time check-in
    const interval = setInterval(loadSessions, 30000);
    return () => clearInterval(interval);
  }, [loadSessions]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;

  const handleCheckin = async (bookingId: string) => {
    if (!activeSession) return;
    setActionInProgress(bookingId);
    setMessage(null);
    try {
      const res = await api.bulkCheckin(activeSession.id, [bookingId], 'COMPLETED');
      setMessage({ type: 'success', text: res.message || 'Checked in!' });
      await loadSessions();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Check-in failed';
      setMessage({ type: 'error', text: msg });
    } finally {
      setActionInProgress(null);
    }
  };

  const handleNoShow = async (bookingId: string) => {
    if (!activeSession) return;
    setActionInProgress(bookingId);
    setMessage(null);
    try {
      const res = await api.bulkCheckin(activeSession.id, [bookingId], 'NO_SHOW');
      setMessage({ type: 'success', text: res.message || 'Marked as no-show' });
      await loadSessions();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to mark no-show';
      setMessage({ type: 'error', text: msg });
    } finally {
      setActionInProgress(null);
    }
  };

  const handleCheckAllIn = async () => {
    if (!activeSession) return;
    const pendingIds = activeSession.roster
      .filter((r) => r.status === 'CONFIRMED')
      .map((r) => r.bookingId);
    if (pendingIds.length === 0) return;

    setActionInProgress('all');
    setMessage(null);
    try {
      const res = await api.bulkCheckin(activeSession.id, pendingIds, 'COMPLETED');
      setMessage({ type: 'success', text: res.message || `${pendingIds.length} athletes checked in!` });
      await loadSessions();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Bulk check-in failed';
      setMessage({ type: 'error', text: msg });
    } finally {
      setActionInProgress(null);
    }
  };

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const now = new Date();
  const todayLabel = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Session Check-In</h1>
          <p className="text-muted text-sm mt-1">{todayLabel}</p>
        </div>
        <button
          onClick={() => loadSessions()}
          className="ppl-btn ppl-btn-secondary text-sm"
          disabled={isLoading}
        >
          {isLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Status message */}
      {message && (
        <div
          className={`mb-4 p-3 rounded-lg text-sm transition-all ${
            message.type === 'success'
              ? 'bg-ppl-dark-green/10 border border-ppl-dark-green/20 text-ppl-light-green'
              : 'bg-danger/10 border border-danger/20 text-danger'
          }`}
        >
          {message.text}
        </div>
      )}

      {isLoading && sessions.length === 0 ? (
        <div className="space-y-4">
          {[1, 2, 3].map((n) => (
            <div key={n} className="ppl-card animate-pulse h-20" />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <div className="ppl-card text-center py-16">
          <div className="w-16 h-16 rounded-full bg-surface-hover flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
            </svg>
          </div>
          <p className="text-lg font-medium text-foreground">No sessions today</p>
          <p className="text-sm text-muted mt-1">Check back when sessions are scheduled.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Session Tabs (left sidebar on desktop, horizontal scroll on mobile) */}
          <div className="lg:col-span-1">
            <h2 className="text-sm font-semibold text-muted uppercase tracking-wide mb-3">
              Today&apos;s Sessions ({sessions.length})
            </h2>
            <div className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0">
              {sessions.map((session) => {
                const isSelected = activeSessionId === session.id;
                return (
                  <button
                    key={session.id}
                    onClick={() => {
                      setActiveSessionId(session.id);
                      setMessage(null);
                    }}
                    className={`flex-shrink-0 lg:flex-shrink text-left p-3 rounded-xl transition-all w-56 lg:w-full ${
                      isSelected
                        ? 'ppl-gradient text-white shadow-lg'
                        : session.isActive
                        ? 'bg-ppl-dark-green/10 border border-ppl-dark-green/30 text-foreground hover:bg-ppl-dark-green/20'
                        : session.isPast
                        ? 'bg-surface/50 border border-border/50 text-muted'
                        : 'bg-surface border border-border text-foreground hover:border-border-light'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-sm">
                        {formatTime(session.startTime)}
                      </span>
                      {session.isActive && !isSelected && (
                        <span className="text-xs font-bold text-ppl-light-green animate-pulse">LIVE</span>
                      )}
                      {session.isActive && isSelected && (
                        <span className="text-xs font-bold text-white/80 animate-pulse">LIVE</span>
                      )}
                      {session.isPast && (
                        <span className={`text-xs ${isSelected ? 'text-white/60' : 'text-muted/60'}`}>Done</span>
                      )}
                    </div>
                    <p className={`text-xs ${isSelected ? 'text-white/80' : 'text-muted'}`}>
                      {SESSION_TYPE_LABELS[session.sessionType] || session.title}
                      {session.room && ` · ${session.room.name}`}
                    </p>
                    {/* Mini stats */}
                    <div className={`flex items-center gap-3 mt-2 text-xs ${isSelected ? 'text-white/70' : 'text-muted'}`}>
                      <span>{session.stats.checkedIn} in</span>
                      <span>{session.stats.pending} waiting</span>
                      {session.stats.noShows > 0 && (
                        <span className={isSelected ? 'text-red-200' : 'text-red-400'}>{session.stats.noShows} no-show</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Session Roster */}
          <div className="lg:col-span-2">
            {activeSession ? (
              <>
                {/* Session header */}
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-bold text-foreground">
                      {SESSION_TYPE_LABELS[activeSession.sessionType] || activeSession.title}
                    </h2>
                    <p className="text-sm text-muted">
                      {formatTime(activeSession.startTime)} – {formatTime(activeSession.endTime)}
                      {activeSession.room && ` · ${activeSession.room.name}`}
                      {activeSession.coach && ` · Coach ${activeSession.coach.fullName}`}
                    </p>
                  </div>
                  {activeSession.roster.some((r) => r.status === 'CONFIRMED') && (
                    <button
                      onClick={handleCheckAllIn}
                      disabled={actionInProgress === 'all'}
                      className="ppl-btn ppl-btn-primary text-sm"
                    >
                      {actionInProgress === 'all' ? 'Checking in...' : 'Check All In'}
                    </button>
                  )}
                </div>

                {/* Stats bar */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="bg-ppl-dark-green/10 border border-ppl-dark-green/20 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-ppl-light-green">{activeSession.stats.checkedIn}</p>
                    <p className="text-xs text-muted">Checked In</p>
                  </div>
                  <div className="bg-surface border border-border rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-foreground">{activeSession.stats.pending}</p>
                    <p className="text-xs text-muted">Waiting</p>
                  </div>
                  <div className={`border rounded-xl p-3 text-center ${
                    activeSession.stats.noShows > 0
                      ? 'bg-danger/10 border-danger/20'
                      : 'bg-surface border-border'
                  }`}>
                    <p className={`text-2xl font-bold ${activeSession.stats.noShows > 0 ? 'text-danger' : 'text-muted'}`}>
                      {activeSession.stats.noShows}
                    </p>
                    <p className="text-xs text-muted">No-Show</p>
                  </div>
                </div>

                {/* Roster list */}
                {activeSession.roster.length === 0 ? (
                  <div className="ppl-card text-center py-10">
                    <p className="text-muted">No one booked for this session yet.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {/* Pending athletes first, then checked in, then no-shows */}
                    {[...activeSession.roster]
                      .sort((a, b) => {
                        const order = { CONFIRMED: 0, COMPLETED: 1, NO_SHOW: 2 };
                        return (order[a.status] ?? 3) - (order[b.status] ?? 3);
                      })
                      .map((entry) => (
                        <RosterRow
                          key={entry.bookingId}
                          entry={entry}
                          onCheckin={() => handleCheckin(entry.bookingId)}
                          onNoShow={() => handleNoShow(entry.bookingId)}
                          isLoading={actionInProgress === entry.bookingId}
                        />
                      ))}
                  </div>
                )}

                {/* Capacity indicator */}
                <div className="mt-4 flex items-center justify-between text-xs text-muted">
                  <span>{activeSession.stats.total} / {activeSession.maxCapacity} spots filled</span>
                  <span>
                    {activeSession.maxCapacity - activeSession.stats.total > 0
                      ? `${activeSession.maxCapacity - activeSession.stats.total} spots open`
                      : 'Session is full'}
                  </span>
                </div>
              </>
            ) : (
              <div className="ppl-card text-center py-16">
                <p className="text-muted">Select a session to view its roster</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Individual Roster Row Component ──

function RosterRow({
  entry,
  onCheckin,
  onNoShow,
  isLoading,
}: {
  entry: CheckinRosterEntry;
  onCheckin: () => void;
  onNoShow: () => void;
  isLoading: boolean;
}) {
  const isCheckedIn = entry.status === 'COMPLETED';
  const isNoShow = entry.status === 'NO_SHOW';
  const isPending = entry.status === 'CONFIRMED';

  return (
    <div
      className={`flex items-center justify-between p-3 rounded-xl transition-all ${
        isCheckedIn
          ? 'bg-ppl-dark-green/10 border border-ppl-dark-green/20'
          : isNoShow
          ? 'bg-danger/5 border border-danger/15'
          : 'bg-surface border border-border'
      }`}
    >
      <div className="flex items-center gap-3">
        {/* Status indicator */}
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
            isCheckedIn
              ? 'bg-ppl-light-green/20'
              : isNoShow
              ? 'bg-danger/20'
              : 'bg-surface-hover'
          }`}
        >
          {isCheckedIn ? (
            <svg className="w-5 h-5 text-ppl-light-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : isNoShow ? (
            <svg className="w-5 h-5 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <span className="text-sm font-bold text-muted">
              {entry.clientName.charAt(0).toUpperCase()}
            </span>
          )}
        </div>

        <div>
          <p className={`font-medium text-sm ${isNoShow ? 'text-muted line-through' : 'text-foreground'}`}>
            {entry.clientName}
          </p>
          {entry.phone && (
            <p className="text-xs text-muted">{entry.phone}</p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {isPending && (
          <>
            <button
              onClick={onCheckin}
              disabled={isLoading}
              className="ppl-btn ppl-btn-primary text-xs py-1.5 px-4"
            >
              {isLoading ? '...' : 'Check In'}
            </button>
            <button
              onClick={onNoShow}
              disabled={isLoading}
              className="text-xs text-danger/70 hover:text-danger font-medium px-2 py-1.5 rounded-lg hover:bg-danger/10 transition-colors"
            >
              No-Show
            </button>
          </>
        )}
        {isCheckedIn && (
          <span className="text-xs font-medium text-ppl-light-green px-2 py-1 rounded-full bg-ppl-light-green/10">
            Checked In
          </span>
        )}
        {isNoShow && (
          <span className="text-xs font-medium text-danger/70 px-2 py-1 rounded-full bg-danger/10">
            No-Show
          </span>
        )}
      </div>
    </div>
  );
}
