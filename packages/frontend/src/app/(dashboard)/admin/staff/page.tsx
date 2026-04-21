'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, StaffMember, StaffInvite, Location } from '@/lib/api';

// ============================================================
// TYPES
// ============================================================

type LocationRole = 'OWNER' | 'PITCHING_COORDINATOR' | 'YOUTH_COORDINATOR' | 'COACH' | 'TRAINER';

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  PITCHING_COORDINATOR: 'Pitching Coordinator',
  YOUTH_COORDINATOR: 'Youth Coordinator',
  COACH: 'Coach',
  TRAINER: 'Trainer',
};

const ROLE_COLORS: Record<string, string> = {
  OWNER: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  PITCHING_COORDINATOR: 'bg-highlight/15 text-highlight-text border-highlight/30',
  YOUTH_COORDINATOR: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  COACH: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  TRAINER: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
};

// ============================================================
// ADD STAFF MODAL
// ============================================================

function AddStaffModal({
  locations,
  onClose,
  onSuccess,
}: {
  locations: Location[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [globalRole, setGlobalRole] = useState<'STAFF' | 'ADMIN'>('STAFF');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Program-based role assignments
  // PPL row = PITCHING_COORDINATOR for selected locations
  // PPL Youth row = YOUTH_COORDINATOR for selected locations
  // Additional roles row = COACH / TRAINER per location
  const [pplLocations, setPplLocations] = useState<Set<string>>(new Set());
  const [youthLocations, setYouthLocations] = useState<Set<string>>(new Set());
  const [coachLocations, setCoachLocations] = useState<Set<string>>(new Set());
  const [trainerLocations, setTrainerLocations] = useState<Set<string>>(new Set());

  const toggleSet = (set: Set<string>, setFn: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setFn(next);
  };

  const handleSubmit = async () => {
    setError('');
    if (!fullName.trim() || !email.trim()) {
      setError('Name and email are required');
      return;
    }

    // Build location assignments from the program rows
    const locationMap = new Map<string, Set<LocationRole>>();

    for (const locId of pplLocations) {
      if (!locationMap.has(locId)) locationMap.set(locId, new Set());
      locationMap.get(locId)!.add('PITCHING_COORDINATOR');
    }
    for (const locId of youthLocations) {
      if (!locationMap.has(locId)) locationMap.set(locId, new Set());
      locationMap.get(locId)!.add('YOUTH_COORDINATOR');
    }
    for (const locId of coachLocations) {
      if (!locationMap.has(locId)) locationMap.set(locId, new Set());
      locationMap.get(locId)!.add('COACH');
    }
    for (const locId of trainerLocations) {
      if (!locationMap.has(locId)) locationMap.set(locId, new Set());
      locationMap.get(locId)!.add('TRAINER');
    }

    if (locationMap.size === 0) {
      setError('Select at least one location and role');
      return;
    }

    const locationAssignments = Array.from(locationMap.entries()).map(([locationId, roles]) => ({
      locationId,
      roles: Array.from(roles),
    }));

    setSaving(true);
    try {
      await api.inviteStaff({
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim() || undefined,
        role: globalRole,
        locations: locationAssignments,
      });
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send invite');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-surface border border-border rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground">Add Staff Member</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {error && (
            <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 text-sm">
              {error}
            </div>
          )}

          {/* Basic Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Full Name *</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-highlight/50"
                placeholder="John Smith"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Email *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-highlight/50"
                placeholder="john@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Phone</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-highlight/50"
                placeholder="(555) 123-4567"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Access Level</label>
              <select
                value={globalRole}
                onChange={(e) => setGlobalRole(e.target.value as 'STAFF' | 'ADMIN')}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-highlight/50"
              >
                <option value="STAFF">Staff</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
          </div>

          {/* Program / Location Grid */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">Assign Locations & Roles</h3>
            <p className="text-xs text-muted mb-4">
              Select which locations this person will work at and in what capacity. They can hold multiple roles at the same location.
            </p>

            <div className="border border-border rounded-lg overflow-hidden">
              {/* Header row */}
              <div className="grid bg-background/50 border-b border-border" style={{ gridTemplateColumns: `160px repeat(${locations.length}, 1fr)` }}>
                <div className="px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wider">Role</div>
                {locations.map((loc) => (
                  <div key={loc.id} className="px-3 py-2.5 text-xs font-semibold text-muted uppercase tracking-wider text-center">
                    {loc.name.replace(/^PPL\s*/i, '').trim() || loc.name}
                  </div>
                ))}
              </div>

              {/* PPL (Pitching Coordinator) Row */}
              <div className="grid border-b border-border hover:bg-surface-hover/50 transition-colors" style={{ gridTemplateColumns: `160px repeat(${locations.length}, 1fr)` }}>
                <div className="px-4 py-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-highlight" />
                  <span className="text-sm font-medium text-foreground">PPL</span>
                </div>
                {locations.map((loc) => (
                  <div key={loc.id} className="px-3 py-3 flex items-center justify-center">
                    <button
                      onClick={() => toggleSet(pplLocations, setPplLocations, loc.id)}
                      className={`w-7 h-7 rounded-lg border-2 transition-all flex items-center justify-center ${
                        pplLocations.has(loc.id)
                          ? 'bg-highlight border-highlight text-background'
                          : 'border-border hover:border-muted'
                      }`}
                    >
                      {pplLocations.has(loc.id) && (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  </div>
                ))}
              </div>

              {/* PPL Youth (Youth Coordinator) Row */}
              <div className="grid border-b border-border hover:bg-surface-hover/50 transition-colors" style={{ gridTemplateColumns: `160px repeat(${locations.length}, 1fr)` }}>
                <div className="px-4 py-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  <span className="text-sm font-medium text-foreground">PPL Youth</span>
                </div>
                {locations.map((loc) => (
                  <div key={loc.id} className="px-3 py-3 flex items-center justify-center">
                    <button
                      onClick={() => toggleSet(youthLocations, setYouthLocations, loc.id)}
                      className={`w-7 h-7 rounded-lg border-2 transition-all flex items-center justify-center ${
                        youthLocations.has(loc.id)
                          ? 'bg-blue-500 border-blue-500 text-white'
                          : 'border-border hover:border-muted'
                      }`}
                    >
                      {youthLocations.has(loc.id) && (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  </div>
                ))}
              </div>

              {/* Coach Row */}
              <div className="grid border-b border-border hover:bg-surface-hover/50 transition-colors" style={{ gridTemplateColumns: `160px repeat(${locations.length}, 1fr)` }}>
                <div className="px-4 py-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-sm font-medium text-foreground">Coach</span>
                </div>
                {locations.map((loc) => (
                  <div key={loc.id} className="px-3 py-3 flex items-center justify-center">
                    <button
                      onClick={() => toggleSet(coachLocations, setCoachLocations, loc.id)}
                      className={`w-7 h-7 rounded-lg border-2 transition-all flex items-center justify-center ${
                        coachLocations.has(loc.id)
                          ? 'bg-emerald-500 border-emerald-500 text-white'
                          : 'border-border hover:border-muted'
                      }`}
                    >
                      {coachLocations.has(loc.id) && (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  </div>
                ))}
              </div>

              {/* Trainer Row */}
              <div className="grid hover:bg-surface-hover/50 transition-colors" style={{ gridTemplateColumns: `160px repeat(${locations.length}, 1fr)` }}>
                <div className="px-4 py-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-purple-500" />
                  <span className="text-sm font-medium text-foreground">Trainer</span>
                </div>
                {locations.map((loc) => (
                  <div key={loc.id} className="px-3 py-3 flex items-center justify-center">
                    <button
                      onClick={() => toggleSet(trainerLocations, setTrainerLocations, loc.id)}
                      className={`w-7 h-7 rounded-lg border-2 transition-all flex items-center justify-center ${
                        trainerLocations.has(loc.id)
                          ? 'bg-purple-500 border-purple-500 text-white'
                          : 'border-border hover:border-muted'
                      }`}
                    >
                      {trainerLocations.has(loc.id) && (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Summary of selections */}
          {(pplLocations.size > 0 || youthLocations.size > 0 || coachLocations.size > 0 || trainerLocations.size > 0) && (
            <div className="bg-background/50 border border-border rounded-lg p-4">
              <h4 className="text-xs font-semibold text-muted uppercase mb-2">Assignment Summary</h4>
              <div className="space-y-1.5">
                {locations.map((loc) => {
                  const roles: string[] = [];
                  if (pplLocations.has(loc.id)) roles.push('Pitching Coordinator');
                  if (youthLocations.has(loc.id)) roles.push('Youth Coordinator');
                  if (coachLocations.has(loc.id)) roles.push('Coach');
                  if (trainerLocations.has(loc.id)) roles.push('Trainer');
                  if (roles.length === 0) return null;
                  return (
                    <div key={loc.id} className="flex items-start gap-2 text-sm">
                      <span className="font-medium text-foreground min-w-[120px]">{loc.name}:</span>
                      <span className="text-muted">{roles.join(', ')}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <p className="text-xs text-muted">
            An email invite will be sent to {email || 'the provided email'}. They&apos;ll set their own password and profile picture when they accept.
          </p>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-border flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-muted hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-6 py-2 bg-highlight text-on-accent rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? 'Sending Invite...' : 'Send Invite'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// STAFF DETAIL MODAL
// ============================================================

function StaffDetailModal({
  member,
  locations,
  onClose,
  onUpdate,
}: {
  member: StaffMember;
  locations: Location[];
  onClose: () => void;
  onUpdate: () => void;
}) {
  const [role, setRole] = useState(member.role);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const handleRoleChange = async (newRole: 'ADMIN' | 'STAFF') => {
    setRole(newRole);
    setSaving(true);
    try {
      await api.updateStaffRole(member.id, newRole);
      onUpdate();
    } catch {
      setRole(member.role); // revert
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await api.removeStaffMember(member.id);
      onClose();
      onUpdate();
    } catch {
      setRemoving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-surface border border-border rounded-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-border">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-highlight/20 flex items-center justify-center">
              {member.profileImageUrl ? (
                <img src={member.profileImageUrl} alt="" className="w-12 h-12 rounded-full object-cover" />
              ) : (
                <span className="text-highlight-text text-lg font-bold">{member.fullName.charAt(0)}</span>
              )}
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-foreground">{member.fullName}</h2>
              <p className="text-sm text-muted">{member.email}</p>
              {member.phone && <p className="text-xs text-muted">{member.phone}</p>}
            </div>
            <button onClick={onClose} className="text-muted hover:text-foreground">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Role toggle */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Access Level</label>
            <div className="flex gap-2">
              {(['STAFF', 'ADMIN'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => handleRoleChange(r)}
                  disabled={saving}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    role === r
                      ? 'bg-highlight text-on-accent'
                      : 'bg-background border border-border text-muted hover:text-foreground'
                  }`}
                >
                  {r === 'ADMIN' ? 'Admin' : 'Staff'}
                </button>
              ))}
            </div>
          </div>

          {/* Location assignments */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Locations & Roles</label>
            {member.locations.length > 0 ? (
              <div className="space-y-2">
                {member.locations.map((loc) => (
                  <div key={loc.id} className="bg-background/50 border border-border rounded-lg px-4 py-3">
                    <p className="text-sm font-medium text-foreground mb-1.5">{loc.name}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {loc.roles.map((r) => (
                        <span
                          key={r}
                          className={`text-xs px-2 py-0.5 rounded-full border ${ROLE_COLORS[r] || 'bg-surface text-muted border-border'}`}
                        >
                          {ROLE_LABELS[r] || r}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted italic">No location assignments</p>
            )}
          </div>

          {/* Danger zone */}
          <div className="pt-3 border-t border-border">
            {!confirmRemove ? (
              <button
                onClick={() => setConfirmRemove(true)}
                className="text-sm text-danger hover:text-danger/80 transition-colors"
              >
                Remove from staff
              </button>
            ) : (
              <div className="flex items-center gap-3">
                <p className="text-sm text-danger">Are you sure?</p>
                <button
                  onClick={handleRemove}
                  disabled={removing}
                  className="px-3 py-1.5 bg-danger text-white text-sm rounded-lg hover:opacity-90 disabled:opacity-50"
                >
                  {removing ? 'Removing...' : 'Yes, Remove'}
                </button>
                <button
                  onClick={() => setConfirmRemove(false)}
                  className="text-sm text-muted hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// MAIN PAGE
// ============================================================

export default function AdminStaffPage() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [invites, setInvites] = useState<StaffInvite[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedMember, setSelectedMember] = useState<StaffMember | null>(null);
  const [tab, setTab] = useState<'active' | 'invites'>('active');
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [staffRes, inviteRes, locRes] = await Promise.all([
        api.getStaffList(),
        api.getStaffInvites(),
        api.getLocations(),
      ]);
      setStaff(staffRes.data || []);
      setInvites(inviteRes.data || []);
      setLocations(locRes.data || []);
    } catch {
      // silently handle
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRevoke = async (inviteId: string) => {
    setRevokingId(inviteId);
    try {
      await api.revokeStaffInvite(inviteId);
      setInvites((prev) => prev.filter((i) => i.id !== inviteId));
    } catch {
      // handle error
    } finally {
      setRevokingId(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-surface rounded w-48" />
          <div className="h-64 bg-surface rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Staff</h1>
          <p className="text-sm text-muted mt-1">
            {staff.length} team member{staff.length !== 1 ? 's' : ''}
            {invites.length > 0 && ` · ${invites.length} pending invite${invites.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2.5 bg-highlight text-on-accent rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add Staff
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-background rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab('active')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
            tab === 'active' ? 'bg-surface text-foreground shadow-sm' : 'text-muted hover:text-foreground'
          }`}
        >
          Active ({staff.length})
        </button>
        <button
          onClick={() => setTab('invites')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
            tab === 'invites' ? 'bg-surface text-foreground shadow-sm' : 'text-muted hover:text-foreground'
          }`}
        >
          Pending Invites ({invites.length})
        </button>
      </div>

      {/* Active Staff Tab */}
      {tab === 'active' && (
        <div className="space-y-3">
          {staff.length === 0 ? (
            <div className="bg-surface border border-border rounded-xl p-12 text-center">
              <div className="w-16 h-16 bg-highlight/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-highlight-text" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">No staff members yet</h3>
              <p className="text-sm text-muted mb-4">Add your first team member to get started</p>
              <button
                onClick={() => setShowAddModal(true)}
                className="px-4 py-2 bg-highlight text-on-accent rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                Add Staff Member
              </button>
            </div>
          ) : (
            staff.map((member) => (
              <div
                key={member.id}
                onClick={() => setSelectedMember(member)}
                className="bg-surface border border-border rounded-xl p-4 hover:border-highlight/30 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-4">
                  {/* Avatar */}
                  <div className="w-11 h-11 rounded-full bg-highlight/15 flex items-center justify-center flex-shrink-0">
                    {member.profileImageUrl ? (
                      <img src={member.profileImageUrl} alt="" className="w-11 h-11 rounded-full object-cover" />
                    ) : (
                      <span className="text-highlight-text font-bold">{member.fullName.charAt(0)}</span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <h3 className="text-sm font-semibold text-foreground truncate">{member.fullName}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        member.role === 'ADMIN'
                          ? 'bg-amber-500/15 text-amber-400'
                          : 'bg-surface-hover text-muted'
                      }`}>
                        {member.role === 'ADMIN' ? 'Admin' : 'Staff'}
                      </span>
                    </div>
                    <p className="text-xs text-muted truncate">{member.email}{member.phone ? ` · ${member.phone}` : ''}</p>
                  </div>

                  {/* Location badges */}
                  <div className="hidden sm:flex flex-wrap gap-1.5 max-w-xs">
                    {member.locations.map((loc) => (
                      <div key={loc.id} className="text-xs bg-background border border-border rounded-lg px-2.5 py-1">
                        <span className="font-medium text-foreground">{loc.name}</span>
                        <span className="text-muted ml-1">
                          ({loc.roles.map((r) => ROLE_LABELS[r] || r).join(', ')})
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Arrow */}
                  <svg className="w-4 h-4 text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Pending Invites Tab */}
      {tab === 'invites' && (
        <div className="space-y-3">
          {invites.length === 0 ? (
            <div className="bg-surface border border-border rounded-xl p-12 text-center">
              <p className="text-sm text-muted">No pending invitations</p>
            </div>
          ) : (
            invites.map((invite) => (
              <div key={invite.id} className="bg-surface border border-border rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <h3 className="text-sm font-semibold text-foreground">{invite.fullName}</h3>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400">
                        Pending
                      </span>
                    </div>
                    <p className="text-xs text-muted">{invite.email}</p>
                    <p className="text-xs text-muted mt-1">
                      Expires {new Date(invite.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRevoke(invite.id)}
                    disabled={revokingId === invite.id}
                    className="px-3 py-1.5 text-xs font-medium text-danger border border-danger/30 rounded-lg hover:bg-danger/10 transition-colors disabled:opacity-50"
                  >
                    {revokingId === invite.id ? 'Revoking...' : 'Revoke'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Modals */}
      {showAddModal && (
        <AddStaffModal
          locations={locations}
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
            loadData();
            setTab('invites');
          }}
        />
      )}

      {selectedMember && (
        <StaffDetailModal
          member={selectedMember}
          locations={locations}
          onClose={() => setSelectedMember(null)}
          onUpdate={() => {
            setSelectedMember(null);
            loadData();
          }}
        />
      )}
    </div>
  );
}
