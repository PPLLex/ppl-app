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

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface ScheduleTemplate {
  id: string;
  locationId: string;
  roomId: string | null;
  coachId: string | null;
  title: string;
  sessionType: string;
  dayOfWeek: number;
  startHour: number;
  startMinute: number;
  durationMinutes: number;
  maxCapacity: number;
  registrationCutoffHours: number;
  cancellationCutoffHours: number;
  isActive: boolean;
  room?: { id: string; name: string } | null;
  coach?: { id: string; fullName: string } | null;
}

export default function AdminSchedulePage() {
  const [activeTab, setActiveTab] = useState<'calendar' | 'templates'>('calendar');
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
        <div className="flex items-center gap-3">
          {activeTab === 'calendar' && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="ppl-btn ppl-btn-primary"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              New Session
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border">
        <button
          onClick={() => setActiveTab('calendar')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'calendar'
              ? 'border-ppl-light-green text-ppl-light-green'
              : 'border-transparent text-muted hover:text-foreground'
          }`}
        >
          Weekly Calendar
        </button>
        <button
          onClick={() => setActiveTab('templates')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'templates'
              ? 'border-ppl-light-green text-ppl-light-green'
              : 'border-transparent text-muted hover:text-foreground'
          }`}
        >
          Schedule Templates
        </button>
      </div>

      {activeTab === 'templates' ? (
        <ScheduleTemplatesView
          locations={locations}
          selectedLocationId={selectedLocationId}
          onLocationChange={setSelectedLocationId}
        />
      ) : (
      <></>
      )}

      {activeTab === 'calendar' && (
      <>

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
      </>
      )}
    </div>
  );
}

// ============================================================
// SCHEDULE TEMPLATES VIEW
// ============================================================

