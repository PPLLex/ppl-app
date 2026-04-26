'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, RevenueStats, BookingStats, MemberStats } from '@/lib/api';

type ReportTab = 'revenue' | 'bookings' | 'members' | 'staff' | 'leadSource' | 'funnel';
type Period = '7d' | '30d' | '90d' | '1y';

export default function AdminReportsPage() {
  const [activeTab, setActiveTab] = useState<ReportTab>('revenue');
  const [period, setPeriod] = useState<Period>('30d');

  const tabs: { key: ReportTab; label: string }[] = [
    { key: 'revenue', label: 'Revenue' },
    { key: 'bookings', label: 'Bookings' },
    { key: 'members', label: 'Members' },
    { key: 'staff', label: 'Staff Performance' },
    { key: 'leadSource', label: 'Lead Source ROI' },
    { key: 'funnel', label: 'Funnel' },
  ];

  const periods: { key: Period; label: string }[] = [
    { key: '7d', label: '7 Days' },
    { key: '30d', label: '30 Days' },
    { key: '90d', label: '90 Days' },
    { key: '1y', label: '1 Year' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Reports</h1>
          <p className="text-sm text-muted mt-0.5">Business analytics and insights</p>
        </div>
        {/* Period Selector */}
        <div className="flex gap-1 bg-surface rounded-lg p-1">
          {periods.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                period === p.key
                  ? 'bg-highlight/20 text-accent-text'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-surface rounded-lg p-1 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              activeTab === tab.key
                ? 'bg-highlight/20 text-accent-text'
                : 'text-muted hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'revenue' && <RevenueReport period={period} />}
      {activeTab === 'bookings' && <BookingsReport period={period} />}
      {activeTab === 'members' && <MembersReport />}
      {activeTab === 'staff' && <StaffPerformanceReport period={period} />}
      {activeTab === 'leadSource' && <LeadSourceReport period={period} />}
      {activeTab === 'funnel' && <FunnelReport period={period} />}
    </div>
  );
}

/* ─── Lead Source ROI Report ─── */
function LeadSourceReport({ period }: { period: Period }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getLeadSourceRoi>>['data'] | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.getLeadSourceRoi({ period });
      setData(res.data ?? null);
    } finally {
      setIsLoading(false);
    }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  if (isLoading) return <div className="ppl-card animate-pulse h-48" />;
  if (!data || data.sources.length === 0) {
    return <div className="ppl-card text-center py-12"><p className="text-muted">No lead activity in this period.</p></div>;
  }
  const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const fmtDays = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)} days`);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <StatCard label="Total Leads" value={String(data.totals.leads)} />
        <StatCard label="Converted" value={String(data.totals.converted)} accent />
        <StatCard label="Lost" value={String(data.totals.lost)} />
        <StatCard label="In Progress" value={String(data.totals.inProgress)} />
      </div>

      <div className="ppl-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-border">
                <th className="px-3 py-2 font-semibold text-foreground">Source</th>
                <th className="px-3 py-2 font-semibold text-foreground text-right">Leads</th>
                <th className="px-3 py-2 font-semibold text-foreground text-right">Won</th>
                <th className="px-3 py-2 font-semibold text-foreground text-right">Lost</th>
                <th className="px-3 py-2 font-semibold text-foreground text-right">In Progress</th>
                <th className="px-3 py-2 font-semibold text-foreground text-right">Conversion</th>
                <th className="px-3 py-2 font-semibold text-foreground text-right">Avg Days</th>
              </tr>
            </thead>
            <tbody>
              {data.sources.map((s) => (
                <tr key={s.source} className="border-b border-border last:border-0">
                  <td className="px-3 py-2.5 text-foreground">{s.source}</td>
                  <td className="px-3 py-2.5 text-right text-foreground">{s.total}</td>
                  <td className="px-3 py-2.5 text-right text-accent-text">{s.converted}</td>
                  <td className="px-3 py-2.5 text-right text-muted">{s.lost}</td>
                  <td className="px-3 py-2.5 text-right text-muted">{s.inProgress}</td>
                  <td className="px-3 py-2.5 text-right">
                    <span className={s.conversionRate >= 0.2 ? 'text-accent-text' : 'text-foreground'}>
                      {fmtPct(s.conversionRate)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-muted">{fmtDays(s.avgDaysToConvert)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── Funnel Conversion Report ─── */
function FunnelReport({ period }: { period: Period }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getFunnelConversion>>['data'] | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.getFunnelConversion({ period });
      setData(res.data ?? null);
    } finally {
      setIsLoading(false);
    }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  if (isLoading) return <div className="ppl-card animate-pulse h-64" />;
  if (!data || data.stages.length === 0) {
    return <div className="ppl-card text-center py-12"><p className="text-muted">No leads in this period.</p></div>;
  }

  const top = data.stages[0]?.count ?? 1;
  const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Total Leads" value={String(data.totalLeads)} />
        <StatCard label="Closed Won" value={String(data.stages.find(s => s.stage === 'CLOSED_WON')?.count ?? 0)} accent />
        <StatCard label="Overall Conversion" value={fmtPct(data.overallConversion)} />
      </div>

      <div className="ppl-card">
        <p className="text-xs font-semibold text-foreground uppercase tracking-wider mb-3">Funnel</p>
        <div className="space-y-2">
          {data.stages.map((s, i) => {
            const widthPct = top > 0 ? (s.count / top) * 100 : 0;
            return (
              <div key={s.stage} className="flex items-center gap-3">
                <div className="w-44 text-xs text-foreground font-medium truncate">{s.stage.replace(/_/g, ' ')}</div>
                <div className="flex-1 h-7 bg-background rounded-md overflow-hidden relative">
                  <div className="h-full bg-highlight/60 transition-all" style={{ width: `${Math.max(widthPct, 1)}%` }} />
                  <span className="absolute inset-0 flex items-center px-3 text-xs text-foreground font-semibold">
                    {s.count}
                  </span>
                </div>
                {i > 0 && (
                  <div className={`w-20 text-right text-xs ${s.conversionFromPrev >= 0.5 ? 'text-accent-text' : s.conversionFromPrev >= 0.2 ? 'text-muted' : 'text-red-400'}`}>
                    {fmtPct(s.conversionFromPrev)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-muted mt-3">
          Bar width = lead count at that stage (or beyond). Right column = % that progressed from the prior stage.
          Look for the biggest drop — that's where to focus.
        </p>
      </div>

      {data.closedLost > 0 && (
        <div className="ppl-card">
          <p className="text-xs text-muted">
            <span className="text-red-400 font-semibold">{data.closedLost}</span> lead{data.closedLost === 1 ? '' : 's'} marked Closed-Lost in this period — review their lostReason field on individual leads to find the common theme.
          </p>
        </div>
      )}
    </div>
  );
}

/* ─── Staff Performance Report ─── */
function StaffPerformanceReport({ period }: { period: Period }) {
  const [data, setData] = useState<{
    coaches: Array<{
      coachId: string;
      coachName: string;
      coachEmail: string;
      sessionsLed: number;
      sessionsLast30: number;
      athletesCoached: number;
      confirmed: number;
      completed: number;
      noShow: number;
      cancelled: number;
      completionRate: number | null;
      noShowRate: number | null;
    }>;
    totals: { coaches: number; sessionsLed: number; athletesCoached: number };
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.getStaffPerformance({ period });
      setData(res.data ?? null);
    } finally {
      setIsLoading(false);
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  if (isLoading) {
    return <div className="ppl-card animate-pulse h-48" />;
  }
  if (!data || data.coaches.length === 0) {
    return (
      <div className="ppl-card text-center py-12">
        <p className="text-muted">No coach activity in this period.</p>
      </div>
    );
  }

  const fmtPct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(0)}%`);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Active Coaches" value={String(data.totals.coaches)} />
        <StatCard label="Sessions Led" value={String(data.totals.sessionsLed)} />
        <StatCard label="Athletes Coached" value={String(data.totals.athletesCoached)} accent />
      </div>

      <div className="ppl-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-border">
                <th className="px-3 py-2 font-semibold text-foreground">Coach</th>
                <th className="px-3 py-2 font-semibold text-foreground text-right">Sessions</th>
                <th className="px-3 py-2 font-semibold text-foreground text-right">Last 30d</th>
                <th className="px-3 py-2 font-semibold text-foreground text-right">Athletes</th>
                <th className="px-3 py-2 font-semibold text-foreground text-right">Completion</th>
                <th className="px-3 py-2 font-semibold text-foreground text-right">No-Show</th>
              </tr>
            </thead>
            <tbody>
              {data.coaches.map((c) => (
                <tr key={c.coachId} className="border-b border-border last:border-0">
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-foreground">{c.coachName}</div>
                    <div className="text-xs text-muted truncate">{c.coachEmail}</div>
                  </td>
                  <td className="px-3 py-2.5 text-right text-foreground">{c.sessionsLed}</td>
                  <td className="px-3 py-2.5 text-right text-muted">{c.sessionsLast30}</td>
                  <td className="px-3 py-2.5 text-right text-foreground">{c.athletesCoached}</td>
                  <td className="px-3 py-2.5 text-right">
                    <span className={c.completionRate != null && c.completionRate >= 0.9 ? 'text-accent-text' : 'text-foreground'}>
                      {fmtPct(c.completionRate)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className={c.noShowRate != null && c.noShowRate > 0.15 ? 'text-red-400' : 'text-muted'}>
                      {fmtPct(c.noShowRate)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11px] text-muted">
        Completion + no-show rates are calculated from sessions where attendance was marked
        (completed + no-show), excluding cancelled and still-pending bookings.
      </p>
    </div>
  );
}

/* ─── Stat Card Component ─── */
function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="ppl-card">
      <p className="text-xs text-muted font-medium">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${accent ? 'text-accent-text' : 'text-foreground'}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-muted mt-0.5">{sub}</p>}
    </div>
  );
}

