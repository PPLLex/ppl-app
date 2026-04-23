'use client';

/**
 * Admin › Finance
 *
 * One-stop page for the money side of PPL. Four tabs:
 *
 *   Revenue       — weekly + monthly revenue by location, Youth vs 13+
 *                   breakdown, per-org splits (PPL / HPL / Renewed Performance).
 *                   Data source: GET /api/revenue/dashboard (split-aware).
 *
 *   Settlements   — what PPL owes HPL and Renewed Performance THIS WEEK
 *                   based on active-membership revenue splits. Once HPL
 *                   app ships, the reciprocal "what HPL owes PPL" will be
 *                   pulled from HPL's equivalent endpoint.
 *
 *   Hours         — employee hour tracking (coming next batch). The data
 *                   model (TimeEntry rows per staff per location) will
 *                   land once Chad confirms check-in/out flow.
 *
 *   Payroll       — employee salary + payment tracker (coming next batch).
 *                   Will aggregate Hours × hourly rate + fixed salaries.
 *
 * Week boundary is configurable via OrgSettings.financeWeekStartDay (1=Mon)
 * and OrgSettings.financeWeekReset{Day,Hour} — see the "Reporting Period"
 * panel at the bottom of the Revenue tab.
 */

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

// ───────────────────────────────── Types ─────────────────────────────────

interface LocationRow {
  locationId: string;
  locationName: string;
  activeMemberCount: number;
  youthMemberCount: number;
  thirteenPlusMemberCount: number;
  pastDueCount: number;
  weeklyRevenueCents: number;
  monthlyRevenueCents: number;
  pastDueAmountCents: number;
  pplWeeklyRevenueCents: number;
  hplWeeklyRevenueCents: number;
  renewedPerformanceWeeklyRevenueCents: number;
}

interface AgeBucketRow {
  locationId: string;
  locationName: string;
  memberCount?: number;
  youthMemberCount?: number;
  weeklyRevenueCents: number;
  monthlyRevenueCents: number;
}

interface FinanceDashboardData {
  totals: {
    totalWeeklyRevenueCents: number;
    totalMonthlyRevenueCents: number;
    pplWeeklyRevenueCents: number;
    pplMonthlyRevenueCents: number;
    hplWeeklyRevenueCents: number;
    renewedPerformanceWeeklyRevenueCents: number;
    activeMemberCount: number;
    youthMemberCount: number;
    thirteenPlusMemberCount: number;
    pastDueCount: number;
    pastDueAmountCents: number;
    pendingFinesCount: number;
    pendingFinesCents: number;
  };
  revenueByLocation: LocationRow[];
  youthRevenueByLocation: AgeBucketRow[];
  thirteenPlusRevenueByLocation: AgeBucketRow[];
  interBusinessSettlements: {
    owedToHplCents: number;
    owedToRenewedPerformanceCents: number;
  };
}

interface BrandingSettings {
  financeWeekStartDay?: number;
  financeWeekResetDay?: number;
  financeWeekResetHour?: number;
}

type Tab = 'revenue' | 'settlements' | 'hours' | 'payroll';

const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// ────────────────────────────── Formatters ───────────────────────────────

const fmt = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtShort = (cents: number) => `$${Math.round(cents / 100).toLocaleString('en-US')}`;
const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

