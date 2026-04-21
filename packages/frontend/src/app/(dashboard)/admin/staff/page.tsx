'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, StaffMember, StaffInvite, Location } from '@/lib/api';

// ============================================================
// TYPES
// ============================================================

type LocationRole = 'OWNER' | 'PITCHING_COORDINATOR' | 'YOUTH_COORDINATOR' | 'COACH' | 'TRAINER';

// Display-friendly labels
const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Admin',
  PITCHING_COORDINATOR: 'PPL Coordinator',
  YOUTH_COORDINATOR: 'Youth Coordinator',
  COACH: 'Performance Coach',
  TRAINER: 'Youth Coach',
};

const ROLE_COLORS: Record<string, string> = {
  OWNER: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  PITCHING_COORDINATOR: 'bg-highlight/15 text-highlight-text border-highlight/30',
  YOUTH_COORDINATOR: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  COACH: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  TRAINER: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
};

// Program role options shown in the Add Staff modal
type ProgramRole = 'ADMIN' | 'COORDINATOR' | 'PERFORMANCE_COACH';

const PROGRAM_ROLE_LABELS: Record<ProgramRole, string> = {
  ADMIN: 'Admin',
  COORDINATOR: 'Coordinator',
  PERFORMANCE_COACH: 'Performance Coach',
};

// Map program + role to backend LocationRole
function mapToLocationRoles(
  program: 'PPL' | 'YOUTH',
  roles: Set<ProgramRole>
): LocationRole[] {
  const result: LocationRole[] = [];
  for (const r of roles) {
    if (r === 'ADMIN') result.push('OWNER');
    else if (r === 'COORDINATOR') result.push(program === 'PPL' ? 'PITCHING_COORDINATOR' : 'YOUTH_COORDINATOR');
    else if (r === 'PERFORMANCE_COACH') result.push(program === 'PPL' ? 'COACH' : 'TRAINER');
  }
  return result;
}

// ============================================================
// ADD STAFF MODAL
// ============================================================

// Per-location, per-program role selections
type LocationRoleSelections = Record<string, { ppl: Set<ProgramRole>; youth: Set<ProgramRole> }>;

