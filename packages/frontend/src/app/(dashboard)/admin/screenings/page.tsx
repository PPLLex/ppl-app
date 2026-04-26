'use client';

/**
 * Medical Screenings dashboard — Phase 2 (#93).
 *
 * Admin / Medical / Medical Admin landing page for the Renewed Performance
 * integration. Lists screenings, surfaces the weekly revenue rollup, and
 * filters by status. Booking + result entry happen on individual screening
 * detail pages (Phase 3 — out of scope for this commit).
 */

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type Screening = NonNullable<Awaited<ReturnType<typeof api.listScreenings>>['data']>[number];
type Revenue = NonNullable<Awaited<ReturnType<typeof api.getScreeningWeeklyRevenue>>['data']>;

const STATUS_FILTERS: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'SCHEDULED', label: 'Scheduled' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'NO_SHOW', label: 'No-Show' },
  { key: 'CANCELLED', label: 'Cancelled' },
];

const STATUS_STYLES: Record<string, string> = {
  SCHEDULED: 'bg-blue-500/10 text-blue-400 border border-blue-500/30',
  COMPLETED: 'bg-green-500/10 text-green-400 border border-green-500/30',
  NO_SHOW: 'bg-orange-500/10 text-orange-400 border border-orange-500/30',
  CANCELLED: 'bg-red-500/10 text-red-400 border border-red-500/30',
};

export default function AdminScreeningsPage() {
  const [screenings, setScreenings] = useState<Screening[]>([]);
  const [revenue, setRevenue] = useState<Revenue | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, r] = await Promise.all([
        api.listScreenings({ status: filter === 'all' ? undefined : filter }),
        api.getScreeningWeeklyRevenue().catch(() => ({ data: null })),
      ]);
      setScreenings((s.data as Screening[]) || []);
      setRevenue((r.data as Revenue | null) ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load screenings');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const fmtMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  return (
    <main className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Medical Screenings</h1>
        <p className="text-sm text-muted mt-0.5">
          Renewed Performance assessments. {screenings.length} screening{screenings.length === 1 ? '' : 's'} shown.
        </p>
      </div>

      {/* Weekly revenue */}
      {revenue && revenue.perLocation.length > 0 && (
        <div className="mb-6">
          <div className="text-xs uppercase tracking-wider text-muted mb-2">This Week's Revenue</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="ppl-card">
              <p className="text-xs text-muted font-medium">Total</p>
              <p className="text-2xl font-bold text-accent-text mt-1">{fmtMoney(revenue.totalCents)}</p>
              <p className="text-xs text-muted mt-0.5">
                {revenue.perLocation.reduce((s, l) => s + l.screeningsCompleted, 0)} completed
              </p>
            </div>
            {revenue.perLocation.map((loc) => (
              <div key={loc.locationId} className="ppl-card">
                <p className="text-xs text-muted font-medium">{loc.locationName}</p>
                <p className="text-2xl font-bold text-foreground mt-1">{fmtMoney(loc.totalCents)}</p>
                <p className="text-xs text-muted mt-0.5">{loc.screeningsCompleted} completed</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-1 mb-4 bg-surface rounded-lg p-1 w-fit">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              filter === f.key ? 'bg-highlight/20 text-accent-text' : 'text-muted hover:text-foreground'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((n) => <div key={n} className="ppl-card animate-pulse h-20" />)}
        </div>
      ) : screenings.length === 0 ? (
        <div className="ppl-card text-center py-12">
          <p className="text-muted text-sm">
            No screenings {filter === 'all' ? 'yet' : `in status ${filter}`}.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {screenings.map((s) => {
            const dt = new Date(s.scheduledAt);
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
                    <h3 className="font-semibold text-foreground text-sm">
                      {s.athlete.firstName} {s.athlete.lastName}
                    </h3>
                    <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full ${STATUS_STYLES[s.status] || ''}`}>
                      {s.status}
                    </span>
                    {s.athlete.ageGroup && (
                      <span className="text-[10px] uppercase text-muted bg-background rounded px-1.5 py-0.5">
                        {s.athlete.ageGroup}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted mt-0.5">
                    {dt.toLocaleDateString('en-US', { weekday: 'short' })}{' '}
                    {dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    {' · '}{s.location.name}
                    {s.provider && ` · ${s.provider.fullName}`}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold text-foreground">{fmtMoney(s.providerFeeCents)}</p>
                  <p className="text-[10px] text-muted">{s.durationMinutes}min</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