function ScheduleTemplatesView({
  locations,
  selectedLocationId,
  onLocationChange,
}: {
  locations: Location[];
  selectedLocationId: string;
  onLocationChange: (id: string) => void;
}) {
  const [templates, setTemplates] = useState<ScheduleTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateTemplate, setShowCreateTemplate] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadTemplates = useCallback(async () => {
    if (!selectedLocationId) return;
    setIsLoading(true);
    try {
      const res = await api.request(`/sessions/templates?locationId=${selectedLocationId}`);
      setTemplates((res as any).data || []);
    } catch (err) {
      console.error('Failed to load templates:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedLocationId]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  // Group templates by day
  const templatesByDay = DAY_NAMES.map((_, dayIndex) =>
    templates.filter((t) => t.dayOfWeek === dayIndex && t.isActive)
      .sort((a, b) => a.startHour * 60 + a.startMinute - (b.startHour * 60 + b.startMinute))
  );

  const formatTemplateTime = (hour: number, minute: number) => {
    const period = hour >= 12 ? 'PM' : 'AM';
    const h = hour % 12 || 12;
    return `${h}:${minute.toString().padStart(2, '0')} ${period}`;
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setMessage(null);
    try {
      const res = await api.request<{ created: number }>('/sessions/templates/generate', {
        method: 'POST',
        body: JSON.stringify({ locationId: selectedLocationId, weeksAhead: 2 }),
      });
      setMessage({
        type: 'success',
        text: res.message || `Generated ${res.data?.created || 0} sessions`,
      });
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to generate sessions' });
    } finally {
      setGenerating(false);
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    try {
      await api.request(`/sessions/templates/${id}`, { method: 'DELETE' });
      loadTemplates();
    } catch (err) {
      console.error('Failed to delete template:', err);
    }
  };

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <select
            value={selectedLocationId}
            onChange={(e) => onLocationChange(e.target.value)}
            className="ppl-input w-auto"
          >
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>{loc.name}</option>
            ))}
          </select>
          <p className="text-sm text-muted">
            {templates.filter((t) => t.isActive).length} active template(s)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleGenerate}
            disabled={generating || templates.length === 0}
            className="ppl-btn ppl-btn-secondary"
          >
            {generating ? 'Generating...' : 'Generate Next 2 Weeks'}
          </button>
          <button
            onClick={() => setShowCreateTemplate(true)}
            className="ppl-btn ppl-btn-primary"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Template
          </button>
        </div>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${
          message.type === 'success'
            ? 'bg-ppl-dark-green/10 border border-ppl-dark-green/20 text-ppl-light-green'
            : 'bg-danger/10 border border-danger/20 text-danger'
        }`}>
          {message.text}
        </div>
      )}

      {/* Weekly Template Grid */}
      <div className="ppl-card p-0 overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border">
          {DAY_NAMES_SHORT.map((name, i) => (
            <div key={i} className="p-3 text-center border-r border-border last:border-r-0">
              <p className="text-xs text-muted uppercase">{name}</p>
              <p className="text-xs text-muted mt-0.5">
                {templatesByDay[i].length} session{templatesByDay[i].length !== 1 ? 's' : ''}
              </p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 min-h-[350px]">
          {templatesByDay.map((dayTemplates, i) => (
            <div key={i} className="border-r border-border last:border-r-0 p-2 space-y-2">
              {isLoading ? (
                <div className="h-16 bg-surface-hover rounded animate-pulse" />
              ) : dayTemplates.length === 0 ? (
                <p className="text-xs text-muted text-center pt-4">—</p>
              ) : (
                dayTemplates.map((tmpl) => (
                  <div
                    key={tmpl.id}
                    className={`p-2 rounded-lg border text-xs group relative ${
                      SESSION_TYPE_COLORS[tmpl.sessionType] || 'bg-surface border-border'
                    }`}
                  >
                    <p className="font-semibold truncate">{tmpl.title}</p>
                    <p className="opacity-80">
                      {formatTemplateTime(tmpl.startHour, tmpl.startMinute)}
                    </p>
                    <p className="opacity-70">{tmpl.durationMinutes}min · {tmpl.maxCapacity} max</p>
                    {tmpl.room && <p className="opacity-70">{tmpl.room.name}</p>}
                    {tmpl.coach && <p className="opacity-70">{tmpl.coach.fullName}</p>}
                    <button
                      onClick={() => handleDeleteTemplate(tmpl.id)}
                      className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-danger hover:text-danger/80 transition-opacity"
                      title="Remove template"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted mt-3">
        Templates define your recurring weekly schedule. Click &quot;Generate Next 2 Weeks&quot; to create actual
        sessions from these templates. This runs automatically every Sunday night.
      </p>

      {/* Create Template Modal */}
      {showCreateTemplate && (
        <CreateTemplateModal
          locationId={selectedLocationId}
          locations={locations}
          onClose={() => setShowCreateTemplate(false)}
          onCreated={() => {
            setShowCreateTemplate(false);
            loadTemplates();
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// CREATE TEMPLATE MODAL
// ============================================================

function CreateTemplateModal({
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
  const [form, setForm] = useState({
    locationId,
    title: '',
    sessionType: 'MS_HS_PITCHING',
    dayOfWeek: 1, // Monday
    startHour: 15, // 3 PM
    startMinute: 0,
    durationMinutes: 60,
    maxCapacity: 8,
    roomId: '',
  });
  const [rooms, setRooms] = useState<Room[]>([]);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      const title = form.title || SESSION_TYPE_LABELS[form.sessionType] || form.sessionType;
      await api.request('/sessions/templates', {
        method: 'POST',
        body: JSON.stringify({ ...form, title, roomId: form.roomId || null }),
      });
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create template');
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateForm = (updates: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...updates }));
  };

  // Generate time options (6 AM to 10 PM in 30-min increments)
  const timeOptions = [];
  for (let h = 6; h <= 22; h++) {
    for (const m of [0, 30]) {
      const period = h >= 12 ? 'PM' : 'AM';
      const display = `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${period}`;
      timeOptions.push({ hour: h, minute: m, display });
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="ppl-card w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-foreground">New Schedule Template</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-sm text-muted mb-4">
          Define a recurring weekly session slot. Sessions will be auto-generated from this template.
        </p>

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
              Title <span className="text-muted">(optional)</span>
            </label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => updateForm({ title: e.target.value })}
              placeholder={SESSION_TYPE_LABELS[form.sessionType]}
              className="ppl-input"
            />
          </div>

          {/* Day + Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Day of Week</label>
              <select
                value={form.dayOfWeek}
                onChange={(e) => updateForm({ dayOfWeek: parseInt(e.target.value) })}
                className="ppl-input"
              >
                {DAY_NAMES.map((name, i) => (
                  <option key={i} value={i}>{name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Start Time</label>
              <select
                value={`${form.startHour}:${form.startMinute}`}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(':').map(Number);
                  updateForm({ startHour: h, startMinute: m });
                }}
                className="ppl-input"
              >
                {timeOptions.map((opt) => (
                  <option key={`${opt.hour}:${opt.minute}`} value={`${opt.hour}:${opt.minute}`}>
                    {opt.display}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Duration + Capacity */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Duration</label>
              <select
                value={form.durationMinutes}
                onChange={(e) => updateForm({ durationMinutes: parseInt(e.target.value) })}
                className="ppl-input"
              >
                <option value={30}>30 min</option>
                <option value={45}>45 min</option>
                <option value={60}>1 hour</option>
                <option value={90}>1.5 hours</option>
                <option value={120}>2 hours</option>
              </select>
            </div>
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
          </div>

          {/* Room */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Room</label>
            <select
              value={form.roomId}
              onChange={(e) => updateForm({ roomId: e.target.value })}
              className="ppl-input"
            >
              <option value="">No specific room</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>{room.name}</option>
              ))}
            </select>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="ppl-btn ppl-btn-secondary flex-1">
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting} className="ppl-btn ppl-btn-primary flex-1">
              {isSubmitting ? 'Creating...' : 'Create Template'}
            </button>
          </div>
        </form>
      </div>
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
