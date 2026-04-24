'use client';

/**
 * Admin invite UI v2 — role-first flow that supports all 11 roles, ships
 * alongside the existing /admin/staff page (which stays the home for the
 * Performance Coach + Coordinator + Admin legacy flow with its nicer
 * multi-location × program grid).
 *
 * Shape:
 *   Name → Email → Role dropdown → conditional scope picker → Send invite
 *
 * Scope picker varies by role:
 *   Global roles (ADMIN, CM_ADMIN, MEDICAL_ADMIN): none
 *   Location-scoped (COORDINATOR, PERF_COACH, CM, MEDICAL): single location dropdown
 *   PARTNERSHIP_COACH: partner school dropdown
 *   OUTSIDE_COACH, PARENT, ATHLETE: note that these use a different onboarding path
 */

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { api, Location } from '@/lib/api';
import { toast } from 'sonner';

type Role =
  | 'ADMIN'
  | 'COORDINATOR'
  | 'PERFORMANCE_COACH'
  | 'CONTENT_MARKETING_ADMIN'
  | 'CONTENT_MARKETING'
  | 'MEDICAL_ADMIN'
  | 'MEDICAL'
  | 'PARTNERSHIP_COACH'
  | 'OUTSIDE_COACH'
  | 'PARENT'
  | 'ATHLETE';

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Admin',
  COORDINATOR: 'Coordinator',
  PERFORMANCE_COACH: 'Performance Coach',
  CONTENT_MARKETING_ADMIN: 'Content & Marketing Admin',
  CONTENT_MARKETING: 'Content & Marketing',
  MEDICAL_ADMIN: 'Medical Admin',
  MEDICAL: 'Medical',
  PARTNERSHIP_COACH: 'Partnership Coach',
  OUTSIDE_COACH: 'Outside Coach',
  PARENT: 'Parent / Guardian',
  ATHLETE: 'Athlete',
};

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  ADMIN: 'Full access across every PPL location — settings, billing, staff management',
  COORDINATOR: 'Full access at a single location — manages athletes, sessions, staff',
  PERFORMANCE_COACH: 'Calendar + notes + programs at assigned location(s)',
  CONTENT_MARKETING_ADMIN: 'Global — oversees social + marketing across all locations',
  CONTENT_MARKETING: 'Location-scoped — layered on an existing coach/coordinator',
  MEDICAL_ADMIN: 'Renewed Performance owner — sees weekly screening revenue per location',
  MEDICAL: 'Screening staff — same tools as Medical Admin minus revenue access',
  PARTNERSHIP_COACH: 'Scoped to a single partner school — sees only their roster',
  OUTSIDE_COACH: 'Linked to specific athletes — view notes/metrics + message us',
  PARENT: 'Parents should self-register at /register instead of via invite',
  ATHLETE: 'Athletes should self-register at /register or via their parent',
};

const LOCATION_SCOPED: Role[] = [
  'COORDINATOR',
  'PERFORMANCE_COACH',
  'CONTENT_MARKETING',
  'MEDICAL',
];

const GLOBAL_ROLES: Role[] = [
  'ADMIN',
  'CONTENT_MARKETING_ADMIN',
  'MEDICAL_ADMIN',
];

const SELF_REGISTER_ROLES: Role[] = ['PARENT', 'ATHLETE'];

