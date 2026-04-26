'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { api, ClientListItem, Location } from '@/lib/api';

const AGE_GROUP_LABELS: Record<string, string> = {
  college: 'College',
  ms_hs: '13+ (Middle School, High School, College, and Pro)',
  youth: 'Youth',
};

export default function AdminMembersPage() {
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [search, setSearch] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [filterAgeGroup, setFilterAgeGroup] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState<ClientListItem | null>(null);

  const loadClients = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.getMembers({
        search: search || undefined,
        locationId: filterLocation || undefined,
        ageGroup: filterAgeGroup || undefined,
        status: filterStatus || undefined,
      });
      if (res.data) setClients(res.data);
    } catch (err) {
      console.error('Failed to load clients:', err);
    } finally {
      setIsLoading(false);
    }
  }, [search, filterLocation, filterAgeGroup, filterStatus]);

  useEffect(() => {
    api.getLocations().then((res) => {
      if (res.data) setLocations(res.data);
    });
  }, []);

  useEffect(() => {
    const timeout = setTimeout(loadClients, 300); // Debounce search
    return () => clearTimeout(timeout);
  }, [loadClients]);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Members</h1>
          <p className="text-sm text-muted mt-0.5">{clients.length} athletes</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5 flex-wrap">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email..."
          className="ppl-input flex-1 min-w-[200px]"
        />
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
        <select
          value={filterAgeGroup}
          onChange={(e) => setFilterAgeGroup(e.target.value)}
          className="ppl-input w-auto"
        >
          <option value="">All Ages</option>
          <option value="college">College</option>
          <option value="ms_hs">13+ (MS / HS / College / Pro)</option>
          <option value="youth">Youth</option>
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="ppl-input w-auto"
        >
          <option value="">All Statuses</option>
          <option value="active">Active Membership</option>
          <option value="past_due">Past Due</option>
          <option value="no_membership">No Membership</option>
        </select>
      </div>

      {/* Members List */}
      {isLoading ? (
        // Layout-matched shimmer rows — avatar circle + 2 lines + status pill,
        // same heights as the real row so no layout shift on data arrival.
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, n) => (
            <div key={n} className="ppl-card flex items-center gap-3" aria-hidden>
              <div className="ppl-skeleton w-10 h-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <div className="ppl-skeleton h-4 w-1/3" />
                <div className="ppl-skeleton h-3 w-1/2" />
              </div>
              <div className="ppl-skeleton h-6 w-16 rounded-full" />
            </div>
          ))}
          <span className="sr-only">Loading members…</span>
        </div>
      ) : clients.length === 0 ? (
        <div className="ppl-card text-center py-12">
          <p className="text-muted">
            {search ? 'No members match your search.' : 'No members found.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {clients.map((client) => (
            <div
              key={client.id}
              className="ppl-card flex items-center justify-between cursor-pointer hover:border-highlight/50 transition-colors"
              onClick={() => setSelectedClient(selectedClient?.id === client.id ? null : client)}
            >
              <div className="flex items-center gap-4 flex-1">
                {/* Avatar */}
                <div className="w-10 h-10 rounded-full bg-surface-hover flex items-center justify-center text-sm font-bold text-muted">
                  {client.fullName
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .slice(0, 2)}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/admin/members/${client.id}`} className="font-semibold text-foreground hover:text-accent-text transition-colors truncate" onClick={(e) => e.stopPropagation()}>{client.fullName}</Link>
                    {client.membership ? (
                      <span
                        className={`ppl-badge ${
                          client.membership.status === 'ACTIVE'
                            ? 'ppl-badge-active'
                            : 'ppl-badge-danger'
                        }`}
                      >
                        {client.membership.status === 'ACTIVE' ? 'Active' : 'Past Due'}
                      </span>
                    ) : (
                      <span className="ppl-badge bg-surface-hover text-muted">No Plan</span>
                    )}
                    {client.ageGroup && (
                      <span className="text-xs text-muted bg-surface px-2 py-0.5 rounded">
                        {AGE_GROUP_LABELS[client.ageGroup] || client.ageGroup}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted mt-0.5">
                    {client.email}
                    {client.phone && ` \u00B7 ${client.phone}`}
                    {client.location && ` \u00B7 ${client.location.name}`}
                  </p>
                </div>
              </div>

              {/* Right side */}
              <div className="text-right">
                {client.membership && (
                  <p className="text-sm font-semibold text-accent-text">
                    {client.membership.plan.name}
                  </p>
                )}
                <p className="text-xs text-muted">
                  {client.totalBookings} session{client.totalBookings !== 1 ? 's' : ''} &middot; Joined{' '}
                  {formatDate(client.joinedAt)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Expanded Client Detail */}
      {selectedClient && (
        <ClientDetailPanel client={selectedClient} onClose={() => setSelectedClient(null)} />
      )}
    </div>
  );
}

function ClientDetailPanel({
  client,
  onClose,
}: {
  client: ClientListItem;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState(client.notes || '');
  const [goals, setGoals] = useState(client.trainingGoals || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSaveNotes = async () => {
    setSaving(true);
    try {
      await api.updateClientNotes(client.id, { notes, trainingGoals: goals });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save notes:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-96 max-w-[100vw] bg-surface border-l border-border shadow-2xl z-50 overflow-y-auto"
         style={{ top: 0 }}>
      <div className="p-5">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-foreground">Athlete Detail</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground text-xl">&times;</button>
        </div>

        {/* Profile Header */}
        <div className="text-center mb-5">
          <div className="w-16 h-16 rounded-full ppl-gradient mx-auto flex items-center justify-center text-xl font-bold text-white mb-3">
            {client.fullName.split(' ').map((n) => n[0]).join('').slice(0, 2)}
          </div>
          <h3 className="font-bold text-foreground text-lg">{client.fullName}</h3>
          <p className="text-sm text-muted">{client.email}</p>
          {client.phone && <p className="text-sm text-muted">{client.phone}</p>}
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="bg-background rounded-lg p-3 text-center">
            <p className="text-lg font-bold text-foreground">{client.totalBookings}</p>
            <p className="text-xs text-muted">Total Sessions</p>
          </div>
          <div className="bg-background rounded-lg p-3 text-center">
            {client.membership ? (
              <>
                <p className="text-lg font-bold text-accent-text">
                  ${(client.membership.plan.priceCents / 100).toFixed(0)}
                </p>
                <p className="text-xs text-muted">/week</p>
              </>
            ) : (
              <>
                <p className="text-lg font-bold text-muted">—</p>
                <p className="text-xs text-muted">No plan</p>
              </>
            )}
          </div>
        </div>

        {/* Membership Info */}
        {client.membership && (
          <div className="mb-5">
            <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Membership</h4>
            <div className="bg-background rounded-lg p-3">
              <div className="flex justify-between items-center">
                <p className="font-semibold text-foreground text-sm">{client.membership.plan.name}</p>
                <span
                  className={`ppl-badge ${
                    client.membership.status === 'ACTIVE' ? 'ppl-badge-active' : 'ppl-badge-danger'
                  }`}
                >
                  {client.membership.status}
                </span>
              </div>
              <p className="text-xs text-muted mt-1">
                {client.membership.plan.sessionsPerWeek === null
                  ? 'Unlimited'
                  : `${client.membership.plan.sessionsPerWeek}x/week`}
              </p>
            </div>
          </div>
        )}

        {/* Notes */}
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Training Goals</h4>
          <textarea
            value={goals}
            onChange={(e) => setGoals(e.target.value)}
            className="ppl-input text-sm"
            rows={2}
            placeholder="Add training goals..."
          />
        </div>
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Coach Notes</h4>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="ppl-input text-sm"
            rows={3}
            placeholder="Add notes about this athlete..."
          />
        </div>
        <button
          onClick={handleSaveNotes}
          disabled={saving}
          className="ppl-btn ppl-btn-primary w-full justify-center text-sm"
        >
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Notes'}
        </button>
      </div>
    </div>
  );
}
