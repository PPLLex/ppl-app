'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, SessionWithAvailability, Location, Room, CreateSessionData } from '@/lib/api';
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

export default function AdminSchedulePage() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<SessionWithAvailability[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [selectedWeek, setSelectedWeek] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay() + 1); // Monday
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Load locations
  useEffect(() => {
    api.getLocations().then((res) => {
      if (res.data) {
        setLocations(res.data);
        if (res.data.length > 0) {
          setSelectedLocationId(res.data[0].id);
        }
      }
    });
  }, []);

  // Load sessions for selected week and location
  const loadSessions = useCallback(async () => {
    if (!selectedLocationId) return;
    setIsLoading(true);

    const weekEnd = new Date(selectedWeek);
    weekEnd.setDate(weekEnd.getDate() + 7);

    try {
      const res = await api.getSessions({
        locationId: selectedLocationId,
        start: selectedWeek.toISOString(),
        end: weekEnd.toISOString(),
      });
      if (res.data) setSessions(res.data);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedLocationId, selectedWeek]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Get days of the week
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(selectedWeek);
    d.setDate(d.getDate() + i);
    return d;
  });

  // Group sessions by day
  const sessionsByDay = weekDays.map((day) => {
    const dayStart = new Date(day);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);

    return sessions.filter((s) => {
      const start = new Date(s.startTime);
      return start >= dayStart && start <= dayEnd;
    });
  });

  const navigateWeek = (direction: number) => {
    setSelectedWeek((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + direction * 7);
      return d;
    });
  };

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const formatDayHeader = (d: Date) => ({
    dayName: d.toLocaleDateString('en-US', { weekday: 'short' }),
    dayNum: d.getDate(),
    isToday: d.toDateString() === new Date().toDateString(),
  });

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Schedule</h1>
          <p className="text-muted text-sm mt-1">Manage sessions across all locations</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="ppl-btn ppl-btn-primary"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Session
        </button>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4 mb-6">
        {/* Location selector */}
        <select
          value={selectedLocationId}
          onChange={(e) => setSelectedLocationId(e.target.value)}
          className="ppl-input w-auto"
        >
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.name}
            </option>
          ))}
        </select>

        {/* Week navigation */}
        <div className="flex items-center gap-2">
          <button onClick={() => navigateWeek(-1)} className="ppl-btn ppl-btn-secondary px-3">
            &larr;
          </button>
          <span className="text-sm text-foreground font-medium min-w-[180px] text-center">
            {selectedWeek.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} &ndash;{' '}
            {weekDays[6].toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </span>
          <button onClick={() => navigateWeek(1)} className="ppl-btn ppl-btn-secondary px-3">
            &rarr;
          </button>
          <button
            onClick={() => {
              const d = new Date();
              d.setDate(d.getDate() - d.getDay() + 1);
              d.setHours(0, 0, 0, 0);
              setSelectedWeek(d);
            }}
            className="ppl-btn ppl-btn-secondary text-xs"
          >
            Today
          </button>
        </div>
      </div>

      {/* Weekly Calendar Grid */}
      <div className="ppl-card p-0 overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border">
          {weekDays.map((day, i) => {
            const { dayName, dayNum, isToday } = formatDayHeader(day);
            return (
              <div
                key={i}
                className={`p-3 text-center border-r border-border last:border-r-0 ${
                  isToday ? 'bg-ppl-dark-green/10' : ''
                }`}
              >
                <p className="text-xs text-muted uppercase">{dayName}</p>
                <p
                  className={`text-lg font-bold mt-0.5 ${
                    isToday ? 'text-ppl-light-green' : 'text-foreground'
                  }`}
                >
                  {dayNum}
                </p>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-7 min-h-[400px]">
          {sessionsByDay.map((daySessions, i) => (
            <div
              key={i}
              className="border-r border-border last:border-r-0 p-2 space-y-2"
            >
              {isLoading ? (
                <div className="h-16 bg-surface-hover rounded animate-pulse" />
              ) : daySessions.length === 0 ? (
                <p className="text-xs text-muted text-center pt-4">No sessions</p>
              ) : (
                daySessions
                  .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
                  .map((session) => (
                    <div
                      key={session.id}
                      className={`p-2 rounded-lg border text-xs cursor-pointer transition-all hover:scale-[1.02] ${
                        SESSION_TYPE_COLORS[session.sessionType] || 'bg-surface border-border'
                      }`}
                    >
                      <p className="font-semibold truncate">{session.title}</p>
                      <p className="opacity-80">
                        {formatTime(session.startTime)} - {formatTime(session.endTime)}
                      </p>
                      {session.room && <p className="opacity-70">{session.room.name}</p>}
                      <p className="opacity-70 mt-1">
                        {session.currentEnrolled}/{session.maxCapacity} booked
                      </p>
                    </div>
                  ))
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mt-4">
        {Object.entries(SESSION_TYPE_LABELS).map(([key, label]) => (
          <div key={key} className="flex items-center gap-2 text-xs">
            <div className={`w-3 h-3 rounded ${SESSION_TYPE_COLORS[key]?.split(' ')[0] || 'bg-surface'}`} />
            <span className="text-muted">{label}</span>
          </div>
        ))}
      </div>

      {/* Create Session Modal */}
      {showCreateModal && (
        <CreateSessionModal
          locationId={selectedLocationId}
          locations={locations}
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

// ============================================================
// CREATE SESSION MODAL
// ============================================================

function CreateSessionModal({
  locationId,
  locations,
  onClose,
  onCreated,
}: {
  locationId: string;
  locations: Location[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<CreateSessionData>({
    locationId,
    title: '',
    sessionType: 'MS_HS_PITCHING',
    startTime: '',
    endTime: '',
    maxCapacity: 8,
    recurringCount: 1,
  });
  const [rooms, setRooms] = useState<Room[]>([]);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load rooms when location changes
  useEffect(() => {
    api.getLocation(form.locationId).then((res) => {
      if (res.data?.rooms) setRooms(res.data.rooms);
    });
  }, [form.locationId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      // Auto-set title based on session type if not provided
      const title = form.title || SESSION_TYPE_LABELS[form.sessionType] || form.sessionType;
      await api.createSession({ ...form, title });
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateForm = (updates: Partial<CreateSessionData>) => {
    setForm((prev) => ({ ...prev, ...updates }));
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="ppl-card w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-foreground">Create Session</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Location */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Location</label>
            <select
              value={form.locationId}
              onChange={(e) => updateForm({ locationId: e.target.value })}
              className="ppl-input"
            >
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>{loc.name}</option>
              ))}
            </select>
          </div>

          {/* Session Type */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Session Type</label>
            <select
              value={form.sessionType}
              onChange={(e) => updateForm({ sessionType: e.target.value })}
              className="ppl-input"
            >
              {Object.entries(SESSION_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Title <span className="text-muted">(optional — defaults to session type)</span>
            </label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => updateForm({ title: e.target.value })}
              placeholder={SESSION_TYPE_LABELS[form.sessionType]}
              className="ppl-input"
            />
          </div>

          {/* Room */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Room</label>
            <select
              value={form.roomId || ''}
              onChange={(e) => updateForm({ roomId: e.target.value || undefined })}
              className="ppl-input"
            >
              <option value="">No specific room</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>{room.name}</option>
              ))}
            </select>
          </div>

          {/* Date/Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Start</label>
              <input
                type="datetime-local"
                value={form.startTime}
                onChange={(e) => {
                  const start = e.target.value;
                  updateForm({ startTime: start });
                  // Auto-set end time to 1 hour later
                  if (start) {
                    const endDate = new Date(start);
                    endDate.setHours(endDate.getHours() + 1);
                    const endStr = endDate.toISOString().slice(0, 16);
                    updateForm({ startTime: start, endTime: endStr });
                  }
                }}
                className="ppl-input"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">End</label>
              <input
                type="datetime-local"
                value={form.endTime}
                onChange={(e) => updateForm({ endTime: e.target.value })}
                className="ppl-input"
                required
              />
            </div>
          </div>

          {/* Capacity */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Max Athletes</label>
            <input
              type="number"
              min={1}
              max={50}
              value={form.maxCapacity}
              onChange={(e) => updateForm({ maxCapacity: parseInt(e.target.value) })}
              className="ppl-input"
            />
          </div>

          {/* Recurring */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Repeat Weekly For
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={52}
                value={form.recurringCount}
                onChange={(e) => updateForm({ recurringCount: parseInt(e.target.value) })}
                className="ppl-input w-20"
              />
              <span className="text-sm text-muted">week(s)</span>
            </div>
            <p className="text-xs text-muted mt-1">
              Set to 1 for a single session, or higher to auto-create weekly recurring sessions.
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="ppl-btn ppl-btn-secondary flex-1">
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting} className="ppl-btn ppl-btn-primary flex-1">
              {isSubmitting
                ? 'Creating...'
                : form.recurringCount && form.recurringCount > 1
                ? `Create ${form.recurringCount} Sessions`
                : 'Create Session'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
