'use client';

/**
 * Consultation calendar admin — Phase 2 (#20).
 *
 * Lists all upcoming consult slots, lets admin bulk-generate weekly
 * recurring availability and delete unbooked slots. Booked slots show
 * the prospect's contact info inline.
 */

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';

const API_BASE =
  typeof window !== 'undefined' && window.location.host.includes('localhost')
    ? '/api'
    : process.env.NEXT_PUBLIC_API_URL || 'https://api.pitchingperformancelab.com/api';

type Slot = {
  id: string;
  startTime: string;
  durationMinutes: number;
  status: 'AVAILABLE' | 'BOOKED' | 'CANCELLED';
  internalNote: string | null;
  host: { id: string; fullName: string } | null;
  location: { id: string; name: string } | null;
  booking: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    notes: string | null;
  } | null;
};

const STATUS_STYLES: Record<string, string> = {
  AVAILABLE: 'bg-blue-500/10 text-blue-400 border border-blue-500/30',
  BOOKED: 'bg-green-500/10 text-green-400 border border-green-500/30',
  CANCELLED: 'bg-gray-500/10 text-gray-500 border border-gray-500/20',
};

async function authFetch(path: string, init?: RequestInit) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || `Request failed: ${res.status}`);
  return json;
}

export default function AdminConsultationsPage() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBulkModal, setShowBulkModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const json = await authFetch('/consultations');
      setSlots((json.data as Slot[]) || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load slots');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this slot?')) return;
    try {
      await authFetch(`/consultations/slots/${id}`, { method: 'DELETE' });
      toast.success('Slot deleted');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const upcoming = slots.filter((s) => new Date(s.startTime) > new Date());

  return (
    <main className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Consultation Calendar</h1>
          <p className="text-sm text-muted mt-0.5">
            Free 15-min discovery calls. Public booking page:{' '}
            <a href="/consult" target="_blank" rel="noopener" className="text-accent-text hover:underline">
              /consult
            </a>
          </p>
        </div>
        <button onClick={() => setShowBulkModal(true)} className="ppl-btn ppl-btn-primary text-sm">
          + Bulk-Add Slots
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="ppl-card animate-pulse h-16" />)}
        </div>
      ) : upcoming.length === 0 ? (
        <div className="ppl-card text-center py-12">
          <p className="text-muted text-sm">
            No upcoming slots. Click "Bulk-Add Slots" to create availability.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {upcoming.map((s) => {
            const dt = new Date(s.startTime);
            return (
              <div key={s.id} className="ppl-card flex items-center gap-4 flex-wrap">
                <div className="w-14 h-14 rounded-lg bg-background flex flex-col items-center justify-center flex-shrink-0">
                  <span className="text-xs text-muted font-medium">
                    {dt.toLocaleDateString('en-US', { month: 'short' })}
                  </span>
                  <span className="text-lg font-bold text-foreground leading-tight">{dt.getDate()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-foreground text-sm">
                      {dt.toLocaleDateString('en-US', { weekday: 'short' })}{' '}
                      {dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </p>
                    <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full ${STATUS_STYLES[s.status] || ''}`}>
                      {s.status}
                    </span>
                  </div>
                  <p className="text-xs text-muted mt-0.5">
                    {s.durationMinutes} min
                    {s.host && ` · ${s.host.fullName}`}
                    {s.location && ` · ${s.location.name}`}
                  </p>
                  {s.booking && (
                    <p className="text-xs text-foreground mt-1">
                      <strong>{s.booking.name}</strong> ·{' '}
                      <a href={`mailto:${s.booking.email}`} className="text-accent-text hover:underline">
                        {s.booking.email}
                      </a>
                      {s.booking.phone && ` · ${s.booking.phone}`}
                      {s.booking.notes && ` — “${s.booking.notes}”`}
                    </p>
                  )}
                </div>
                {s.status === 'AVAILABLE' && (
                  <button
                    onClick={() => handleDelete(s.id)}
                    className="ppl-btn text-xs px-3 py-1.5 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20"
                  >
                    Delete
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showBulkModal && (
        <BulkSlotsModal
          onClose={() => setShowBulkModal(false)}
          onCreated={async () => { setShowBulkModal(false); await load(); }}
        />
      )}
    </main>
  );
}

function BulkSlotsModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [times, setTimes] = useState('09:00, 09:30, 10:00, 10:30, 14:00, 14:30, 15:00');
  const [duration, setDuration] = useState(15);
  const [submitting, setSubmitting] = useState(false);

  const toggleWeekday = (d: number) => {
    setWeekdays((prev) => (prev.includes(d) ? prev.filter((w) => w !== d) : [...prev, d].sort()));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const parsedTimes = times
        .split(/[,\n]/)
        .map((t) => t.trim())
        .filter((t) => /^\d{1,2}:\d{2}$/.test(t));
      const json = await authFetch('/consultations/slots/bulk', {
        method: 'POST',
        body: JSON.stringify({
          startDate,
          endDate,
          weekdays,
          times: parsedTimes,
          durationMinutes: duration,
        }),
      });
      const data = json.data as { created: number; skipped: number };
      toast.success(`Created ${data.created} slots${data.skipped > 0 ? ` (${data.skipped} duplicates skipped)` : ''}`);
      await onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to bulk-create');
    } finally {
      setSubmitting(false);
    }
  };

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border rounded-xl max-w-md w-full overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground">Bulk-Add Slots</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted uppercase tracking-wider">From</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="ppl-input w-full text-sm mt-1"
              />
            </div>
            <div>
              <label className="text-xs text-muted uppercase tracking-wider">To</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="ppl-input w-full text-sm mt-1"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted uppercase tracking-wider">Days of Week</label>
            <div className="flex gap-1 mt-1">
              {dayLabels.map((day, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggleWeekday(i)}
                  className={`flex-1 px-2 py-1.5 rounded text-xs font-medium transition ${
                    weekdays.includes(i)
                      ? 'bg-highlight/25 text-foreground border border-highlight/40'
                      : 'bg-background text-muted border border-border'
                  }`}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-muted uppercase tracking-wider">Times (comma-separated, 24h)</label>
            <input
              type="text"
              value={times}
              onChange={(e) => setTimes(e.target.value)}
              className="ppl-input w-full text-sm mt-1 font-mono"
              placeholder="09:00, 09:30, 14:00"
            />
          </div>
          <div>
            <label className="text-xs text-muted uppercase tracking-wider">Duration (minutes)</label>
            <input
              type="number"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              min={5}
              max={120}
              className="ppl-input w-full text-sm mt-1"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="ppl-btn ppl-btn-primary w-full text-sm disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create Slots'}
          </button>
        </form>
      </div>
    </div>
  );
}
