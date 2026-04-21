'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

// ── Types ──

interface KioskSession {
  id: string;
  title: string;
  sessionType: string;
  startTime: string;
  endTime: string;
  maxCapacity: number;
  isActive: boolean;
  isPast: boolean;
  room: { id: string; name: string } | null;
  coach: { id: string; fullName: string } | null;
  stats: { confirmed: number; checkedIn: number; total: number };
  roster: KioskRosterEntry[];
}

interface KioskRosterEntry {
  bookingId: string;
  clientId: string;
  clientName: string;
  status: 'CONFIRMED' | 'COMPLETED' | 'NO_SHOW';
}

interface KioskLocation {
  id: string;
  name: string;
}

const SESSION_TYPE_LABELS: Record<string, string> = {
  COLLEGE_PITCHING: 'College Pitching',
  MS_HS_PITCHING: 'MS/HS Pitching',
  YOUTH_PITCHING: 'Youth Pitching',
  PRIVATE_LESSON: 'Private Lesson',
  CAGE_RENTAL: 'Cage Rental',
};

const SESSION_TYPE_ACCENTS: Record<string, string> = {
  COLLEGE_PITCHING: '#22c55e',
  MS_HS_PITCHING: '#3b82f6',
  YOUTH_PITCHING: '#f59e0b',
  PRIVATE_LESSON: '#a855f7',
  CAGE_RENTAL: '#f43f5e',
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

// ── Main Kiosk Component ──

export default function KioskPage() {
  const [pin, setPin] = useState('');
  const [authed, setAuthed] = useState(false);
  const [location, setLocation] = useState<KioskLocation | null>(null);
  const [sessions, setSessions] = useState<KioskSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [checkinSuccess, setCheckinSuccess] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const storedPin = useRef('');

  // ── PIN Auth ──

  const handlePinSubmit = async () => {
    if (pin.length < 4) return;
    setError('');
    setIsLoading(true);
    try {
      const res = await fetch(`${API_URL}/kiosk/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.message || 'Invalid PIN');
        setPin('');
        return;
      }
      storedPin.current = pin;
      setLocation(data.data);
      setAuthed(true);
      setPin('');
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // ── Load Sessions ──

  const loadSessions = useCallback(async () => {
    if (!storedPin.current) return;
    try {
      const res = await fetch(`${API_URL}/kiosk/sessions?pin=${storedPin.current}`);
      const data = await res.json();
      if (data.success) {
        setSessions(data.data.sessions);
        // Auto-select active or next upcoming session
        if (!activeSessionId || !data.data.sessions.find((s: KioskSession) => s.id === activeSessionId)) {
          const active = data.data.sessions.find((s: KioskSession) => s.isActive);
          const next = data.data.sessions.find((s: KioskSession) => !s.isPast && !s.isActive);
          setActiveSessionId(active?.id || next?.id || data.data.sessions[0]?.id || null);
        }
      }
    } catch (err) {
      console.error('Failed to load sessions:', err);
    }
  }, [activeSessionId]);

  useEffect(() => {
    if (!authed) return;
    loadSessions();
    const interval = setInterval(loadSessions, 15000); // Refresh every 15s
    return () => clearInterval(interval);
  }, [authed, loadSessions]);

  // ── Check-In ──

  const handleCheckin = async (bookingId: string, clientName: string) => {
    try {
      const res = await fetch(`${API_URL}/kiosk/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: storedPin.current, bookingId }),
      });
      const data = await res.json();
      if (data.success) {
        setCheckinSuccess(clientName);
        setTimeout(() => setCheckinSuccess(null), 3000);
        loadSessions();
      } else {
        setError(data.message || 'Check-in failed');
        setTimeout(() => setError(''), 3000);
      }
    } catch {
      setError('Connection error');
      setTimeout(() => setError(''), 3000);
    }
  };

  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;
  const now = new Date();
  const timeString = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const dateString = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  // ── Success Overlay ──
  if (checkinSuccess) {
    return (
      <div className="fixed inset-0 bg-[#0a1a0f] flex items-center justify-center z-50">
        <div className="text-center animate-scale-in">
          <div className="w-32 h-32 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-8 animate-pulse">
            <svg className="w-20 h-20 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-5xl font-bold text-white mb-4">{checkinSuccess}</h1>
          <p className="text-2xl text-green-400">Checked In</p>
          <p className="text-lg text-white/40 mt-6">Have a great session!</p>
        </div>
      </div>
    );
  }

  // ── PIN Entry Screen ──
  if (!authed) {
    return (
      <div className="fixed inset-0 bg-[#0a1a0f] flex items-center justify-center">
        <div className="text-center w-full max-w-md px-8">
          {/* PPL Logo */}
          <div className="mb-12">
            <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-green-600 to-green-800 flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-green-900/50">
              <span className="text-4xl font-black text-white tracking-tight">PPL</span>
            </div>
            <h1 className="text-3xl font-bold text-white">Pitching Performance Lab</h1>
            <p className="text-white/40 mt-2 text-lg">Self-Service Check-In</p>
          </div>

          {/* PIN Input */}
          <div className="mb-8">
            <div className="flex justify-center gap-4 mb-6">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`w-16 h-16 rounded-xl border-2 flex items-center justify-center text-3xl font-bold transition-all ${
                    pin.length > i
                      ? 'border-green-500 bg-green-500/10 text-green-400'
                      : 'border-white/10 bg-white/5 text-white/20'
                  }`}
                >
                  {pin.length > i ? '•' : ''}
                </div>
              ))}
            </div>

            {error && (
              <p className="text-red-400 text-sm mb-4 animate-shake">{error}</p>
            )}

            {/* Number Pad */}
            <div className="grid grid-cols-3 gap-3 max-w-[280px] mx-auto">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, 'del'].map((key, i) => {
                if (key === null) return <div key={i} />;
                return (
                  <button
                    key={i}
                    onClick={() => {
                      if (key === 'del') {
                        setPin((p) => p.slice(0, -1));
                      } else if (pin.length < 6) {
                        const newPin = pin + key;
                        setPin(newPin);
                        // Auto-submit on 4 digits
                        if (newPin.length === 4) {
                          setTimeout(() => {
                            setPin(newPin);
                            // Trigger submit
                          }, 100);
                        }
                      }
                    }}
                    className={`h-16 rounded-xl text-2xl font-semibold transition-all active:scale-95 ${
                      key === 'del'
                        ? 'bg-white/5 text-white/60 hover:bg-white/10'
                        : 'bg-white/10 text-white hover:bg-white/15 active:bg-green-500/20'
                    }`}
                  >
                    {key === 'del' ? (
                      <svg className="w-6 h-6 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414-6.414A2 2 0 0110.828 5H21a1 1 0 011 1v12a1 1 0 01-1 1H10.828a2 2 0 01-1.414-.586L3 12z" />
                      </svg>
                    ) : (
                      key
                    )}
                  </button>
                );
              })}
            </div>

            <button
              onClick={handlePinSubmit}
              disabled={pin.length < 4 || isLoading}
              className={`mt-6 w-full py-4 rounded-xl text-lg font-bold transition-all ${
                pin.length >= 4
                  ? 'bg-gradient-to-r from-green-600 to-green-700 text-white hover:from-green-500 hover:to-green-600 active:scale-[0.98] shadow-lg shadow-green-900/40'
                  : 'bg-white/5 text-white/20 cursor-not-allowed'
              }`}
            >
              {isLoading ? 'Connecting...' : 'Enter'}
            </button>
          </div>

          <p className="text-white/20 text-sm">Enter the facility PIN to start</p>
        </div>
      </div>
    );
  }

  // ── Main Kiosk UI ──

  return (
    <div className="fixed inset-0 bg-[#0a1a0f] flex flex-col overflow-hidden">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-8 py-4 border-b border-white/10">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-green-600 to-green-800 flex items-center justify-center">
            <span className="text-sm font-black text-white">PPL</span>
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">{location?.name}</h1>
            <p className="text-xs text-white/40">{dateString}</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <p className="text-2xl font-mono text-white/60">{timeString}</p>
          <button
            onClick={() => { setAuthed(false); storedPin.current = ''; }}
            className="text-xs text-white/30 hover:text-white/60 px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20 transition-colors"
          >
            Exit Kiosk
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mx-8 mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm text-center">
          {error}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Session Sidebar */}
        <div className="w-80 border-r border-white/10 flex flex-col overflow-hidden">
          <div className="px-6 py-4">
            <h2 className="text-sm font-semibold text-white/40 uppercase tracking-wider">
              Today&apos;s Sessions
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
            {sessions.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-white/30 text-lg">No sessions today</p>
              </div>
            ) : (
              sessions.map((session) => {
                const isSelected = activeSessionId === session.id;
                const accent = SESSION_TYPE_ACCENTS[session.sessionType] || '#22c55e';
                const startTime = new Date(session.startTime).toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                });

                return (
                  <button
                    key={session.id}
                    onClick={() => setActiveSessionId(session.id)}
                    className={`w-full text-left p-4 rounded-xl transition-all ${
                      isSelected
                        ? 'bg-white/10 border border-white/20 shadow-lg'
                        : session.isPast
                        ? 'bg-white/[0.02] border border-white/5 opacity-50'
                        : 'bg-white/[0.04] border border-white/5 hover:bg-white/[0.07] hover:border-white/10'
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: accent }}
                      />
                      <span className="text-sm font-bold text-white">{startTime}</span>
                      {session.isActive && (
                        <span className="text-xs font-bold text-green-400 animate-pulse ml-auto">LIVE</span>
                      )}
                      {session.isPast && (
                        <span className="text-xs text-white/30 ml-auto">Done</span>
                      )}
                    </div>
                    <p className="text-sm text-white/70 mb-1">
                      {SESSION_TYPE_LABELS[session.sessionType] || session.title}
                    </p>
                    <div className="flex items-center gap-3 text-xs text-white/30">
                      {session.room && <span>{session.room.name}</span>}
                      <span>{session.stats.checkedIn}/{session.stats.total} checked in</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Main Check-In Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {activeSession ? (
            <>
              {/* Session Header */}
              <div className="px-8 py-5 border-b border-white/10">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold text-white">
                      {SESSION_TYPE_LABELS[activeSession.sessionType] || activeSession.title}
                    </h2>
                    <p className="text-sm text-white/40 mt-1">
                      {new Date(activeSession.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      {' – '}
                      {new Date(activeSession.endTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      {activeSession.room && ` · ${activeSession.room.name}`}
                      {activeSession.coach && ` · Coach ${activeSession.coach.fullName}`}
                    </p>
                  </div>
                  <div className="flex gap-4">
                    <div className="text-center px-4 py-2 bg-green-500/10 rounded-xl border border-green-500/20">
                      <p className="text-2xl font-bold text-green-400">{activeSession.stats.checkedIn}</p>
                      <p className="text-xs text-white/40">Checked In</p>
                    </div>
                    <div className="text-center px-4 py-2 bg-white/5 rounded-xl border border-white/10">
                      <p className="text-2xl font-bold text-white/70">{activeSession.stats.confirmed}</p>
                      <p className="text-xs text-white/40">Waiting</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Tap to Check In Instruction */}
              {activeSession.roster.filter((r) => r.status === 'CONFIRMED').length > 0 && (
                <div className="px-8 py-3 bg-green-500/5 border-b border-green-500/10">
                  <p className="text-sm text-green-400/70 text-center font-medium">
                    Tap your name to check in
                  </p>
                </div>
              )}

              {/* Roster */}
              <div className="flex-1 overflow-y-auto px-8 py-4">
                {activeSession.roster.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-white/20 text-xl">No one booked for this session</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {/* Show pending first, then checked in */}
                    {[...activeSession.roster]
                      .sort((a, b) => {
                        const order = { CONFIRMED: 0, COMPLETED: 1, NO_SHOW: 2 };
                        return (order[a.status] ?? 3) - (order[b.status] ?? 3);
                      })
                      .map((entry) => {
                        const isCheckedIn = entry.status === 'COMPLETED';
                        const isPending = entry.status === 'CONFIRMED';
                        const initials = entry.clientName
                          .split(' ')
                          .map((n) => n[0])
                          .join('')
                          .slice(0, 2)
                          .toUpperCase();

                        return (
                          <button
                            key={entry.bookingId}
                            onClick={() => isPending && handleCheckin(entry.bookingId, entry.clientName)}
                            disabled={!isPending}
                            className={`flex items-center gap-4 p-5 rounded-2xl transition-all ${
                              isPending
                                ? 'bg-white/[0.06] border-2 border-white/10 hover:bg-green-500/10 hover:border-green-500/30 active:scale-[0.97] active:bg-green-500/20 cursor-pointer'
                                : isCheckedIn
                                ? 'bg-green-500/[0.08] border-2 border-green-500/20'
                                : 'bg-white/[0.02] border-2 border-white/5 opacity-40'
                            }`}
                          >
                            {/* Avatar */}
                            <div
                              className={`w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0 text-lg font-bold ${
                                isCheckedIn
                                  ? 'bg-green-500/20 text-green-400'
                                  : 'bg-white/10 text-white/60'
                              }`}
                            >
                              {isCheckedIn ? (
                                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              ) : (
                                initials
                              )}
                            </div>

                            {/* Name */}
                            <div className="flex-1 text-left">
                              <p className={`text-lg font-semibold ${
                                isCheckedIn ? 'text-green-400' : 'text-white'
                              }`}>
                                {entry.clientName}
                              </p>
                              <p className={`text-xs mt-0.5 ${
                                isCheckedIn ? 'text-green-400/50' : 'text-white/30'
                              }`}>
                                {isCheckedIn ? 'Checked in' : 'Tap to check in'}
                              </p>
                            </div>

                            {/* Check-in arrow for pending */}
                            {isPending && (
                              <svg className="w-6 h-6 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                              </svg>
                            )}
                          </button>
                        );
                      })}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-10 h-10 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                  </svg>
                </div>
                <p className="text-white/30 text-lg">Select a session to begin check-in</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