export default function AdminInviteV2Page() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [locationId, setLocationId] = useState('');
  const [schoolTeamId, setSchoolTeamId] = useState('');

  const [invitableRoles, setInvitableRoles] = useState<Role[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [schools, setSchools] = useState<
    Array<{ id: string; name: string; slug: string; type: string }>
  >([]);

  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [rolesRes, locsRes, schoolsRes] = await Promise.all([
          api.getInvitableRoles(),
          api.getLocations(),
          api.listSchoolTeams().catch(() => ({ data: [] as Array<{ id: string; name: string; slug: string; type: string }> })),
        ]);
        setInvitableRoles((rolesRes.data || []) as Role[]);
        if (locsRes.data) setLocations(locsRes.data);
        if (schoolsRes.data) setSchools(schoolsRes.data);
      } catch (err) {
        console.error('Failed to load invite form data:', err);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const needsLocation = useMemo(() => !!role && LOCATION_SCOPED.includes(role as Role), [role]);
  const needsSchool = useMemo(() => role === 'PARTNERSHIP_COACH', [role]);
  const isSelfRegisterRole = useMemo(
    () => !!role && SELF_REGISTER_ROLES.includes(role as Role),
    [role]
  );
  const isOutsideCoach = useMemo(() => role === 'OUTSIDE_COACH', [role]);

  const canSubmit =
    !!fullName.trim() &&
    !!email.trim() &&
    !!role &&
    !isSelfRegisterRole &&
    !isOutsideCoach &&
    (!needsLocation || !!locationId) &&
    (!needsSchool || !!schoolTeamId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !role) return;

    setSaving(true);
    try {
      await api.inviteStaffV2({
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim() || undefined,
        role,
        locationId: needsLocation ? locationId : undefined,
        schoolTeamId: needsSchool ? schoolTeamId : undefined,
      });
      toast.success(`Invitation sent to ${fullName.trim()} as ${ROLE_LABELS[role as Role]}`);
      setFullName('');
      setEmail('');
      setPhone('');
      setRole('');
      setLocationId('');
      setSchoolTeamId('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send invite');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="ppl-card animate-pulse h-20" />
        <div className="ppl-card animate-pulse h-60" />
      </div>
    );
  }

  return (
    <main className="ppl-page-root">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        <Link href="/admin" className="text-sm text-muted hover:text-foreground">
          ← Admin
        </Link>
        <div className="mt-4 mb-6">
          <h1 className="font-display text-2xl sm:text-3xl uppercase tracking-[0.04em] text-foreground">
            Invite staff
          </h1>
          <p className="text-sm text-muted mt-1">
            Send a role-specific invitation. The recipient gets an email tailored to their
            role and a link to set a password.
          </p>
          <p className="text-xs text-muted mt-2">
            Inviting a regular Performance Coach or Coordinator with multiple locations?
            Use the{' '}
            <Link href="/admin/staff" className="text-accent-text hover:brightness-110 underline">
              /admin/staff page
            </Link>{' '}
            instead — it has a nicer multi-location grid for the legacy flow.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="ppl-card space-y-5">
          {/* Name + email */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="ppl-label">Full name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="ppl-input w-full"
                placeholder="Jane Smith"
                required
              />
            </div>
            <div>
              <label className="ppl-label">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="ppl-input w-full"
                placeholder="jane@example.com"
                required
              />
            </div>
          </div>

          <div>
            <label className="ppl-label">Phone (optional)</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="ppl-input w-full"
              placeholder="(555) 123-4567"
            />
          </div>

          {/* Role dropdown */}
          <div>
            <label className="ppl-label">Role</label>
            <select
              value={role}
              onChange={(e) => {
                setRole(e.target.value as Role);
                setLocationId('');
                setSchoolTeamId('');
              }}
              className="ppl-input w-full"
              required
            >
              <option value="">Select a role…</option>
              {invitableRoles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r] ?? r}
                </option>
              ))}
            </select>
            {role && (
              <p className="text-xs text-muted mt-1.5">{ROLE_DESCRIPTIONS[role as Role]}</p>
            )}
          </div>

          {/* Conditional scope picker */}
          {needsLocation && (
            <div>
              <label className="ppl-label">Location</label>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="ppl-input w-full"
                required
              >
                <option value="">Select a location…</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {needsSchool && (
            <div>
              <label className="ppl-label">Partner school</label>
              {schools.length === 0 ? (
                <p className="text-xs text-muted">
                  No partner schools yet. Create one from the{' '}
                  <Link href="/admin/schools" className="text-accent-text underline">
                    schools page
                  </Link>{' '}
                  first.
                </p>
              ) : (
                <select
                  value={schoolTeamId}
                  onChange={(e) => setSchoolTeamId(e.target.value)}
                  className="ppl-input w-full"
                  required
                >
                  <option value="">Select a school…</option>
                  {schools.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.type.replace('_', ' ').toLowerCase()})
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {isSelfRegisterRole && (
            <div className="p-3 rounded-lg bg-surface border border-border text-sm text-muted">
              Parents and athletes should register themselves at{' '}
              <Link href="/register" className="text-accent-text underline">
                /register
              </Link>
              . Invite flow for these roles ships in a follow-up commit — for now use the
              main signup page to create these accounts.
            </div>
          )}

          {isOutsideCoach && (
            <div className="p-3 rounded-lg bg-surface border border-border text-sm text-muted">
              Outside coaches are linked to specific athletes, not invited directly. Add
              them via the athlete&rsquo;s profile page (in a follow-up commit) so we can
              capture the coach type (rec ball / travel / HS / etc.) at the same time.
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={!canSubmit || saving}
              className="ppl-btn ppl-btn-primary disabled:opacity-60"
            >
              {saving ? 'Sending…' : 'Send invitation'}
            </button>
          </div>
        </form>

        <div className="mt-6 ppl-card">
          <h3 className="font-display text-sm uppercase tracking-[0.04em] text-foreground mb-2">
            Who can invite whom
          </h3>
          <ul className="text-xs text-muted space-y-1.5 list-disc pl-5">
            <li>Admin → anyone, any scope</li>
            <li>Coordinator → anyone at their location (including Medical)</li>
            <li>
              Performance Coach → other Coaches, Content & Marketing, Outside Coach,
              Parent, Athlete (at their location)
            </li>
            <li>Medical Admin → Medical, Parent, Athlete</li>
            <li>Content & Marketing Admin → Content & Marketing</li>
            <li>Partnership Coach → Athletes on their partner school only</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