function RoleToggleButton({
  label,
  active,
  disabled,
  color,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  color: 'amber' | 'highlight' | 'emerald';
  onClick: () => void;
}) {
  const colorMap = {
    amber: active ? 'bg-amber-500/20 text-amber-400 border-amber-500/50' : '',
    highlight: active ? 'bg-highlight/20 text-highlight-text border-highlight/50' : '',
    emerald: active ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50' : '',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled && !active}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
        active
          ? colorMap[color]
          : disabled
          ? 'border-border/50 text-muted/40 cursor-not-allowed'
          : 'border-border text-muted hover:border-muted hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );
}

function ProgramRow({
  program,
  roles,
  onToggle,
}: {
  program: 'PPL' | 'YOUTH';
  roles: Set<ProgramRole>;
  onToggle: (role: ProgramRole) => void;
}) {
  const isCoach = roles.has('PERFORMANCE_COACH');
  const isAdminOrCoord = roles.has('ADMIN') || roles.has('COORDINATOR');

  return (
    <div className="flex items-center justify-between py-2.5">
      <div className="flex items-center gap-2 min-w-[90px]">
        <span className={`w-2 h-2 rounded-full ${program === 'PPL' ? 'bg-highlight' : 'bg-blue-500'}`} />
        <span className="text-sm font-medium text-foreground">{program === 'PPL' ? 'PPL' : 'PPL Youth'}</span>
      </div>
      <div className="flex gap-2">
        <RoleToggleButton
          label="Admin"
          active={roles.has('ADMIN')}
          disabled={isCoach}
          color="amber"
          onClick={() => onToggle('ADMIN')}
        />
        <RoleToggleButton
          label="Coordinator"
          active={roles.has('COORDINATOR')}
          disabled={isCoach}
          color="highlight"
          onClick={() => onToggle('COORDINATOR')}
        />
        <RoleToggleButton
          label="Performance Coach"
          active={roles.has('PERFORMANCE_COACH')}
          disabled={isAdminOrCoord}
          color="emerald"
          onClick={() => onToggle('PERFORMANCE_COACH')}
        />
      </div>
    </div>
  );
}

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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Role selections per location: { [locationId]: { ppl: Set<ProgramRole>, youth: Set<ProgramRole> } }
  const [selections, setSelections] = useState<LocationRoleSelections>({});

  const toggleRole = (locationId: string, program: 'ppl' | 'youth', role: ProgramRole) => {
    setSelections((prev) => {
      const loc = prev[locationId] || { ppl: new Set<ProgramRole>(), youth: new Set<ProgramRole>() };
      const current = new Set(loc[program]);

      if (current.has(role)) {
        // Toggle off
        current.delete(role);
      } else {
        // Mutual exclusivity: Performance Coach can't combine with Admin or Coordinator
        if (role === 'PERFORMANCE_COACH') {
          current.delete('ADMIN');
          current.delete('COORDINATOR');
        } else {
          // Selecting Admin or Coordinator removes Performance Coach
          current.delete('PERFORMANCE_COACH');
        }
        current.add(role);
      }

      return {
        ...prev,
        [locationId]: { ...loc, [program]: current },
      };
    });
  };

  // Auto-determine global role: if ADMIN on any row → ADMIN, otherwise STAFF
  const computedGlobalRole = (() => {
    for (const locId of Object.keys(selections)) {
      const loc = selections[locId];
      if (loc.ppl.has('ADMIN') || loc.youth.has('ADMIN')) return 'ADMIN' as const;
    }
    return 'STAFF' as const;
  })();

  // Check if any roles are selected
  const hasAnySelection = Object.values(selections).some(
    (loc) => loc.ppl.size > 0 || loc.youth.size > 0
  );

  const handleSubmit = async () => {
    setError('');
    if (!fullName.trim() || !email.trim()) {
      setError('Name and email are required');
      return;
    }

    if (!hasAnySelection) {
      setError('Select at least one role at one location');
      return;
    }

    // Build location assignments from selections
    const locationMap = new Map<string, Set<LocationRole>>();

    for (const [locId, sel] of Object.entries(selections)) {
      const pplRoles = mapToLocationRoles('PPL', sel.ppl);
      const youthRoles = mapToLocationRoles('YOUTH', sel.youth);
      const allRoles = [...pplRoles, ...youthRoles];
      if (allRoles.length > 0) {
        locationMap.set(locId, new Set(allRoles));
      }
    }

    if (locationMap.size === 0) {
      setError('Select at least one role at one location');
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
        role: computedGlobalRole,
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
          <div>
            <h2 className="text-lg font-bold text-foreground">Add Staff Member</h2>
            <p className="text-xs text-muted mt-0.5">Invite someone to join the PPL team</p>
          </div>
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
          <div className="space-y-4">
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
            </div>
            <div className="sm:w-1/2">
              <label className="block text-sm font-medium text-foreground mb-1">Phone</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-highlight/50"
                placeholder="(555) 123-4567"
              />
            </div>
          </div>

          {/* Location Cards */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-1">Location Assignments</h3>
            <p className="text-xs text-muted mb-4">
              Choose roles for each program at each location. Performance Coach cannot be combined with Admin or Coordinator.
            </p>

            <div className="space-y-3">
              {locations.map((loc) => {
                const sel = selections[loc.id] || { ppl: new Set<ProgramRole>(), youth: new Set<ProgramRole>() };
                const hasRoles = sel.ppl.size > 0 || sel.youth.size > 0;

                return (
                  <div
                    key={loc.id}
                    className={`border rounded-xl overflow-hidden transition-colors ${
                      hasRoles ? 'border-highlight/40 bg-surface' : 'border-border bg-surface'
                    }`}
                  >
                    {/* Location header */}
                    <div className={`px-4 py-3 flex items-center justify-between ${
                      hasRoles ? 'bg-highlight/5 border-b border-highlight/20' : 'bg-background/30 border-b border-border'
                    }`}>
                      <div className="flex items-center gap-2.5">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                          hasRoles ? 'bg-highlight/20' : 'bg-background'
                        }`}>
                          <svg className={`w-4 h-4 ${hasRoles ? 'text-highlight-text' : 'text-muted'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                          </svg>
                        </div>
                        <span className="text-sm font-semibold text-foreground">{loc.name}</span>
                      </div>
                      {hasRoles && (
                        <span className="text-xs text-highlight-text font-medium px-2 py-0.5 bg-highlight/15 rounded-full">
                          {sel.ppl.size + sel.youth.size} role{sel.ppl.size + sel.youth.size !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>

                    {/* Program rows */}
                    <div className="px-4 divide-y divide-border">
                      <ProgramRow
                        program="PPL"
                        roles={sel.ppl}
                        onToggle={(role) => toggleRole(loc.id, 'ppl', role)}
                      />
                      <ProgramRow
                        program="YOUTH"
                        roles={sel.youth}
                        onToggle={(role) => toggleRole(loc.id, 'youth', role)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Auto-computed access level indicator */}
          {hasAnySelection && (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-background/50 border border-border rounded-lg">
              <span className={`w-2 h-2 rounded-full ${computedGlobalRole === 'ADMIN' ? 'bg-amber-400' : 'bg-emerald-400'}`} />
              <span className="text-xs text-muted">
                Global access level: <span className="font-semibold text-foreground">{computedGlobalRole === 'ADMIN' ? 'Admin' : 'Staff'}</span>
                {computedGlobalRole === 'ADMIN'
                  ? ' — can see everything across all locations'
                  : ' — access limited to assigned locations and roles'}
              </span>
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
            disabled={saving || !hasAnySelection}
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
