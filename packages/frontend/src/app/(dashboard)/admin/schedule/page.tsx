'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, SessionWithAvailability, Location, Room, CreateSessionData, RecurringSeriesData } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

const SESSION_TYPE_LABELS: Record<string, string> = {
  COLLEGE_PITCHING: 'College Pitching',
  MS_HS_PITCHING: 'MS/HS Pitching',
  YOUTH_PITCHING: 'Youth Pitching',
  PRIVATE_LESSON: 'Private Lesson',
  CAGE_RENTAL: 'Cage Rental',
};

const SESSION_TYPE_COLORS: Record<string, string> = {
  COLLEGE_PITCHING: 'bg-highlight/20 border-highlight text-accent-text',
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
  const [rosterSessionId, setRosterSessionId] = useState<string | null>(null);
  const [seriesGroupId, setSeriesGroupId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; session: SessionWithAvailability } | null>(null);
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
              ? 'border-highlight text-accent-text'
              : 'border-transparent text-muted hover:text-foreground'
          }`}
        >
          Weekly Calendar
        </button>
        <button
          onClick={() => setActiveTab('templates')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'templates'
              ? 'border-highlight text-accent-text'
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
                  isToday ? 'bg-highlight/10' : ''
                }`}
              >
                <p className="text-xs text-muted uppercase">{dayName}</p>
                <p
                  className={`text-lg font-bold mt-0.5 ${
                    isToday ? 'text-accent-text' : 'text-foreground'
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
                      onClick={() => setRosterSessionId(session.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({ x: e.clientX, y: e.clientY, session });
                      }}
                      className={`p-2 rounded-lg border text-xs cursor-pointer transition-all hover:scale-[1.02] relative group ${
                        SESSION_TYPE_COLORS[session.sessionType] || 'bg-surface border-border'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <p className="font-semibold truncate flex-1">{session.title}</p>
                        {session.recurringGroupId && (
                          <span title="Part of recurring series" className="opacity-60 flex-shrink-0">🔄</span>
                        )}
                      </div>
                      <p className="opacity-80">
                        {formatTime(session.startTime)} - {formatTime(session.endTime)}
                      </p>
                      {session.room && <p className="opacity-70">{session.room.name}</p>}
                      <p className="opacity-70 mt-1">
                        {session.currentEnrolled}/{session.maxCapacity} booked
                      </p>
                      {/* Quick action dots (visible on hover) */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setContextMenu({ x: e.clientX, y: e.clientY, session });
                        }}
                        className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
                      >
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                        </svg>
                      </button>
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

      {/* Roster Modal */}
      {rosterSessionId && (
        <RosterModal
          sessionId={rosterSessionId}
          onClose={() => setRosterSessionId(null)}
        />
      )}

      {/* Context Menu */}
      {contextMenu && (
        <SessionContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          session={contextMenu.session}
          onClose={() => setContextMenu(null)}
          onViewRoster={() => {
            setRosterSessionId(contextMenu.session.id);
            setContextMenu(null);
          }}
          onViewSeries={() => {
            if (contextMenu.session.recurringGroupId) {
              setSeriesGroupId(contextMenu.session.recurringGroupId);
            }
            setContextMenu(null);
          }}
          onDeleteSession={async () => {
            try {
              await api.deleteSession(contextMenu.session.id);
              setContextMenu(null);
              loadSessions();
            } catch (err) {
              console.error('Failed to delete session:', err);
            }
          }}
          onDeleteSeries={async () => {
            if (!contextMenu.session.recurringGroupId) return;
            if (!confirm('Cancel ALL future sessions in this series? This will also cancel any existing bookings.')) return;
            try {
              await api.deleteSeries(contextMenu.session.recurringGroupId);
              setContextMenu(null);
              loadSessions();
            } catch (err) {
              console.error('Failed to delete series:', err);
            }
          }}
        />
      )}

      {/* Series Detail Modal */}
      {seriesGroupId && (
        <SeriesDetailModal
          groupId={seriesGroupId}
          onClose={() => setSeriesGroupId(null)}
          onUpdated={() => {
            setSeriesGroupId(null);
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
            ? 'bg-highlight/10 border border-highlight/20 text-accent-text'
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
  const [locId, setLocId] = useState(locationId);
  const [sessionType, setSessionType] = useState('MS_HS_PITCHING');
  const [title, setTitle] = useState('');
  const [roomId, setRoomId] = useState('');
  const [time, setTime] = useState('15:00');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [maxCapacity, setMaxCapacity] = useState(8);
  const [isRecurring, setIsRecurring] = useState(false);

  // For one-time: single date
  const [singleDate, setSingleDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });

  // For recurring: days of week + date range
  const [recurringDays, setRecurringDays] = useState<number[]>([]);
  const [recurringStartDate, setRecurringStartDate] = useState(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  });
  const [recurringEndDate, setRecurringEndDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 3);
    return d.toISOString().slice(0, 10);
  });

  const [rooms, setRooms] = useState<Room[]>([]);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    api.getLocation(locId).then((res) => {
      if (res.data?.rooms) setRooms(res.data.rooms);
    });
  }, [locId]);

  const toggleDay = (day: number) => {
    setRecurringDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  };

  // Calculate how many sessions will be created
  const estimatedCount = (() => {
    if (!isRecurring) return 1;
    if (recurringDays.length === 0) return 0;
    let count = 0;
    const current = new Date(recurringStartDate);
    current.setHours(0, 0, 0, 0);
    const end = new Date(recurringEndDate);
    end.setHours(23, 59, 59, 999);
    const now = new Date();
    const [h, m] = time.split(':').map(Number);
    while (current <= end && count < 500) {
      if (recurringDays.includes(current.getDay())) {
        const sessionDate = new Date(current);
        sessionDate.setHours(h, m, 0, 0);
        if (sessionDate > now) count++;
      }
      current.setDate(current.getDate() + 1);
    }
    return count;
  })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (isRecurring && recurringDays.length === 0) {
      setError('Select at least one day of the week for recurring sessions');
      return;
    }
    if (isRecurring && estimatedCount === 0) {
      setError('No sessions would be created with this date range — check your dates');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.createSession({
        locationId: locId,
        roomId: roomId || undefined,
        title: title || SESSION_TYPE_LABELS[sessionType] || sessionType,
        sessionType,
        startDate: isRecurring ? recurringStartDate : singleDate,
        time,
        durationMinutes,
        maxCapacity,
        isRecurring,
        recurringDays: isRecurring ? recurringDays : undefined,
        recurringEndDate: isRecurring ? recurringEndDate : undefined,
      });
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setIsSubmitting(false);
    }
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
            <select value={locId} onChange={(e) => setLocId(e.target.value)} className="ppl-input">
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>{loc.name}</option>
              ))}
            </select>
          </div>

          {/* Session Type */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Session Type</label>
            <select value={sessionType} onChange={(e) => setSessionType(e.target.value)} className="ppl-input">
              {Object.entries(SESSION_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Title <span className="text-muted">(optional — defaults to type)</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={SESSION_TYPE_LABELS[sessionType]}
              className="ppl-input"
            />
          </div>

          {/* Room + Capacity row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Room</label>
              <select value={roomId} onChange={(e) => setRoomId(e.target.value)} className="ppl-input">
                <option value="">No specific room</option>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>{room.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Max Athletes</label>
              <input
                type="number"
                min={1}
                max={50}
                value={maxCapacity}
                onChange={(e) => setMaxCapacity(parseInt(e.target.value) || 8)}
                className="ppl-input"
              />
            </div>
          </div>

          {/* Time + Duration row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Time</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="ppl-input"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Duration</label>
              <select
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(parseInt(e.target.value))}
                className="ppl-input"
              >
                <option value={30}>30 min</option>
                <option value={45}>45 min</option>
                <option value={60}>1 hour</option>
                <option value={75}>1 hr 15 min</option>
                <option value={90}>1.5 hours</option>
                <option value={120}>2 hours</option>
              </select>
            </div>
          </div>

          {/* One-time vs Recurring toggle */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Schedule Type</label>
            <div className="flex rounded-lg overflow-hidden border border-border">
              <button
                type="button"
                onClick={() => setIsRecurring(false)}
                className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
                  !isRecurring
                    ? 'bg-primary text-white'
                    : 'bg-background text-muted hover:text-foreground'
                }`}
              >
                One-Time
              </button>
              <button
                type="button"
                onClick={() => setIsRecurring(true)}
                className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
                  isRecurring
                    ? 'bg-primary text-white'
                    : 'bg-background text-muted hover:text-foreground'
                }`}
              >
                Recurring
              </button>
            </div>
          </div>

          {!isRecurring ? (
            /* ONE-TIME: single date picker */
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Date</label>
              <input
                type="date"
                value={singleDate}
                onChange={(e) => setSingleDate(e.target.value)}
                className="ppl-input"
                required
              />
            </div>
          ) : (
            /* RECURRING: day-of-week picker + date range */
            <>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Days of the Week</label>
                <div className="flex gap-1.5">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(idx)}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
                        recurringDays.includes(idx)
                          ? 'bg-primary text-white ring-1 ring-accent/30'
                          : 'bg-background text-muted hover:text-foreground hover:bg-surface/50'
                      }`}
                    >
                      {day}
                    </button>
                  ))}
                </div>
                {recurringDays.length > 0 && (
                  <p className="text-xs text-accent-text mt-1.5">
                    Every {recurringDays.map((d) => DAY_NAMES[d]).join(', ')}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Start Date</label>
                  <input
                    type="date"
                    value={recurringStartDate}
                    onChange={(e) => setRecurringStartDate(e.target.value)}
                    className="ppl-input"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">End Date</label>
                  <input
                    type="date"
                    value={recurringEndDate}
                    onChange={(e) => setRecurringEndDate(e.target.value)}
                    className="ppl-input"
                    required
                  />
                </div>
              </div>
            </>
          )}

          {/* Summary preview */}
          {isRecurring && estimatedCount > 0 && (
            <div className="bg-highlight/10 border border-highlight/20 rounded-lg p-3">
              <p className="text-sm text-accent-text font-medium">
                This will create {estimatedCount} session{estimatedCount !== 1 ? 's' : ''}
              </p>
              <p className="text-xs text-muted mt-0.5">
                {SESSION_TYPE_LABELS[sessionType]} at {time} for {durationMinutes} min
                {' · '}every {recurringDays.map((d) => DAY_NAMES_SHORT[d]).join(', ')}
                {' · '}through {new Date(recurringEndDate).toLocaleDateString()}
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="ppl-btn ppl-btn-secondary flex-1">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || (isRecurring && estimatedCount === 0)}
              className="ppl-btn ppl-btn-primary flex-1"
            >
              {isSubmitting
                ? 'Creating...'
                : isRecurring
                ? `Create ${estimatedCount} Session${estimatedCount !== 1 ? 's' : ''}`
                : 'Create Session'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================
// ROSTER MODAL  (Session Participants + Violation Tracking)
// ============================================================

interface RosterClient {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
}

interface RosterEntry {
  bookingId: string;
  client: RosterClient;
  status: string;
  bookedAt: string;
}

interface ViolationEntry {
  id: string;
  clientId: string;
  type: 'NO_SIGNUP' | 'WRONG_TIME';
  amountCents: number;
  status: string;
  notes: string | null;
  client: RosterClient;
  assessedBy: { id: string; fullName: string };
  createdAt: string;
}

interface RosterData {
  session: {
    id: string;
    title: string;
    sessionType: string;
    startTime: string;
    endTime: string;
    maxCapacity: number;
  };
  roster: RosterEntry[];
  violations: ViolationEntry[];
}

function RosterModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [data, setData] = useState<RosterData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showViolationForm, setShowViolationForm] = useState(false);
  const [violationForm, setViolationForm] = useState({
    clientSearch: '',
    clientId: '',
    clientName: '',
    type: 'NO_SIGNUP' as 'NO_SIGNUP' | 'WRONG_TIME',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [searchResults, setSearchResults] = useState<Array<{ id: string; fullName: string; email: string }>>([]);

  const loadRoster = useCallback(async () => {
    try {
      const res = await api.request<RosterData>(`/sessions/${sessionId}/roster`);
      if (res.data) setData(res.data);
    } catch (err) {
      console.error('Failed to load roster:', err);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { loadRoster(); }, [loadRoster]);

  // Search members for violation form
  const searchMembers = async (query: string) => {
    setViolationForm((f) => ({ ...f, clientSearch: query, clientId: '', clientName: '' }));
    if (query.length < 2) { setSearchResults([]); return; }
    try {
      const res = await api.request<Array<{ id: string; fullName: string; email: string }>>(
        `/members?search=${encodeURIComponent(query)}&limit=5`
      );
      if (res.data) setSearchResults(res.data);
    } catch { setSearchResults([]); }
  };

  const selectClient = (c: { id: string; fullName: string }) => {
    setViolationForm((f) => ({ ...f, clientId: c.id, clientName: c.fullName, clientSearch: c.fullName }));
    setSearchResults([]);
  };

  const submitViolation = async () => {
    if (!violationForm.clientId) return;
    setSubmitting(true);
    try {
      await api.request(`/sessions/${sessionId}/violations`, {
        method: 'POST',
        body: JSON.stringify({
          clientId: violationForm.clientId,
          type: violationForm.type,
          notes: violationForm.notes || null,
        }),
      });
      setShowViolationForm(false);
      setViolationForm({ clientSearch: '', clientId: '', clientName: '', type: 'NO_SIGNUP', notes: '' });
      loadRoster();
    } catch (err) {
      console.error('Failed to log violation:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const waiveViolation = async (violationId: string) => {
    try {
      await api.request(`/sessions/violations/${violationId}/waive`, { method: 'PUT' });
      loadRoster();
    } catch (err) {
      console.error('Failed to waive violation:', err);
    }
  };

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border w-full max-w-lg max-h-[80vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
        {isLoading || !data ? (
          <div className="p-8 text-center"><div className="animate-pulse h-24 bg-background rounded-lg" /></div>
        ) : (
          <>
            {/* Header */}
            <div className="p-4 border-b border-border sticky top-0 bg-surface z-10">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-foreground">{data.session.title}</h2>
                  <p className="text-xs text-muted">
                    {formatTime(data.session.startTime)} - {formatTime(data.session.endTime)}
                    {' · '}
                    {SESSION_TYPE_LABELS[data.session.sessionType] || data.session.sessionType}
                  </p>
                </div>
                <button onClick={onClose} className="text-muted hover:text-foreground text-lg">&times;</button>
              </div>
            </div>

            {/* Roster */}
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-foreground">
                  Registered Athletes ({data.roster.length}/{data.session.maxCapacity})
                </h3>
              </div>
              {data.roster.length > 0 ? (
                <div className="space-y-1.5">
                  {data.roster.map((entry) => (
                    <div key={entry.bookingId} className="flex items-center justify-between p-2 bg-background rounded-lg">
                      <div>
                        <p className="text-sm font-medium text-foreground">{entry.client.fullName}</p>
                        <p className="text-xs text-muted">{entry.client.email}</p>
                      </div>
                      <span className="ppl-badge ppl-badge-active text-xs">{entry.status}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted text-center py-3">No athletes registered yet</p>
              )}
            </div>

            {/* Violations */}
            <div className="p-4 border-t border-border">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-foreground">
                  Attendance Violations ({data.violations.length})
                </h3>
                <button
                  onClick={() => setShowViolationForm(!showViolationForm)}
                  className="ppl-btn ppl-btn-secondary text-xs"
                >
                  {showViolationForm ? 'Cancel' : '+ Log Violation'}
                </button>
              </div>

              {/* Violation Form */}
              {showViolationForm && (
                <div className="bg-background rounded-lg p-3 mb-3 space-y-2">
                  <div className="relative">
                    <label className="text-xs text-muted block mb-0.5">Athlete</label>
                    <input
                      type="text"
                      value={violationForm.clientSearch}
                      onChange={(e) => searchMembers(e.target.value)}
                      className="ppl-input text-sm"
                      placeholder="Search by name..."
                    />
                    {searchResults.length > 0 && (
                      <div className="absolute top-full left-0 right-0 bg-surface border border-border rounded-lg mt-1 z-20 shadow-lg">
                        {searchResults.map((c) => (
                          <button
                            key={c.id}
                            onClick={() => selectClient(c)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-background transition-colors"
                          >
                            <span className="text-foreground">{c.fullName}</span>
                            <span className="text-muted text-xs ml-2">{c.email}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {violationForm.clientId && (
                      <p className="text-xs text-accent-text mt-0.5">Selected: {violationForm.clientName}</p>
                    )}
                  </div>
                  <div>
                    <label className="text-xs text-muted block mb-0.5">Violation Type</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setViolationForm((f) => ({ ...f, type: 'NO_SIGNUP' }))}
                        className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                          violationForm.type === 'NO_SIGNUP'
                            ? 'bg-red-500/20 text-red-400 ring-1 ring-red-500/30'
                            : 'bg-background text-muted hover:bg-surface/50'
                        }`}
                      >
                        No Signup ($20)
                      </button>
                      <button
                        onClick={() => setViolationForm((f) => ({ ...f, type: 'WRONG_TIME' }))}
                        className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                          violationForm.type === 'WRONG_TIME'
                            ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/30'
                            : 'bg-background text-muted hover:bg-surface/50'
                        }`}
                      >
                        Wrong Time ($10)
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted block mb-0.5">Notes (optional)</label>
                    <input
                      type="text"
                      value={violationForm.notes}
                      onChange={(e) => setViolationForm((f) => ({ ...f, notes: e.target.value }))}
                      className="ppl-input text-sm"
                      placeholder="What happened?"
                    />
                  </div>
                  <button
                    onClick={submitViolation}
                    disabled={!violationForm.clientId || submitting}
                    className="ppl-btn ppl-btn-primary text-xs w-full justify-center"
                  >
                    {submitting ? 'Logging...' : `Log ${violationForm.type === 'NO_SIGNUP' ? '$20' : '$10'} Violation`}
                  </button>
                </div>
              )}

              {/* Violation List */}
              {data.violations.length > 0 ? (
                <div className="space-y-1.5">
                  {data.violations.map((v) => (
                    <div key={v.id} className="flex items-center justify-between p-2 bg-background rounded-lg">
                      <div>
                        <p className="text-sm font-medium text-foreground">{v.client.fullName}</p>
                        <p className="text-xs text-muted">
                          {v.type === 'NO_SIGNUP' ? 'No signup' : 'Wrong time'}
                          {' · '}${(v.amountCents / 100).toFixed(0)}
                          {v.notes && ` · ${v.notes}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium ${
                          v.status === 'PENDING' ? 'text-amber-400' :
                          v.status === 'PAID' ? 'text-accent-text' : 'text-muted'
                        }`}>
                          {v.status}
                        </span>
                        {v.status === 'PENDING' && (
                          <button
                            onClick={() => waiveViolation(v.id)}
                            className="text-xs text-muted hover:text-foreground"
                            title="Waive fine"
                          >
                            Waive
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted text-center py-2">No violations logged</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// SESSION CONTEXT MENU
// ============================================================

function SessionContextMenu({
  x, y, session, onClose, onViewRoster, onViewSeries, onDeleteSession, onDeleteSeries,
}: {
  x: number;
  y: number;
  session: SessionWithAvailability;
  onClose: () => void;
  onViewRoster: () => void;
  onViewSeries: () => void;
  onDeleteSession: () => void;
  onDeleteSeries: () => void;
}) {
  useEffect(() => {
    const handler = () => onClose();
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [onClose]);

  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    left: x,
    top: y,
    zIndex: 9999,
  };

  return (
    <div style={menuStyle} className="bg-surface border border-border rounded-lg shadow-xl py-1 min-w-[200px]">
      <button
        onClick={onViewRoster}
        className="w-full text-left px-4 py-2 text-sm text-foreground hover:bg-surface-hover flex items-center gap-2"
      >
        <svg className="w-4 h-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        View Roster
      </button>

      {session.recurringGroupId && (
        <button
          onClick={onViewSeries}
          className="w-full text-left px-4 py-2 text-sm text-foreground hover:bg-surface-hover flex items-center gap-2"
        >
          <svg className="w-4 h-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          View Series ({session.recurringGroupId.slice(0, 6)}...)
        </button>
      )}

      <div className="border-t border-border my-1" />

      <button
        onClick={onDeleteSession}
        className="w-full text-left px-4 py-2 text-sm text-danger hover:bg-danger/10 flex items-center gap-2"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        Cancel This Session
      </button>

      {session.recurringGroupId && (
        <button
          onClick={onDeleteSeries}
          className="w-full text-left px-4 py-2 text-sm text-danger hover:bg-danger/10 flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          Cancel Entire Series
        </button>
      )}
    </div>
  );
}

// ============================================================
// SERIES DETAIL MODAL
// ============================================================

function SeriesDetailModal({
  groupId,
  onClose,
  onUpdated,
}: {
  groupId: string;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [seriesData, setSeriesData] = useState<RecurringSeriesData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({ title: '', maxCapacity: 8, time: '' });
  const [saving, setSaving] = useState(false);
  const [extending, setExtending] = useState(false);
  const [extendWeeks, setExtendWeeks] = useState(4);
  const [showExtend, setShowExtend] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadSeries();
  }, [groupId]);

  const loadSeries = async () => {
    setIsLoading(true);
    try {
      const res = await api.getSeriesSessions(groupId);
      if (res.data) {
        setSeriesData(res.data);
        const first = res.data.sessions[0];
        if (first) {
          const d = new Date(first.startTime);
          setEditForm({
            title: res.data.title,
            maxCapacity: first.maxCapacity,
            time: `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`,
          });
        }
      }
    } catch (err) {
      setError('Failed to load series');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveEdits = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await api.updateSeries(groupId, {
        title: editForm.title,
        maxCapacity: editForm.maxCapacity,
        time: editForm.time,
      });
      setMessage({ type: 'success', text: res.message || `${res.data?.updated || 0} sessions updated` });
      setEditMode(false);
      loadSeries();
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to update series' });
    } finally {
      setSaving(false);
    }
  };

  const handleExtend = async () => {
    setExtending(true);
    setMessage(null);
    try {
      const res = await api.extendSeries(groupId, { additionalWeeks: extendWeeks });
      setMessage({ type: 'success', text: res.message || `${res.data?.created || 0} sessions added` });
      setShowExtend(false);
      loadSeries();
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to extend series' });
    } finally {
      setExtending(false);
    }
  };

  const handleCancelSingle = async (sessionId: string) => {
    if (!confirm('Cancel this single session? Any bookings will be automatically cancelled.')) return;
    try {
      await api.deleteSession(sessionId);
      setMessage({ type: 'success', text: 'Session cancelled' });
      loadSeries();
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to cancel session' });
    }
  };

  const formatDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });

  const formatTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  });

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-surface border border-border rounded-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">Recurring Series</h2>
            {seriesData && (
              <p className="text-sm text-muted mt-0.5">
                {SESSION_TYPE_LABELS[seriesData.sessionType] || seriesData.sessionType}
                {' · '}{seriesData.activeSessions} active · {seriesData.futureSessions} upcoming
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!editMode && seriesData && seriesData.futureSessions > 0 && (
              <button onClick={() => setEditMode(true)} className="ppl-btn ppl-btn-secondary text-xs">
                Edit Future Sessions
              </button>
            )}
            {!showExtend && seriesData && (
              <button onClick={() => setShowExtend(true)} className="ppl-btn ppl-btn-secondary text-xs">
                Extend Series
              </button>
            )}
            <button onClick={onClose} className="text-muted hover:text-foreground p-1">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {message && (
          <div className={`mx-6 mt-4 p-3 rounded-lg text-sm ${
            message.type === 'success'
              ? 'bg-highlight/10 border border-highlight/20 text-accent-text'
              : 'bg-danger/10 border border-danger/20 text-danger'
          }`}>
            {message.text}
          </div>
        )}

        {/* Edit Form */}
        {editMode && (
          <div className="p-6 border-b border-border bg-background/50 space-y-3">
            <p className="text-xs text-muted font-medium uppercase">Edit all future sessions in this series</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted block mb-0.5">Title</label>
                <input
                  type="text"
                  value={editForm.title}
                  onChange={(e) => setEditForm(f => ({ ...f, title: e.target.value }))}
                  className="ppl-input text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted block mb-0.5">Time</label>
                <input
                  type="time"
                  value={editForm.time}
                  onChange={(e) => setEditForm(f => ({ ...f, time: e.target.value }))}
                  className="ppl-input text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted block mb-0.5">Max Capacity</label>
                <input
                  type="number"
                  value={editForm.maxCapacity}
                  onChange={(e) => setEditForm(f => ({ ...f, maxCapacity: Number(e.target.value) }))}
                  className="ppl-input text-sm"
                  min={1}
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditMode(false)} className="ppl-btn ppl-btn-secondary text-xs">Cancel</button>
              <button onClick={handleSaveEdits} disabled={saving} className="ppl-btn ppl-btn-primary text-xs">
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        )}

        {/* Extend Form */}
        {showExtend && (
          <div className="p-6 border-b border-border bg-background/50 space-y-3">
            <p className="text-xs text-muted font-medium uppercase">Add more weeks to this series</p>
            <div className="flex items-end gap-3">
              <div>
                <label className="text-xs text-muted block mb-0.5">Additional Weeks</label>
                <input
                  type="number"
                  value={extendWeeks}
                  onChange={(e) => setExtendWeeks(Number(e.target.value))}
                  className="ppl-input text-sm w-24"
                  min={1}
                  max={52}
                />
              </div>
              <button onClick={() => setShowExtend(false)} className="ppl-btn ppl-btn-secondary text-xs">Cancel</button>
              <button onClick={handleExtend} disabled={extending} className="ppl-btn ppl-btn-primary text-xs">
                {extending ? 'Extending...' : `Add ${extendWeeks} Week${extendWeeks !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        )}

        {/* Sessions List */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="h-12 bg-surface-hover rounded animate-pulse" />)}
            </div>
          ) : error ? (
            <p className="text-danger text-sm">{error}</p>
          ) : seriesData && (
            <div className="space-y-1.5">
              {seriesData.sessions.map((s) => {
                const isPast = new Date(s.startTime) < new Date();
                return (
                  <div
                    key={s.id}
                    className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                      !s.isActive
                        ? 'bg-surface/30 border-border/50 opacity-50'
                        : isPast
                        ? 'bg-surface/50 border-border/70'
                        : 'bg-surface border-border hover:bg-surface-hover'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        !s.isActive ? 'bg-muted' : isPast ? 'bg-muted' : 'bg-accent'
                      }`} />
                      <div>
                        <p className={`text-sm font-medium ${isPast || !s.isActive ? 'text-muted' : 'text-foreground'}`}>
                          {formatDate(s.startTime)}
                        </p>
                        <p className="text-xs text-muted">
                          {formatTime(s.startTime)} - {formatTime(s.endTime)}
                          {' · '}{s.currentEnrolled}/{s.maxCapacity} booked
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!s.isActive && (
                        <span className="text-xs text-danger font-medium">Cancelled</span>
                      )}
                      {s.isActive && !isPast && (
                        <button
                          onClick={() => handleCancelSingle(s.id)}
                          className="text-xs text-muted hover:text-danger transition-colors"
                          title="Cancel this session"
                        >
                          Skip
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex justify-between">
          <button
            onClick={async () => {
              if (!confirm('Cancel ALL future sessions in this series?')) return;
              try {
                await api.deleteSeries(groupId);
                onUpdated();
              } catch (err) {
                setMessage({ type: 'error', text: 'Failed to cancel series' });
              }
            }}
            className="ppl-btn text-xs text-danger hover:bg-danger/10 border border-danger/30"
          >
            Cancel All Future Sessions
          </button>
          <button onClick={onClose} className="ppl-btn ppl-btn-secondary text-xs">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
