'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, ClientListItem } from '@/lib/api';

const AGE_GROUP_LABELS: Record<string, string> = {
  college: 'College',
  ms_hs: '13+ (MS/HS)',
  youth: 'Youth',
};

export default function StaffAthletesPage() {
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState<ClientListItem | null>(null);
  const [notes, setNotes] = useState('');
  const [goals, setGoals] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const loadClients = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.getMembers({ search: search || undefined });
      if (res.data) setClients(res.data);
    } catch (err) {
      console.error('Failed to load athletes:', err);
    } finally {
      setIsLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const timeout = setTimeout(loadClients, 300);
    return () => clearTimeout(timeout);
  }, [loadClients]);

  const selectClient = (client: ClientListItem) => {
    if (selectedClient?.id === client.id) {
      setSelectedClient(null);
    } else {
      setSelectedClient(client);
      setNotes(client.notes || '');
      setGoals(client.trainingGoals || '');
      setSaved(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!selectedClient) return;
    setSaving(true);
    try {
      await api.updateClientNotes(selectedClient.id, { notes, trainingGoals: goals });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      // Update local state
      setClients((prev) =>
        prev.map((c) => (c.id === selectedClient.id ? { ...c, notes, trainingGoals: goals } : c))
      );
    } catch (err) {
      console.error('Failed to save:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex gap-5">
      {/* Athletes List */}
      <div className="flex-1">
        <div className="mb-5">
          <h1 className="text-2xl font-bold text-foreground">My Athletes</h1>
          <p className="text-sm text-muted mt-0.5">
            {clients.length} athlete{clients.length !== 1 ? 's' : ''} at your location
          </p>
        </div>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search athletes..."
          className="ppl-input mb-4"
        />

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <div key={n} className="ppl-card animate-pulse h-16" />
            ))}
          </div>
        ) : clients.length === 0 ? (
          <div className="ppl-card text-center py-8">
            <p className="text-muted">{search ? 'No athletes match your search.' : 'No athletes found.'}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {clients.map((client) => (
              <div
                key={client.id}
                onClick={() => selectClient(client)}
                className={`ppl-card flex items-center gap-4 cursor-pointer transition-colors ${
                  selectedClient?.id === client.id
                    ? 'border-ppl-dark-green/50 bg-ppl-dark-green/5'
                    : 'hover:border-border/60'
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-surface-hover flex items-center justify-center text-sm font-bold text-muted">
                  {client.fullName.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-foreground text-sm">{client.fullName}</p>
                    {client.ageGroup && (
                      <span className="text-xs text-muted bg-surface px-2 py-0.5 rounded">
                        {AGE_GROUP_LABELS[client.ageGroup] || client.ageGroup}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted">
                    {client.membership
                      ? `${client.membership.plan.name}`
                      : 'No active plan'}
                    {' \u00B7 '}
                    {client.totalBookings} session{client.totalBookings !== 1 ? 's' : ''}
                  </p>
                </div>
                {client.membership && (
                  <span
                    className={`ppl-badge text-xs ${
                      client.membership.status === 'ACTIVE' ? 'ppl-badge-active' : 'ppl-badge-danger'
                    }`}
                  >
                    {client.membership.status === 'ACTIVE' ? 'Active' : 'Past Due'}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detail Panel */}
      {selectedClient && (
        <div className="w-80 min-w-[320px]">
          <div className="ppl-card sticky top-4">
            {/* Header */}
            <div className="text-center mb-4">
              <div className="w-14 h-14 rounded-full ppl-gradient mx-auto flex items-center justify-center text-lg font-bold text-white mb-2">
                {selectedClient.fullName.split(' ').map((n) => n[0]).join('').slice(0, 2)}
              </div>
              <h3 className="font-bold text-foreground">{selectedClient.fullName}</h3>
              <p className="text-xs text-muted">{selectedClient.email}</p>
              {selectedClient.phone && (
                <p className="text-xs text-muted">{selectedClient.phone}</p>
              )}
            </div>

            {/* Quick Info */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              <div className="bg-background rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-foreground">{selectedClient.totalBookings}</p>
                <p className="text-xs text-muted">Sessions</p>
              </div>
              <div className="bg-background rounded-lg p-3 text-center">
                {selectedClient.membership ? (
                  <>
                    <p className="text-lg font-bold text-ppl-light-green">
                      ${(selectedClient.membership.plan.priceCents / 100).toFixed(0)}
                    </p>
                    <p className="text-xs text-muted">/week</p>
                  </>
                ) : (
                  <>
                    <p className="text-lg font-bold text-muted">&mdash;</p>
                    <p className="text-xs text-muted">No plan</p>
                  </>
                )}
              </div>
            </div>

            {/* Training Goals */}
            <div className="mb-3">
              <label className="text-xs font-semibold text-muted uppercase tracking-wider block mb-1">
                Training Goals
              </label>
              <textarea
                value={goals}
                onChange={(e) => { setGoals(e.target.value); setSaved(false); }}
                className="ppl-input text-sm"
                rows={2}
                placeholder="What is this athlete working on?"
              />
            </div>

            {/* Notes */}
            <div className="mb-3">
              <label className="text-xs font-semibold text-muted uppercase tracking-wider block mb-1">
                Session Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => { setNotes(e.target.value); setSaved(false); }}
                className="ppl-input text-sm"
                rows={3}
                placeholder="Add notes from today's session..."
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
      )}
    </div>
  );
}
