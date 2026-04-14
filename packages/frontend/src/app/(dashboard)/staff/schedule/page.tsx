'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, SessionWithAvailability, SessionDetail } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

const SESSION_TYPE_LABELS: Record<string, string> = {
  COLLEGE_PITCHING: 'College Pitching',
  MS_HS_PITCHING: 'MS/HS Pitching',
  YOUTH_PITCHING: 'Youth Pitching',
  PRIVATE_LESSON: 'Private Lesson',
  CAGE_RENTAL: 'Cage Rental',
};

const SESSION_TYPE_COLORS: Record<string, string> = {
  COLLEGE_PITCHING: 'bg-ppl-dark-green/20 border-ppl-dark-green text-ppl-light-green',
  MS_HS_PITCHING: 'bg-blue-500/20 border-blue-500 text-blue-400',
  YOUTH_PITCHING: 'bg-amber-500/20 border-amber-500 text-amber-400',
  PRIVATE_LESSON: 'bg-purple-500/20 border-purple-500 text-purple-400',
  CAGE_RENTAL: 'bg-rose-500/20 border-rose-500 text-rose-400',
};

export default function StaffSchedulePage() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<SessionWithAvailability[]>([]);
  const [selectedWeek, setSelectedWeek] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay() + 1);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [attendanceSessionId, setAttendanceSessionId] = useState<string | null>(null);

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(selectedWeek);
    d.setDate(d.getDate() + i);
    return d;
  });

  const loadSessions = useCallback(async () => {
    setIsLoading(true);
    try {
      const start = selectedWeek.toISOString().split('T')[0];
      const endD = new Date(selectedWeek);
      endD.setDate(endD.getDate() + 7);

      const res = await api.getSessions({
        start,
        end: endD.toISOString().split('T')[0],
      });
      if (res.data) setSessions(res.data);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedWeek]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const navigateWeek = (direction: number) => {
    setSelectedWeek((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + direction * 7);
      return d;
    });
  };

  const goToToday = () => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay() + 1);
    d.setHours(0, 0, 0, 0);
    setSelectedWeek(d);
  };

  const getSessionsForDay = (date: Date) => {
    return sessions.filter((s) => {
      const sd = new Date(s.startTime);
      return (
        sd.getFullYear() === date.getFullYear() &&
        sd.getMonth() === date.getMonth() &&
        sd.getDate() === date.getDate()
      );
    });
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return (
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate()
    );
  };

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const weekLabel = `${selectedWeek.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} — ${weekDays[6].toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-foreground">My Schedule</h1>
          <p className="text-sm text-muted mt-0.5">View and manage your sessions</p>
        </div>
        <button onClick={() => setShowCreateModal(true)} className="ppl-btn ppl-btn-primary text-sm">
          + Add Session
        </button>
      </div>

      {/* Week Navigation */}
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={() => navigateWeek(-1)}
          className="w-8 h-8 rounded-lg border border-border bg-surface flex items-center justify-center text-foreground hover:bg-surface-hover"
        >
          &#8249;
        </button>
        <span className="text-sm font-semibold min-w-[220px] text-center">{weekLabel}</span>
        <button
          onClick={() => navigateWeek(1)}
          className="w-8 h-8 rounded-lg border border-border bg-surface flex items-center justify-center text-foreground hover:bg-surface-hover"
        >
          &#8250;
        </button>
        <button onClick={goToToday} className="ppl-btn ppl-btn-secondary text-xs ml-2">
          Today
        </button>
      </div>

      {/* Calendar Grid */}
      {isLoading ? (
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-96 bg-surface rounded-lg animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-2">
          {weekDays.map((day) => {
            const daySessions = getSessionsForDay(day);
            const today = isToday(day);
            return (
              <div key={day.toISOString()} className="min-h-[400px]">
                <div className={`text-center mb-2 ${today ? 'text-ppl-light-green' : 'text-muted'}`}>
                  <div className="text-xs font-semibold uppercase">
                    {day.toLocaleDateString('en-US', { weekday: 'short' })}
                  </div>
                  <div className={`text-lg font-bold ${today ? 'ppl-gradient-text' : ''}`}>
                    {day.getDate()}
                  </div>
                </div>
                {daySessions.length === 0 ? (
                  <div className="text-center text-muted text-xs mt-10">No sessions</div>
                ) : (
                  daySessions.map((session) => (
                    <div
                      key={session.id}
                      onClick={() => setAttendanceSessionId(session.id)}
                      className={`p-2 rounded-lg mb-1.5 border-l-3 text-xs cursor-pointer hover:scale-[1.02] transition-transform ${
                        SESSION_TYPE_COLORS[session.sessionType] || 'bg-surface border-border'
                      }`}
                    >
                      <div className="font-semibold text-foreground">{formatTime(session.startTime)}</div>
                      <div className="font-medium mt-0.5">
                        {SESSION_TYPE_LABELS[session.sessionType] || session.title}
                      </div>
                      <div className="text-muted mt-0.5">
                        {session.room?.name} &middot; {session.currentEnrolled}/{session.maxCapacity}
                      </div>
                    </div>
                  ))
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Attendance Modal */}
      {attendanceSessionId && (
        <AttendanceModal
          sessionId={attendanceSessionId}
          onClose={() => setAttendanceSessionId(null)}
          onUpdated={() => {
            setAttendanceSessionId(null);
            loadSessions();
          }}
        />
      )}

      {/* Create Session Modal */}
      {showCreateModal && (
        <CreateSessionModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            loadSessions();
          }}
        />
      )}
    </div>
  );
}

function AttendanceModal({
  sessionId,
  onClose,
  onUpdated,
}: {
  sessionId: string;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [marking, setMarking] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadSession();
  }, [sessionId]);

  async function loadSession() {
    setIsLoading(true);
    try {
      const res = await api.getSessionDetail(sessionId);
      if (res.data) setSession(res.data);
    } catch {
      setMessage('Failed to load session');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleMark(bookingId: string, status: 'COMPLETED' | 'NO_SHOW') {
    setMarking(bookingId);
    try {
      await api.markAttendance(bookingId, status);
      await loadSession();
      setMessage(`Marked as ${status === 'COMPLETED' ? 'attended' : 'no-show'}`);
      setTimeout(() => setMessage(''), 2000);
    } catch {
      setMessage('Failed to update');
    } finally {
      setMarking(null);
    }
  }

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  const isPast = session ? new Date(session.endTime) <= new Date() : false;
  const confirmed = session?.bookings.filter((b) => b.status === 'CONFIRMED') || [];
  const completed = session?.bookings.filter((b) => b.status === 'COMPLETED') || [];
  const noShows = session?.bookings.filter((b) => b.status === 'NO_SHOW') || [];

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="ppl-card w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {isLoading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-6 bg-surface w-48 rounded" />
            <div className="h-4 bg-surface w-32 rounded" />
            <div className="h-16 bg-surface rounded" />
          </div>
        ) : session ? (
          <>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-foreground">{session.title}</h2>
                <p className="text-sm text-muted">
                  {formatDate(session.startTime)} &middot; {formatTime(session.startTime)} – {formatTime(session.endTime)}
                </p>
                {session.room && <p className="text-xs text-muted">{session.room.name}</p>}
              </div>
              <button onClick={onClose} className="text-muted hover:text-foreground text-xl">&times;</button>
            </div>

            {/* Stats bar */}
            <div className="flex gap-3 mb-4">
              <div className="flex-1 bg-surface rounded-lg p-2 text-center">
                <p className="text-lg font-bold text-foreground">{session.currentEnrolled}</p>
                <p className="text-xs text-muted">Booked</p>
              </div>
              {isPast && (
                <>
                  <div className="flex-1 bg-green-500/10 rounded-lg p-2 text-center">
                    <p className="text-lg font-bold text-green-400">{completed.length}</p>
                    <p className="text-xs text-muted">Attended</p>
                  </div>
                  <div className="flex-1 bg-red-500/10 rounded-lg p-2 text-center">
                    <p className="text-lg font-bold text-red-400">{noShows.length}</p>
                    <p className="text-xs text-muted">No-Show</p>
                  </div>
                </>
              )}
            </div>

            {message && (
              <div className="mb-3 p-2 bg-ppl-dark-green/10 border border-ppl-dark-green/20 rounded-lg text-sm text-ppl-light-green text-center">
                {message}
              </div>
            )}

            {/* Athlete List */}
            <h3 className="text-sm font-semibold text-foreground mb-2">
              {isPast ? 'Attendance' : 'Booked Athletes'}
            </h3>

            {session.bookings.length === 0 ? (
              <p className="text-sm text-muted text-center py-4">No bookings for this session.</p>
            ) : (
              <div className="space-y-2">
                {/* Show confirmed first (need marking), then completed, then no-shows */}
                {[...confirmed, ...completed, ...noShows].map((booking) => (
                  <div
                    key={booking.id}
                    className="flex items-center justify-between p-3 bg-surface rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-surface-hover flex items-center justify-center text-xs font-bold text-muted">
                        {booking.client.fullName.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{booking.client.fullName}</p>
                        {booking.client.phone && (
                          <p className="text-xs text-muted">{booking.client.phone}</p>
                        )}
                      </div>
                    </div>

                    {booking.status === 'CONFIRMED' && isPast ? (
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleMark(booking.id, 'COMPLETED')}
                          disabled={marking === booking.id}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20 transition-colors"
                        >
                          Present
                        </button>
                        <button
                          onClick={() => handleMark(booking.id, 'NO_SHOW')}
                          disabled={marking === booking.id}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                        >
                          No-Show
                        </button>
                      </div>
                    ) : (
                      <span
                        className={`ppl-badge text-xs ${
                          booking.status === 'COMPLETED'
                            ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                            : booking.status === 'NO_SHOW'
                            ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                            : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                        }`}
                      >
                        {booking.status === 'NO_SHOW' ? 'No-Show' : booking.status === 'COMPLETED' ? 'Present' : 'Booked'}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Mark all button for past sessions */}
            {isPast && confirmed.length > 0 && (
              <div className="mt-4 flex gap-2">
                <button
                  onClick={async () => {
                    for (const b of confirmed) {
                      await handleMark(b.id, 'COMPLETED');
                    }
                    onUpdated();
                  }}
                  className="ppl-btn ppl-btn-primary text-sm flex-1 justify-center"
                >
                  Mark All Present
                </button>
                <button onClick={onUpdated} className="ppl-btn ppl-btn-secondary text-sm">
                  Done
                </button>
              </div>
            )}

            {!isPast && (
              <div className="mt-4">
                <button onClick={onClose} className="ppl-btn ppl-btn-secondary text-sm w-full justify-center">
                  Close
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="text-muted text-center py-4">Session not found</p>
        )}
      </div>
    </div>
  );
}

function CreateSessionModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [formData, setFormData] = useState({
    title: '',
    sessionType: 'MS_HS_PITCHING',
    startTime: '',
    durationMinutes: 60,
    maxCapacity: 8,
    roomId: '',
    recurringCount: 1,
  });
  const [rooms, setRooms] = useState<{ id: string; name: string }[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Load rooms for the staff member's location
    api.getLocations().then((res) => {
      if (res.data && res.data.length > 0) {
        const loc = res.data[0];
        if (loc.rooms) setRooms(loc.rooms);
      }
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    try {
      const startTime = new Date(formData.startTime);
      const endTime = new Date(startTime);
      endTime.setMinutes(endTime.getMinutes() + formData.durationMinutes);

      await api.createSession({
        title: formData.title || SESSION_TYPE_LABELS[formData.sessionType],
        sessionType: formData.sessionType,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        maxCapacity: formData.maxCapacity,
        roomId: formData.roomId || undefined,
        recurringCount: formData.recurringCount,
      } as any);
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setIsSubmitting(false);
    }
  };

  const SESSION_TYPE_LABELS: Record<string, string> = {
    COLLEGE_PITCHING: 'College Pitching',
    MS_HS_PITCHING: 'MS/HS Pitching',
    YOUTH_PITCHING: 'Youth Pitching',
    PRIVATE_LESSON: 'Private Lesson',
    CAGE_RENTAL: 'Cage Rental',
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="ppl-card w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-foreground">Add Session</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground text-xl">
            &times;
          </button>
        </div>
        {error && (
          <div className="mb-3 p-2 bg-danger/10 border border-danger/20 rounded-lg text-sm text-danger">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted block mb-1">Session Type</label>
            <select
              value={formData.sessionType}
              onChange={(e) => setFormData({ ...formData, sessionType: e.target.value })}
              className="ppl-input"
            >
              {Object.entries(SESSION_TYPE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted block mb-1">Title (optional)</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="ppl-input"
              placeholder="Auto-generated from type"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted block mb-1">Date & Time</label>
              <input
                type="datetime-local"
                value={formData.startTime}
                onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                className="ppl-input"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted block mb-1">Room</label>
              <select
                value={formData.roomId}
                onChange={(e) => setFormData({ ...formData, roomId: e.target.value })}
                className="ppl-input"
              >
                <option value="">No room</option>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>{room.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-muted block mb-1">Duration</label>
              <select
                value={formData.durationMinutes}
                onChange={(e) => setFormData({ ...formData, durationMinutes: parseInt(e.target.value) })}
                className="ppl-input"
              >
                <option value={30}>30 min</option>
                <option value={60}>1 hour</option>
                <option value={90}>1.5 hours</option>
                <option value={120}>2 hours</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted block mb-1">Capacity</label>
              <input
                type="number"
                value={formData.maxCapacity}
                onChange={(e) => setFormData({ ...formData, maxCapacity: parseInt(e.target.value) || 1 })}
                className="ppl-input"
                min={1}
                max={50}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted block mb-1">Repeat Weeks</label>
              <input
                type="number"
                value={formData.recurringCount}
                onChange={(e) => setFormData({ ...formData, recurringCount: parseInt(e.target.value) || 1 })}
                className="ppl-input"
                min={1}
                max={52}
              />
            </div>
          </div>
          <button type="submit" disabled={isSubmitting} className="ppl-btn ppl-btn-primary w-full justify-center mt-2">
            {isSubmitting ? 'Creating...' : formData.recurringCount > 1 ? `Create ${formData.recurringCount} Sessions` : 'Create Session'}
          </button>
        </form>
      </div>
    </div>
  );
}
