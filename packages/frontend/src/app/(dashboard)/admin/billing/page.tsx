'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  api,
  MembershipWithClient,
  CardChangeRequestWithClient,
  MembershipStats,
  Location,
} from '@/lib/api';

const STATUS_BADGES: Record<string, string> = {
  ACTIVE: 'ppl-badge-active',
  PAST_DUE: 'ppl-badge-danger',
  SUSPENDED: 'ppl-badge-warning',
  CANCELLED: 'bg-surface text-muted',
};

export default function AdminBillingPage() {
  const [tab, setTab] = useState<'overview' | 'members' | 'pastdue' | 'requests'>('overview');
  const [stats, setStats] = useState<MembershipStats | null>(null);
  const [memberships, setMemberships] = useState<MembershipWithClient[]>([]);
  const [pastDue, setPastDue] = useState<MembershipWithClient[]>([]);
  const [cancelRequests, setCancelRequests] = useState<MembershipWithClient[]>([]);
  const [cardRequests, setCardRequests] = useState<CardChangeRequestWithClient[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [statsRes, locationsRes] = await Promise.all([
        api.getMembershipStats(),
        api.getLocations(),
      ]);
      if (statsRes.data) setStats(statsRes.data);
      if (locationsRes.data) setLocations(locationsRes.data);
    } catch (err) {
      console.error('Failed to load billing data:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadMembers = useCallback(async () => {
    try {
      const res = await api.getMemberships({
        status: filterStatus || undefined,
        locationId: filterLocation || undefined,
      });
      if (res.data) setMemberships(res.data);
    } catch (err) {
      console.error('Failed to load memberships:', err);
    }
  }, [filterStatus, filterLocation]);

  const loadPastDue = useCallback(async () => {
    try {
      const res = await api.getPastDueMemberships();
      if (res.data) setPastDue(res.data);
    } catch (err) {
      console.error('Failed to load past due:', err);
    }
  }, []);

  const loadRequests = useCallback(async () => {
    try {
      const [cancelRes, cardRes] = await Promise.all([
        api.getCancelRequests(),
        api.getCardChangeRequests(),
      ]);
      if (cancelRes.data) setCancelRequests(cancelRes.data);
      if (cardRes.data) setCardRequests(cardRes.data);
    } catch (err) {
      console.error('Failed to load requests:', err);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (tab === 'members') loadMembers();
    if (tab === 'pastdue') loadPastDue();
    if (tab === 'requests') loadRequests();
  }, [tab, loadMembers, loadPastDue, loadRequests]);

  const handleRetryPayment = async (membershipId: string) => {
    setActionInProgress(membershipId);
    try {
      const res = await api.adminRetryPayment(membershipId);
      setMessage({
        type: res.success ? 'success' : 'error',
        text: res.message || 'Payment retry processed.',
      });
      await loadPastDue();
      await loadData();
    } catch (err: unknown) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Retry failed' });
    } finally {
      setActionInProgress(null);
    }
  };

  const handleCancelMembership = async (membershipId: string, clientName: string) => {
    if (!confirm(`Cancel ${clientName}'s membership? They'll retain access until end of billing period.`)) return;
    setActionInProgress(membershipId);
    try {
      await api.adminCancelMembership(membershipId);
      setMessage({ type: 'success', text: `${clientName}'s membership has been cancelled.` });
      await loadRequests();
      await loadData();
    } catch (err: unknown) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Cancellation failed' });
    } finally {
      setActionInProgress(null);
    }
  };

  const handleSendCardLink = async (requestId: string) => {
    setActionInProgress(requestId);
    try {
      const res = await api.sendCardUpdateLink(requestId);
      setMessage({ type: 'success', text: res.message || 'Card update link sent.' });
      await loadRequests();
    } catch (err: unknown) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to send link' });
    } finally {
      setActionInProgress(null);
    }
  };

  const formatPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Billing & Memberships</h1>
        <p className="text-muted text-sm mt-1">Manage member payments, plans, and requests</p>
      </div>

      {/* Message */}
      {message && (
        <div
          className={`mb-4 p-3 rounded-lg text-sm ${
            message.type === 'success'
              ? 'bg-ppl-dark-green/10 border border-ppl-dark-green/20 text-ppl-light-green'
              : 'bg-danger/10 border border-danger/20 text-danger'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-surface rounded-lg p-1">
        {[
          { key: 'overview', label: 'Overview' },
          { key: 'members', label: 'All Members' },
          { key: 'pastdue', label: `Past Due${stats?.pastDueMemberships ? ` (${stats.pastDueMemberships})` : ''}` },
          { key: 'requests', label: `Requests${stats ? ` (${stats.pendingCancelRequests + stats.pendingCardChangeRequests})` : ''}` },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key as typeof tab)}
            className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === key
                ? 'ppl-gradient text-white'
                : 'text-muted hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {tab === 'overview' && (
        <div>
          {isLoading ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((n) => (
                <div key={n} className="ppl-card animate-pulse h-24" />
              ))}
            </div>
          ) : stats ? (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <StatCard label="Active Members" value={stats.activeMemberships} color="text-ppl-light-green" />
                <StatCard label="Past Due" value={stats.pastDueMemberships} color="text-danger" />
                <StatCard label="Total Revenue" value={formatPrice(stats.totalRevenueCents)} color="text-ppl-light-green" />
                <StatCard label="Cancelled" value={stats.cancelledMemberships} color="text-muted" />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="ppl-card">
                  <h3 className="font-semibold text-foreground mb-3">Pending Actions</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center p-2 bg-surface rounded-lg">
                      <span className="text-sm text-foreground">Cancel Requests</span>
                      <span className={`text-sm font-bold ${stats.pendingCancelRequests > 0 ? 'text-amber-400' : 'text-muted'}`}>
                        {stats.pendingCancelRequests}
                      </span>
                    </div>
                    <div className="flex justify-between items-center p-2 bg-surface rounded-lg">
                      <span className="text-sm text-foreground">Card Change Requests</span>
                      <span className={`text-sm font-bold ${stats.pendingCardChangeRequests > 0 ? 'text-amber-400' : 'text-muted'}`}>
                        {stats.pendingCardChangeRequests}
                      </span>
                    </div>
                    <div className="flex justify-between items-center p-2 bg-surface rounded-lg">
                      <span className="text-sm text-foreground">Past Due Accounts</span>
                      <span className={`text-sm font-bold ${stats.pastDueMemberships > 0 ? 'text-danger' : 'text-muted'}`}>
                        {stats.pastDueMemberships}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="ppl-card">
                  <h3 className="font-semibold text-foreground mb-3">Quick Stats</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center p-2 bg-surface rounded-lg">
                      <span className="text-sm text-foreground">Est. Weekly Revenue</span>
                      <span className="text-sm font-bold text-ppl-light-green">
                        {/* rough estimate based on active members */}
                        —
                      </span>
                    </div>
                    <div className="flex justify-between items-center p-2 bg-surface rounded-lg">
                      <span className="text-sm text-foreground">Collection Rate</span>
                      <span className="text-sm font-bold text-ppl-light-green">
                        {stats.activeMemberships + stats.pastDueMemberships > 0
                          ? `${Math.round((stats.activeMemberships / (stats.activeMemberships + stats.pastDueMemberships)) * 100)}%`
                          : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* All Members Tab */}
      {tab === 'members' && (
        <div>
          {/* Filters */}
          <div className="flex gap-3 mb-4">
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="ppl-input w-auto"
            >
              <option value="">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="PAST_DUE">Past Due</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
            <select
              value={filterLocation}
              onChange={(e) => setFilterLocation(e.target.value)}
              className="ppl-input w-auto"
            >
              <option value="">All Locations</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>{loc.name}</option>
              ))}
            </select>
          </div>

          {/* Member List */}
          <div className="space-y-2">
            {memberships.length === 0 ? (
              <div className="ppl-card text-center py-8">
                <p className="text-muted">No memberships found.</p>
              </div>
            ) : (
              memberships.map((m) => (
                <div key={m.id} className="ppl-card flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-foreground">{m.client.fullName}</p>
                      <span className={`ppl-badge ${STATUS_BADGES[m.status] || ''}`}>
                        {m.status === 'PAST_DUE' ? 'Past Due' : m.status}
                      </span>
                    </div>
                    <p className="text-sm text-muted">
                      {m.plan.name} &middot; {m.location.name} &middot; Bills on {m.billingDay.toLowerCase()}s
                    </p>
                    <p className="text-xs text-muted">{m.client.email}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-ppl-light-green">
                      ${(m.plan.priceCents / 100).toFixed(0)}
                    </p>
                    <p className="text-xs text-muted">/week</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Past Due Tab */}
      {tab === 'pastdue' && (
        <div className="space-y-3">
          {pastDue.length === 0 ? (
            <div className="ppl-card text-center py-8">
              <p className="text-ppl-light-green font-medium">No past-due accounts!</p>
            </div>
          ) : (
            pastDue.map((m) => (
              <div key={m.id} className="ppl-card border-danger/30">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-semibold text-foreground">{m.client.fullName}</p>
                    <p className="text-sm text-muted">{m.client.email}</p>
                    <p className="text-sm text-muted">
                      {m.plan.name} &middot; {m.location.name}
                    </p>
                    {m.payments && m.payments.length > 0 && (
                      <p className="text-xs text-danger mt-1">
                        Last failed: {formatDate(m.payments[0].createdAt)}
                        {m.payments[0].failureReason && ` — ${m.payments[0].failureReason}`}
                      </p>
                    )}
                  </div>
                  <span className="ppl-badge ppl-badge-danger">Past Due</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleRetryPayment(m.id)}
                    disabled={actionInProgress === m.id}
                    className="ppl-btn ppl-btn-primary text-sm"
                  >
                    {actionInProgress === m.id ? 'Retrying...' : 'Retry Payment'}
                  </button>
                  <button
                    onClick={() => handleCancelMembership(m.id, m.client.fullName)}
                    disabled={actionInProgress === m.id}
                    className="ppl-btn ppl-btn-danger text-sm"
                  >
                    Cancel Membership
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Requests Tab */}
      {tab === 'requests' && (
        <div>
          {/* Cancel Requests */}
          <h3 className="font-semibold text-foreground mb-3">Cancellation Requests</h3>
          <div className="space-y-2 mb-6">
            {cancelRequests.length === 0 ? (
              <div className="ppl-card text-center py-4">
                <p className="text-muted text-sm">No pending cancellation requests.</p>
              </div>
            ) : (
              cancelRequests.map((m) => (
                <div key={m.id} className="ppl-card flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-foreground">{m.client.fullName}</p>
                    <p className="text-sm text-muted">
                      {m.plan.name} &middot; Requested {m.cancelRequestedAt ? formatDate(m.cancelRequestedAt) : 'recently'}
                    </p>
                    <p className="text-xs text-muted">{m.client.email} {m.client.phone && `• ${m.client.phone}`}</p>
                  </div>
                  <button
                    onClick={() => handleCancelMembership(m.id, m.client.fullName)}
                    disabled={actionInProgress === m.id}
                    className="ppl-btn ppl-btn-danger text-sm"
                  >
                    {actionInProgress === m.id ? 'Processing...' : 'Approve Cancel'}
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Card Change Requests */}
          <h3 className="font-semibold text-foreground mb-3">Card Update Requests</h3>
          <div className="space-y-2">
            {cardRequests.length === 0 ? (
              <div className="ppl-card text-center py-4">
                <p className="text-muted text-sm">No pending card change requests.</p>
              </div>
            ) : (
              cardRequests.map((r) => (
                <div key={r.id} className="ppl-card flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-foreground">{r.client.fullName}</p>
                    <p className="text-sm text-muted">
                      Requested {formatDate(r.createdAt)}
                      {r.notes && ` — "${r.notes}"`}
                    </p>
                    <p className="text-xs text-muted">{r.client.email}</p>
                    <span className={`ppl-badge ${r.status === 'LINK_SENT' ? 'ppl-badge-warning' : 'ppl-badge-active'} mt-1`}>
                      {r.status === 'LINK_SENT' ? 'Link Sent' : 'Pending'}
                    </span>
                  </div>
                  {r.status === 'PENDING' && (
                    <button
                      onClick={() => handleSendCardLink(r.id)}
                      disabled={actionInProgress === r.id}
                      className="ppl-btn ppl-btn-primary text-sm"
                    >
                      {actionInProgress === r.id ? 'Sending...' : 'Send Update Link'}
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="ppl-card text-center">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-muted mt-1">{label}</p>
    </div>
  );
}