function formatHour(h: number): string {
  if (h === 0) return '12 AM';
  if (h === 12) return '12 PM';
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

// ─────────────────────────────── Component ───────────────────────────────

export default function FinancePage() {
  const [tab, setTab] = useState<Tab>('revenue');
  const [data, setData] = useState<FinanceDashboardData | null>(null);
  const [branding, setBranding] = useState<BrandingSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingWeek, setIsSavingWeek] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState(1);
  const [weekResetDay, setWeekResetDay] = useState(1);
  const [weekResetHour, setWeekResetHour] = useState(5);

  useEffect(() => {
    (async () => {
      try {
        const [rev, brand] = await Promise.allSettled([
          api.request<FinanceDashboardData>('/revenue/dashboard'),
          api.request<BrandingSettings>('/settings/branding'),
        ]);
        if (rev.status === 'fulfilled' && rev.value.data) setData(rev.value.data);
        if (brand.status === 'fulfilled' && brand.value.data) {
          setBranding(brand.value.data);
          setWeekStart(brand.value.data.financeWeekStartDay ?? 1);
          setWeekResetDay(brand.value.data.financeWeekResetDay ?? 1);
          setWeekResetHour(brand.value.data.financeWeekResetHour ?? 5);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load finance data');
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  async function saveWeekConfig() {
    setIsSavingWeek(true);
    try {
      await api.request('/settings/branding', {
        method: 'PUT',
        body: JSON.stringify({
          financeWeekStartDay: weekStart,
          financeWeekResetDay: weekResetDay,
          financeWeekResetHour: weekResetHour,
        }),
      });
      setBranding({
        financeWeekStartDay: weekStart,
        financeWeekResetDay: weekResetDay,
        financeWeekResetHour: weekResetHour,
      });
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsSavingWeek(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="ppl-card animate-pulse h-28" />
        <div className="ppl-card animate-pulse h-64" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="ppl-card p-4 text-danger">{error ?? 'Unable to load finance data.'}</div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ─── PAGE HEADER ─── */}
      <div>
        <h1 className="font-display text-2xl uppercase tracking-[0.04em] text-foreground">Finance</h1>
        <p className="text-sm text-muted mt-1">
          Revenue, inter-business settlements, employee hours, and payroll — all in one place.
        </p>
      </div>

      {/* ─── TAB NAV ─── */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {(
          [
            { id: 'revenue', label: 'Revenue' },
            { id: 'settlements', label: 'Settlements' },
            { id: 'hours', label: 'Hours' },
            { id: 'payroll', label: 'Payroll' },
          ] as Array<{ id: Tab; label: string }>
        ).map((t) => {
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${
                isActive
                  ? 'border-highlight text-foreground'
                  : 'border-transparent text-muted hover:text-foreground'
              }`}
              aria-pressed={isActive}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ─────────────────────── REVENUE TAB ─────────────────────── */}
      {tab === 'revenue' && (
        <div className="space-y-6">
          {/* KPI row — Bebas Neue on the big numbers for PPL pitching-report feel */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Weekly Revenue" value={fmtShort(data.totals.totalWeeklyRevenueCents)} />
            <StatCard label="Active Members" value={String(data.totals.activeMemberCount)} />
            <StatCard
              label="PPL Share / Week"
              value={fmtShort(data.totals.pplWeeklyRevenueCents)}
              accent
            />
            <StatCard
              label="Owed to HPL / Week"
              value={fmtShort(data.totals.hplWeeklyRevenueCents)}
              tone="muted"
            />
          </div>

          {/* Youth vs 13+ split summary */}
          <div className="ppl-card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-lg">
                Membership Mix
              </h2>
              <div className="text-xs text-muted">
                Pitching-only = 100% PPL · Combo plans carry an HPL slice.
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <BucketCard
                label="Youth (12 & under)"
                count={data.totals.youthMemberCount}
                total={data.totals.activeMemberCount}
              />
              <BucketCard
                label="13+ (MS/HS, College, Pro)"
                count={data.totals.thirteenPlusMemberCount}
                total={data.totals.activeMemberCount}
              />
            </div>
          </div>

          {/* By-location table */}
          <div className="ppl-card p-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-lg">
                Revenue by Location
              </h2>
              <span className="text-[11px] text-muted">weekly</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-muted border-b border-border">
                    <th className="px-4 py-2 font-medium">Location</th>
                    <th className="px-4 py-2 font-medium text-right">Active</th>
                    <th className="px-4 py-2 font-medium text-right">Youth</th>
                    <th className="px-4 py-2 font-medium text-right">13+</th>
                    <th className="px-4 py-2 font-medium text-right">Weekly $</th>
                    <th className="px-4 py-2 font-medium text-right">PPL Share</th>
                    <th className="px-4 py-2 font-medium text-right">HPL Share</th>
                  </tr>
                </thead>
                <tbody>
                  {data.revenueByLocation.map((loc) => (
                    <tr key={loc.locationId} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2.5 font-medium text-foreground">{loc.locationName}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{loc.activeMemberCount}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted">
                        {loc.youthMemberCount}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted">
                        {loc.thirteenPlusMemberCount}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {fmt(loc.weeklyRevenueCents)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-accent-text">
                        {fmt(loc.pplWeeklyRevenueCents)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted">
                        {fmt(loc.hplWeeklyRevenueCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Reporting Period config */}
          <div className="ppl-card">
            <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-lg mb-3">
              Reporting Period
            </h2>
            <p className="text-xs text-muted mb-4">
              Each weekly report covers your chosen start day through the day before. The reset
              time determines when the previous week closes and a new snapshot begins.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Week starts on">
                <select
                  value={weekStart}
                  onChange={(e) => setWeekStart(parseInt(e.target.value))}
                  className="ppl-input"
                >
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                    <option key={d} value={d}>
                      {DAY_NAMES[d]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Reset day">
                <select
                  value={weekResetDay}
                  onChange={(e) => setWeekResetDay(parseInt(e.target.value))}
                  className="ppl-input"
                >
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                    <option key={d} value={d}>
                      {DAY_NAMES[d]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Reset time">
                <select
                  value={weekResetHour}
                  onChange={(e) => setWeekResetHour(parseInt(e.target.value))}
                  className="ppl-input"
                >
                  {Array.from({ length: 24 }).map((_, h) => (
                    <option key={h} value={h}>
                      {formatHour(h)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="mt-3 text-xs text-muted">
              Current window:{' '}
              <strong className="text-foreground">
                {DAY_NAMES[branding?.financeWeekStartDay ?? 1]} →{' '}
                {DAY_NAMES[((branding?.financeWeekStartDay ?? 1) + 5) % 7 + 1] || 'Sunday'}
              </strong>
              , snapshot {DAY_NAMES[branding?.financeWeekResetDay ?? 1]}{' '}
              {formatHour(branding?.financeWeekResetHour ?? 5)}.
            </div>
            <button
              type="button"
              onClick={saveWeekConfig}
              disabled={isSavingWeek}
              className="ppl-btn ppl-btn-primary mt-4"
            >
              {isSavingWeek ? 'Saving…' : 'Save Reporting Period'}
            </button>
          </div>
        </div>
      )}

      {/* ─────────────────────── SETTLEMENTS TAB ─────────────────────── */}
      {tab === 'settlements' && (
        <div className="space-y-5">
          <div className="ppl-card">
            <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-lg mb-2">
              This Week — You Owe
            </h2>
            <p className="text-xs text-muted mb-4">
              Calculated from active combo-plan memberships using each plan&apos;s revenue split.
              Final amounts snapshot when the week closes.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <SettlementCard
                label="Owed to HPL"
                cents={data.interBusinessSettlements.owedToHplCents}
                subtext="Hitting portion of combo plans."
              />
              <SettlementCard
                label="Owed to Renewed Performance"
                cents={data.interBusinessSettlements.owedToRenewedPerformanceCents}
                subtext="PT / movement assessment revenue. No combo plans wired yet."
              />
            </div>
          </div>

          <div className="ppl-card">
            <h3 className="font-display uppercase tracking-[0.04em] text-foreground text-base mb-3">
              Coming next batch
            </h3>
            <ul className="text-sm text-muted space-y-1.5 list-disc list-inside">
              <li>Historical weekly settlement rows (auto-snapshot on your chosen reset day).</li>
              <li>Reciprocal view: what HPL owes PPL (once HPL app is live).</li>
              <li>Export CSV per week for the books.</li>
              <li>Stripe Connect payout automation (long-term option).</li>
            </ul>
          </div>
        </div>
      )}

      {/* ─────────────────────── HOURS TAB (stub) ─────────────────────── */}
      {tab === 'hours' && (
        <div className="ppl-card">
          <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-lg mb-2">
            Employee Hour Tracking
          </h2>
          <p className="text-sm text-muted">
            Coming next batch. Staff will check in / out per shift, and this page will show
            this-week hours per employee per location, with totals for payroll rollup.
          </p>
          <ul className="mt-4 text-sm text-muted space-y-1.5 list-disc list-inside">
            <li>Per-shift check-in flow (Staff app + kiosk fallback).</li>
            <li>Overtime detection (&gt;40 hrs/week).</li>
            <li>Manager-approved edits with audit log.</li>
            <li>CSV export.</li>
          </ul>
        </div>
      )}

      {/* ─────────────────────── PAYROLL TAB (stub) ─────────────────────── */}
      {tab === 'payroll' && (
        <div className="ppl-card">
          <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-lg mb-2">
            Salary & Payment Tracker
          </h2>
          <p className="text-sm text-muted">
            Coming next batch. Each staff member carries a pay config (hourly or salaried);
            this page will compute this-week total owed and track payments marked as sent.
          </p>
          <ul className="mt-4 text-sm text-muted space-y-1.5 list-disc list-inside">
            <li>Per-employee rate config (hourly × hours OR fixed weekly salary).</li>
            <li>Bonus / commission line items.</li>
            <li>Running YTD totals for 1099s.</li>
            <li>Mark paid → audit log + optional ACH export.</li>
          </ul>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────── Reusable pieces ────────────────────────────

function StatCard({
  label,
  value,
  accent,
  tone,
}: {
  label: string;
  value: string;
  accent?: boolean;
  tone?: 'muted';
}) {
  return (
    <div className="ppl-card">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted">{label}</div>
      <div
        className={`font-stat text-4xl leading-none mt-2 tabular-nums ${
          accent ? 'text-accent-text' : tone === 'muted' ? 'text-muted' : 'text-foreground'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function BucketCard({
  label,
  count,
  total,
}: {
  label: string;
  count: number;
  total: number;
}) {
  const percent = pct(count, total);
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className="flex items-baseline gap-2 mt-1.5">
        <span className="font-stat text-3xl leading-none tabular-nums text-foreground">{count}</span>
        <span className="text-xs text-muted">{percent}% of active</span>
      </div>
      <div className="mt-2 h-1 rounded-full bg-border overflow-hidden">
        <div
          className="h-full bg-highlight transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function SettlementCard({
  label,
  cents,
  subtext,
}: {
  label: string;
  cents: number;
  subtext: string;
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className="font-stat text-4xl leading-none tabular-nums mt-2 text-foreground">
        {fmt(cents)}
      </div>
      <p className="text-xs text-muted mt-2">{subtext}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="ppl-label">{label}</span>
      {children}
    </label>
  );
}
