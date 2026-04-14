'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, Location, MembershipPlan, User } from '@/lib/api';

type SettingsTab = 'general' | 'plans' | 'staff' | 'integrations';

export default function AdminSettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  const tabs: { key: SettingsTab; label: string }[] = [
    { key: 'general', label: 'General' },
    { key: 'plans', label: 'Membership Plans' },
    { key: 'staff', label: 'Staff' },
    { key: 'integrations', label: 'Integrations' },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted mt-0.5">Configure PPL system settings</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-surface rounded-lg p-1 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              activeTab === tab.key
                ? 'bg-ppl-dark-green/20 text-ppl-light-green'
                : 'text-muted hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'general' && <GeneralSettings />}
      {activeTab === 'plans' && <PlanSettings />}
      {activeTab === 'staff' && <StaffSettings />}
      {activeTab === 'integrations' && <IntegrationSettings />}
    </div>
  );
}

/* ─── General Settings ─── */
function GeneralSettings() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [defaults, setDefaults] = useState({
    defaultCapacity: 8,
    registrationCutoffHours: 1,
    cancellationCutoffHours: 6,
    sessionDurationMinutes: 60,
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.getLocations();
        if (res.data) setLocations(res.data);
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const handleSave = () => {
    // These would persist to a settings endpoint in production
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (isLoading) {
    return <div className="ppl-card animate-pulse h-48" />;
  }

  return (
    <div className="space-y-6">
      {/* Session Defaults */}
      <div className="ppl-card">
        <h2 className="text-lg font-bold text-foreground mb-1">Session Defaults</h2>
        <p className="text-sm text-muted mb-4">
          Default values when creating new sessions. These can be overridden per session.
        </p>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-muted block mb-1">Default Max Capacity</label>
            <input
              type="number"
              value={defaults.defaultCapacity}
              onChange={(e) => setDefaults({ ...defaults, defaultCapacity: parseInt(e.target.value) || 0 })}
              className="ppl-input"
              min={1}
              max={50}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted block mb-1">Session Duration (minutes)</label>
            <input
              type="number"
              value={defaults.sessionDurationMinutes}
              onChange={(e) =>
                setDefaults({ ...defaults, sessionDurationMinutes: parseInt(e.target.value) || 0 })
              }
              className="ppl-input"
              min={15}
              step={15}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted block mb-1">Registration Cutoff (hours before)</label>
            <input
              type="number"
              value={defaults.registrationCutoffHours}
              onChange={(e) =>
                setDefaults({ ...defaults, registrationCutoffHours: parseInt(e.target.value) || 0 })
              }
              className="ppl-input"
              min={0}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted block mb-1">Cancellation Cutoff (hours before)</label>
            <input
              type="number"
              value={defaults.cancellationCutoffHours}
              onChange={(e) =>
                setDefaults({ ...defaults, cancellationCutoffHours: parseInt(e.target.value) || 0 })
              }
              className="ppl-input"
              min={0}
            />
          </div>
        </div>

        <button onClick={handleSave} className="ppl-btn ppl-btn-primary text-sm mt-4">
          {saved ? 'Saved!' : 'Save Defaults'}
        </button>
      </div>

      {/* Location Overview */}
      <div className="ppl-card">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-bold text-foreground">Locations</h2>
            <p className="text-sm text-muted">Quick view of your facilities</p>
          </div>
          <a href="/admin/locations" className="text-sm text-ppl-light-green hover:underline">
            Manage Locations &rarr;
          </a>
        </div>
        <div className="space-y-2">
          {locations.map((loc) => (
            <div key={loc.id} className="flex items-center justify-between p-3 bg-background rounded-lg">
              <div>
                <p className="font-semibold text-foreground text-sm">{loc.name}</p>
                {loc.address && <p className="text-xs text-muted">{loc.address}</p>}
              </div>
              <div className="text-right">
                <p className="text-xs text-muted">{loc.rooms?.length || 0} rooms</p>
                <p className="text-xs text-muted">{loc.timezone || 'America/Chicago'}</p>
              </div>
            </div>
          ))}
          {locations.length === 0 && (
            <p className="text-sm text-muted text-center py-4">No locations configured</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Membership Plan Settings ─── */
function PlanSettings() {
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<MembershipPlan | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadPlans = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.getMembershipPlans();
      if (res.data) setPlans(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  const AGE_GROUP_LABELS: Record<string, string> = {
    college: 'College',
    ms_hs: '13+ (MS/HS)',
    youth: 'Youth',
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((n) => <div key={n} className="ppl-card animate-pulse h-20" />)}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted">
          {plans.length} plan{plans.length !== 1 ? 's' : ''} configured
        </p>
        <button onClick={() => setShowCreateModal(true)} className="ppl-btn ppl-btn-primary text-sm">
          + New Plan
        </button>
      </div>

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

      {/* Group by age group */}
      {Object.entries(
        plans.reduce<Record<string, MembershipPlan[]>>((groups, plan) => {
          const g = plan.ageGroup;
          if (!groups[g]) groups[g] = [];
          groups[g].push(plan);
          return groups;
        }, {})
      ).map(([ageGroup, groupPlans]) => (
        <div key={ageGroup} className="mb-6">
          <h3 className="text-sm font-semibold text-muted uppercase tracking-wider mb-3">
            {AGE_GROUP_LABELS[ageGroup] || ageGroup}
          </h3>
          <div className="space-y-2">
            {groupPlans.map((plan) => (
              <div key={plan.id} className="ppl-card flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h4 className="font-semibold text-foreground">{plan.name}</h4>
                    <span className={`ppl-badge text-xs ${plan.isActive ? 'ppl-badge-active' : 'ppl-badge-warning'}`}>
                      {plan.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-sm text-muted mt-0.5">
                    {plan.sessionsPerWeek === null
                      ? 'Unlimited sessions'
                      : `${plan.sessionsPerWeek} session${plan.sessionsPerWeek > 1 ? 's' : ''}/week`}
                    {plan.description && ` — ${plan.description}`}
                  </p>
                </div>
                <div className="flex items-center gap-4 ml-4">
                  <div className="text-right">
                    <p className="text-lg font-bold text-ppl-light-green">
                      ${(plan.priceCents / 100).toFixed(0)}
                    </p>
                    <p className="text-xs text-muted">/{plan.billingCycle}</p>
                  </div>
                  <button
                    onClick={() => setEditingPlan(plan)}
                    className="ppl-btn ppl-btn-secondary text-xs"
                  >
                    Edit
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {plans.length === 0 && (
        <div className="ppl-card text-center py-8">
          <p className="text-muted">No membership plans yet. Create your first one above.</p>
        </div>
      )}

      {/* Create/Edit Plan Modal */}
      {(showCreateModal || editingPlan) && (
        <PlanModal
          plan={editingPlan || undefined}
          onClose={() => {
            setShowCreateModal(false);
            setEditingPlan(null);
          }}
          onSaved={() => {
            setShowCreateModal(false);
            setEditingPlan(null);
            setMessage({ type: 'success', text: editingPlan ? 'Plan updated!' : 'Plan created!' });
            loadPlans();
          }}
        />
      )}
    </div>
  );
}

function PlanModal({
  plan,
  onClose,
  onSaved,
}: {
  plan?: MembershipPlan;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: plan?.name || '',
    slug: plan?.slug || '',
    ageGroup: plan?.ageGroup || 'college',
    sessionsPerWeek: plan?.sessionsPerWeek ?? '',
    priceCents: plan ? (plan.priceCents / 100).toString() : '',
    billingCycle: plan?.billingCycle || 'WEEKLY',
    description: plan?.description || '',
    isActive: plan?.isActive ?? true,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Plan name is required'); return; }
    if (!form.priceCents) { setError('Price is required'); return; }

    setIsSubmitting(true);
    setError('');

    const payload = {
      name: form.name,
      slug: form.slug || form.name.toLowerCase().replace(/\s+/g, '-'),
      ageGroup: form.ageGroup,
      sessionsPerWeek: form.sessionsPerWeek === '' || form.sessionsPerWeek === 'unlimited'
        ? null
        : Number(form.sessionsPerWeek),
      priceCents: Math.round(parseFloat(form.priceCents) * 100),
      billingCycle: form.billingCycle,
      description: form.description || null,
      isActive: form.isActive,
    };

    try {
      if (plan) {
        await api.updateMembershipPlan(plan.id, payload);
      } else {
        await api.createMembershipPlan(payload);
      }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save plan');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="ppl-card w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-foreground">
            {plan ? 'Edit Plan' : 'New Membership Plan'}
          </h2>
          <button onClick={onClose} className="text-muted hover:text-foreground text-xl">&times;</button>
        </div>
        {error && (
          <div className="mb-3 p-2 bg-danger/10 border border-danger/20 rounded-lg text-sm text-danger">{error}</div>
        )}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted block mb-1">Plan Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="ppl-input"
              placeholder="College 3x/Week"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted block mb-1">Age Group</label>
              <select
                value={form.ageGroup}
                onChange={(e) => setForm({ ...form, ageGroup: e.target.value })}
                className="ppl-input"
              >
                <option value="college">College</option>
                <option value="ms_hs">13+ (MS/HS)</option>
                <option value="youth">Youth</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted block mb-1">Sessions per Week</label>
              <select
                value={form.sessionsPerWeek === null || form.sessionsPerWeek === '' ? 'unlimited' : form.sessionsPerWeek.toString()}
                onChange={(e) =>
                  setForm({
                    ...form,
                    sessionsPerWeek: e.target.value === 'unlimited' ? '' : e.target.value,
                  })
                }
                className="ppl-input"
              >
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5</option>
                <option value="unlimited">Unlimited</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted block mb-1">Price ($)</label>
              <input
                type="number"
                value={form.priceCents}
                onChange={(e) => setForm({ ...form, priceCents: e.target.value })}
                className="ppl-input"
                placeholder="75"
                min={0}
                step={1}
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted block mb-1">Billing Cycle</label>
              <select
                value={form.billingCycle}
                onChange={(e) => setForm({ ...form, billingCycle: e.target.value })}
                className="ppl-input"
              >
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted block mb-1">Description (optional)</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="ppl-input"
              placeholder="Best for committed athletes"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="planActive"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              className="rounded border-border"
            />
            <label htmlFor="planActive" className="text-sm text-foreground">Active (visible to clients)</label>
          </div>
          <button type="submit" disabled={isSubmitting} className="ppl-btn ppl-btn-primary w-full justify-center">
            {isSubmitting ? 'Saving...' : plan ? 'Update Plan' : 'Create Plan'}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ─── Staff Settings ─── */
function StaffSettings() {
  const [staff, setStaff] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.getStaffList();
        if (res.data) setStaff(res.data);
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((n) => <div key={n} className="ppl-card animate-pulse h-16" />)}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted">
          {staff.length} staff member{staff.length !== 1 ? 's' : ''}
        </p>
        <button onClick={() => setShowInviteModal(true)} className="ppl-btn ppl-btn-primary text-sm">
          + Invite Staff
        </button>
      </div>

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

      <div className="space-y-2">
        {staff.map((member) => (
          <div key={member.id} className="ppl-card flex items-center gap-4">
            <div className="w-10 h-10 rounded-full ppl-gradient flex items-center justify-center text-sm font-bold text-white">
              {member.fullName.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-foreground text-sm">{member.fullName}</p>
                <span className={`ppl-badge text-xs ${member.role === 'ADMIN' ? 'ppl-badge-active' : 'ppl-badge-warning'}`}>
                  {member.role}
                </span>
              </div>
              <p className="text-xs text-muted">{member.email}</p>
              {member.locations && member.locations.length > 0 && (
                <p className="text-xs text-muted mt-0.5">
                  {member.locations.map((l: any) => l.name).join(', ')}
                </p>
              )}
            </div>
          </div>
        ))}
        {staff.length === 0 && (
          <div className="ppl-card text-center py-8">
            <p className="text-muted">No staff members yet. Invite your first coach above.</p>
          </div>
        )}
      </div>

      {showInviteModal && (
        <InviteStaffModal
          onClose={() => setShowInviteModal(false)}
          onInvited={() => {
            setShowInviteModal(false);
            setMessage({ type: 'success', text: 'Staff member invited!' });
            // Reload
            api.getStaffList().then((res) => { if (res.data) setStaff(res.data); });
          }}
        />
      )}
    </div>
  );
}

function InviteStaffModal({
  onClose,
  onInvited,
}: {
  onClose: () => void;
  onInvited: () => void;
}) {
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    role: 'STAFF' as 'STAFF' | 'ADMIN',
    phone: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.fullName.trim() || !form.email.trim() || !form.password) {
      setError('Name, email, and password are required');
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      await api.inviteStaff(form);
      onInvited();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to invite staff');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="ppl-card w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-foreground">Invite Staff</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground text-xl">&times;</button>
        </div>
        {error && (
          <div className="mb-3 p-2 bg-danger/10 border border-danger/20 rounded-lg text-sm text-danger">{error}</div>
        )}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted block mb-1">Full Name</label>
            <input
              type="text"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              className="ppl-input"
              placeholder="Coach Mike"
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted block mb-1">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="ppl-input"
              placeholder="coach@pitchingperformancelab.com"
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted block mb-1">Temporary Password</label>
            <input
              type="text"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="ppl-input"
              placeholder="They can change this after first login"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted block mb-1">Role</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as 'STAFF' | 'ADMIN' })}
                className="ppl-input"
              >
                <option value="STAFF">Staff / Coach</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted block mb-1">Phone (optional)</label>
              <input
                type="text"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="ppl-input"
                placeholder="(214) 555-0100"
              />
            </div>
          </div>
          <button type="submit" disabled={isSubmitting} className="ppl-btn ppl-btn-primary w-full justify-center">
            {isSubmitting ? 'Inviting...' : 'Send Invite'}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ─── Integration Settings ─── */
function IntegrationSettings() {
  const [stripeConnected, setStripeConnected] = useState<boolean | null>(null);

  useEffect(() => {
    // Check if Stripe keys are configured by seeing if the env var is set
    const pk = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    setStripeConnected(!!pk && pk.length > 0);
  }, []);

  const integrations = [
    {
      name: 'Stripe',
      description: 'Payment processing for memberships and billing',
      connected: stripeConnected,
      icon: (
        <svg className="w-8 h-8" viewBox="0 0 24 24" fill="currentColor">
          <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z" />
        </svg>
      ),
    },
    {
      name: 'Email (SMTP)',
      description: 'Transactional emails for notifications and receipts',
      connected: null, // Server-side only, can't check from client
      icon: (
        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
        </svg>
      ),
    },
    {
      name: 'Twilio (SMS)',
      description: 'Text message notifications and reminders',
      connected: null,
      icon: (
        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
        </svg>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {integrations.map((integration) => (
        <div key={integration.name} className="ppl-card flex items-center gap-4">
          <div className="text-muted">{integration.icon}</div>
          <div className="flex-1">
            <h3 className="font-semibold text-foreground">{integration.name}</h3>
            <p className="text-sm text-muted">{integration.description}</p>
          </div>
          <div>
            {integration.connected === true ? (
              <span className="ppl-badge ppl-badge-active">Connected</span>
            ) : integration.connected === false ? (
              <span className="ppl-badge ppl-badge-danger">Not Configured</span>
            ) : (
              <span className="ppl-badge ppl-badge-warning">Server-Side</span>
            )}
          </div>
        </div>
      ))}

      <div className="ppl-card bg-background">
        <h3 className="font-semibold text-foreground mb-2">Environment Variables</h3>
        <p className="text-sm text-muted mb-3">
          Integration credentials are configured via environment variables on the server. Update your{' '}
          <code className="text-ppl-light-green bg-surface px-1.5 py-0.5 rounded text-xs">.env</code>{' '}
          file to connect services.
        </p>
        <div className="bg-surface rounded-lg p-3 font-mono text-xs text-muted space-y-1">
          <p># Stripe</p>
          <p>STRIPE_SECRET_KEY=sk_test_...</p>
          <p>NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...</p>
          <p>STRIPE_WEBHOOK_SECRET=whsec_...</p>
          <p className="mt-2"># Email (SMTP)</p>
          <p>SMTP_HOST=smtp.gmail.com</p>
          <p>SMTP_PORT=587</p>
          <p>SMTP_USER=your@email.com</p>
          <p>SMTP_PASS=app-password</p>
          <p className="mt-2"># Twilio (SMS)</p>
          <p>TWILIO_ACCOUNT_SID=AC...</p>
          <p>TWILIO_AUTH_TOKEN=...</p>
          <p>TWILIO_FROM_NUMBER=+1...</p>
        </div>
      </div>
    </div>
  );
}
