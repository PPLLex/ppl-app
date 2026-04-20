'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';

interface RevenueDashboardData {
  totals: {
    totalWeeklyRevenueCents: number;
    totalMonthlyRevenueCents: number;
    pplWeeklyRevenueCents: number;
    pplMonthlyRevenueCents: number;
    activeMemberCount: number;
    pastDueCount: number;
    pastDueAmountCents: number;
    pendingFinesCount: number;
    pendingFinesCents: number;
  };
  revenueByLocation: Array<{
    locationId: string;
    locationName: string;
    activeMemberCount: number;
    pastDueCount: number;
    weeklyRevenueCents: number;
    monthlyRevenueCents: number;
    pastDueAmountCents: number;
  }>;
  youthRevenueByLocation: Array<{
    locationId: string;
    locationName: string;
    youthMemberCount: number;
    weeklyRevenueCents: number;
    monthlyRevenueCents: number;
  }>;
}

export default function RevenueDashboardPage() {
  const [data, setData] = useState<RevenueDashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadRevenue();
  }, []);

  async function loadRevenue() {
    try {
      const res = await api.request<RevenueDashboardData>('/revenue/dashboard');
      if (res.data) setData(res.data);
    } catch (err: any) {
      setError(err.message || 'Failed to load revenue data');
    } finally {
      setIsLoading(false);
    }
  }

  const fmt = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

  if (isLoading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-6">Revenue Dashboard</h1>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[1, 2, 3, 4].map((n) => <div key={n} className="ppl-card animate-pulse h-24" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-6">Revenue Dashboard</h1>
        <div className="ppl-card border-red-500/30">
          <p className="text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;
  const { totals, revenueByLocation, youthRevenueByLocation } = data;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Revenue Dashboard</h1>
          <p className="text-sm text-muted mt-0.5">Real-time revenue data from active memberships</p>
        </div>
        <Link href="/admin" className="text-sm text-ppl-light-green hover:underline">
          ← Back to Dashboard
        </Link>
      </div>

      {/* Top-Level Revenue Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="ppl-card">
          <p className="text-xs text-muted uppercase tracking-wide">Total Revenue</p>
          <p className="text-2xl font-bold text-ppl-light-green mt-1">{fmt(totals.totalWeeklyRevenueCents)}</p>
          <p className="text-xs text-muted">/week ({fmt(totals.totalMonthlyRevenueCents)}/mo)</p>
        </div>
        <div className="ppl-card">
          <p className="text-xs text-muted uppercase tracking-wide">PPL Revenue</p>
          <p className="text-2xl font-bold text-foreground mt-1">{fmt(totals.pplWeeklyRevenueCents)}</p>
          <p className="text-xs text-muted">/week ({fmt(totals.pplMonthlyRevenueCents)}/mo)</p>
        </div>
        <div className="ppl-card">
          <p className="text-xs text-muted uppercase tracking-wide">Active Members</p>
          <p className="text-2xl font-bold text-foreground mt-1">{totals.activeMemberCount}</p>
          <p className="text-xs text-muted">across all locations</p>
        </div>
        <div className="ppl-card">
          <p className="text-xs text-muted uppercase tracking-wide">Past Due</p>
          <p className={`text-2xl font-bold mt-1 ${totals.pastDueCount > 0 ? 'text-red-400' : 'text-foreground'}`}>
            {totals.pastDueCount}
          </p>
          <p className="text-xs text-muted">{fmt(totals.pastDueAmountCents)} at risk</p>
        </div>
      </div>

      {/* Revenue by Location */}
      <div className="ppl-card mb-6">
        <h2 className="text-lg font-bold text-foreground mb-4">Revenue by PPL Location</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-border">
                <th className="pb-2 pr-4">Location</th>
                <th className="pb-2 pr-4 text-right">Active</th>
                <th className="pb-2 pr-4 text-right">Weekly Rev</th>
                <th className="pb-2 pr-4 text-right">Monthly Rev</th>
                <th className="pb-2 pr-4 text-right">Past Due</th>
                <th className="pb-2 text-right">At Risk</th>
              </tr>
            </thead>
            <tbody>
              {revenueByLocation.map((loc) => (
                <tr key={loc.locationId} className="border-b border-border/50">
                  <td className="py-3 pr-4 font-medium text-foreground">{loc.locationName}</td>
                  <td className="py-3 pr-4 text-right text-foreground">{loc.activeMemberCount}</td>
                  <td className="py-3 pr-4 text-right text-ppl-light-green font-semibold">{fmt(loc.weeklyRevenueCents)}</td>
                  <td className="py-3 pr-4 text-right text-foreground">{fmt(loc.monthlyRevenueCents)}</td>
                  <td className="py-3 pr-4 text-right">
                    <span className={loc.pastDueCount > 0 ? 'text-red-400 font-semibold' : 'text-muted'}>
                      {loc.pastDueCount}
                    </span>
                  </td>
                  <td className="py-3 text-right text-muted">{fmt(loc.pastDueAmountCents)}</td>
                </tr>
              ))}
              {/* Totals row */}
              <tr className="font-bold">
                <td className="py-3 pr-4 text-foreground">Total</td>
                <td className="py-3 pr-4 text-right text-foreground">{totals.activeMemberCount}</td>
                <td className="py-3 pr-4 text-right text-ppl-light-green">{fmt(totals.totalWeeklyRevenueCents)}</td>
                <td className="py-3 pr-4 text-right text-foreground">{fmt(totals.totalMonthlyRevenueCents)}</td>
                <td className="py-3 pr-4 text-right text-red-400">{totals.pastDueCount}</td>
                <td className="py-3 text-right text-red-400">{fmt(totals.pastDueAmountCents)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Youth Revenue by Location */}
      <div className="ppl-card mb-6">
        <h2 className="text-lg font-bold text-foreground mb-4">Youth Revenue by Location</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-border">
                <th className="pb-2 pr-4">Location</th>
                <th className="pb-2 pr-4 text-right">Youth Members</th>
                <th className="pb-2 pr-4 text-right">Weekly Rev</th>
                <th className="pb-2 text-right">Monthly Rev</th>
              </tr>
            </thead>
            <tbody>
              {youthRevenueByLocation.map((loc) => (
                <tr key={loc.locationId} className="border-b border-border/50">
                  <td className="py-3 pr-4 font-medium text-foreground">{loc.locationName}</td>
                  <td className="py-3 pr-4 text-right text-foreground">{loc.youthMemberCount}</td>
                  <td className="py-3 pr-4 text-right text-ppl-light-green font-semibold">{fmt(loc.weeklyRevenueCents)}</td>
                  <td className="py-3 text-right text-foreground">{fmt(loc.monthlyRevenueCents)}</td>
                </tr>
              ))}
              {/* Totals */}
              <tr className="font-bold">
                <td className="py-3 pr-4 text-foreground">Total Youth</td>
                <td className="py-3 pr-4 text-right text-foreground">
                  {youthRevenueByLocation.reduce((s, l) => s + l.youthMemberCount, 0)}
                </td>
                <td className="py-3 pr-4 text-right text-ppl-light-green">
                  {fmt(youthRevenueByLocation.reduce((s, l) => s + l.weeklyRevenueCents, 0))}
                </td>
                <td className="py-3 text-right text-foreground">
                  {fmt(youthRevenueByLocation.reduce((s, l) => s + l.monthlyRevenueCents, 0))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Pending Fines */}
      {totals.pendingFinesCount > 0 && (
        <div className="ppl-card border-amber-500/20">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-foreground">Pending Attendance Fines</h3>
              <p className="text-sm text-muted">{totals.pendingFinesCount} violation(s) awaiting collection</p>
            </div>
            <p className="text-xl font-bold text-amber-400">{fmt(totals.pendingFinesCents)}</p>
          </div>
        </div>
      )}
    </div>
  );
}