/* ─── Bar Chart (Simple CSS) ─── */
function BarChart({ data, labelKey, valueKey, maxHeight = 120 }: {
  data: Record<string, any>[];
  labelKey: string;
  valueKey: string;
  maxHeight?: number;
}) {
  const maxVal = Math.max(...data.map((d) => d[valueKey]), 1);
  return (
    <div className="flex items-end gap-1.5" style={{ height: maxHeight }}>
      {data.map((item, i) => {
        const height = (item[valueKey] / maxVal) * maxHeight;
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <span className="text-xs text-muted">{item[valueKey]}</span>
            <div
              className="w-full rounded-t-md bg-highlight/60 hover:bg-accent/60 transition min-h-[2px]"
              style={{ height: Math.max(height, 2) }}
            />
            <span className="text-xs text-muted truncate w-full text-center">{item[labelKey]}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Revenue Report ─── */
function RevenueReport({ period }: { period: Period }) {
  const [stats, setStats] = useState<RevenueStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.getRevenueStats({ period });
      if (res.data) setStats(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  if (isLoading || !stats) {
    return <div className="grid grid-cols-4 gap-4">{[1,2,3,4].map(n => <div key={n} className="ppl-card animate-pulse h-24" />)}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Total Revenue (All Time)" value={`$${stats.totalRevenue.toLocaleString()}`} accent />
        <StatCard label={`Revenue (${period})`} value={`$${stats.periodRevenue.toLocaleString()}`} />
        <StatCard label="Avg per Member" value={`$${stats.averagePerMember.toFixed(0)}`} sub="per period" />
        <StatCard label="Past Due Amount" value={`$${stats.pastDueAmount.toLocaleString()}`} sub="at risk" />
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Revenue by Plan */}
        <div className="ppl-card">
          <h3 className="text-sm font-bold text-foreground mb-4">Revenue by Plan</h3>
          {stats.revenueByPlan.length > 0 ? (
            <div className="space-y-3">
              {stats.revenueByPlan.map((item) => (
                <div key={item.plan} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">{item.plan}</p>
                    <p className="text-xs text-muted">{item.members} member{item.members !== 1 ? 's' : ''}</p>
                  </div>
                  <p className="text-sm font-bold text-accent-text">${item.revenue.toLocaleString()}/wk</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted text-center py-4">No data yet</p>
          )}
        </div>

        {/* Revenue by Month */}
        <div className="ppl-card">
          <h3 className="text-sm font-bold text-foreground mb-4">Monthly Revenue Trend</h3>
          {stats.revenueByMonth.length > 0 ? (
            <BarChart
              data={stats.revenueByMonth.map((m) => ({
                label: new Date(m.month + '-01').toLocaleDateString('en-US', { month: 'short' }),
                value: m.revenue,
              }))}
              labelKey="label"
              valueKey="value"
            />
          ) : (
            <p className="text-sm text-muted text-center py-4">No data yet</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Bookings Report ─── */
function BookingsReport({ period }: { period: Period }) {
  const [stats, setStats] = useState<BookingStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.getBookingStats({ period });
      if (res.data) setStats(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  if (isLoading || !stats) {
    return <div className="grid grid-cols-4 gap-4">{[1,2,3,4].map(n => <div key={n} className="ppl-card animate-pulse h-24" />)}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Total Bookings" value={stats.totalBookings.toLocaleString()} accent />
        <StatCard label={`Bookings (${period})`} value={stats.periodBookings.toLocaleString()} />
        <StatCard label="Avg per Session" value={stats.averagePerSession.toFixed(1)} sub="athletes" />
        <StatCard label="Utilization Rate" value={`${stats.utilizationRate}%`} sub="capacity filled" />
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* By Day of Week */}
        <div className="ppl-card">
          <h3 className="text-sm font-bold text-foreground mb-4">Bookings by Day</h3>
          <BarChart data={stats.bookingsByDay} labelKey="day" valueKey="count" />
        </div>

        {/* By Session Type */}
        <div className="ppl-card">
          <h3 className="text-sm font-bold text-foreground mb-4">By Session Type</h3>
          {stats.bookingsByType.length > 0 ? (
            <div className="space-y-3">
              {stats.bookingsByType.map((item) => {
                const total = stats.bookingsByType.reduce((sum, t) => sum + t.count, 0);
                const pct = total > 0 ? (item.count / total) * 100 : 0;
                return (
                  <div key={item.type}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-foreground capitalize">{item.type.replace(/_/g, ' ')}</span>
                      <span className="text-sm font-medium text-foreground">{item.count}</span>
                    </div>
                    <div className="h-2 bg-surface rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted text-center py-4">No data yet</p>
          )}
        </div>
      </div>

      {/* Popular Times */}
      {stats.popularTimes.length > 0 && (
        <div className="ppl-card">
          <h3 className="text-sm font-bold text-foreground mb-4">Popular Training Times</h3>
          <BarChart
            data={stats.popularTimes.map((t) => ({
              label: `${t.hour % 12 || 12}${t.hour < 12 ? 'a' : 'p'}`,
              value: t.count,
            }))}
            labelKey="label"
            valueKey="value"
            maxHeight={80}
          />
        </div>
      )}
    </div>
  );
}

/* ─── Members Report ─── */
function MembersReport() {
  const [stats, setStats] = useState<MemberStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.getMemberStats();
        if (res.data) setStats(res.data);
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  if (isLoading || !stats) {
    return <div className="grid grid-cols-4 gap-4">{[1,2,3,4].map(n => <div key={n} className="ppl-card animate-pulse h-24" />)}</div>;
  }

  const AGE_LABELS: Record<string, string> = {
    college: 'College',
    ms_hs: '13+ (Middle School, High School, College, and Pro)',
    youth: 'Youth',
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Active Members" value={stats.totalActive.toString()} accent />
        <StatCard label="Inactive" value={stats.totalInactive.toString()} />
        <StatCard label="New This Month" value={stats.newThisMonth.toString()} />
        <StatCard label="Churn Rate (30d)" value={`${stats.churnRate}%`} sub="monthly" />
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* By Age Group */}
        <div className="ppl-card">
          <h3 className="text-sm font-bold text-foreground mb-4">By Age Group</h3>
          {stats.byAgeGroup.length > 0 ? (
            <div className="space-y-3">
              {stats.byAgeGroup.map((g) => (
                <div key={g.ageGroup} className="flex items-center justify-between">
                  <span className="text-sm text-foreground">{AGE_LABELS[g.ageGroup] || g.ageGroup}</span>
                  <span className="text-sm font-bold text-foreground">{g.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted text-center py-4">No data</p>
          )}
        </div>

        {/* By Plan */}
        <div className="ppl-card">
          <h3 className="text-sm font-bold text-foreground mb-4">By Plan</h3>
          {stats.byPlan.length > 0 ? (
            <div className="space-y-3">
              {stats.byPlan.map((p) => (
                <div key={p.plan} className="flex items-center justify-between">
                  <span className="text-sm text-foreground">{p.plan}</span>
                  <span className="text-sm font-bold text-foreground">{p.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted text-center py-4">No data</p>
          )}
        </div>

        {/* By Location */}
        <div className="ppl-card">
          <h3 className="text-sm font-bold text-foreground mb-4">By Location</h3>
          {stats.byLocation.length > 0 ? (
            <div className="space-y-3">
              {stats.byLocation.map((l) => (
                <div key={l.location} className="flex items-center justify-between">
                  <span className="text-sm text-foreground">{l.location}</span>
                  <span className="text-sm font-bold text-foreground">{l.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted text-center py-4">No data</p>
          )}
        </div>
      </div>
    </div>
  );
}
