'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, Location, MembershipPlan, StaffMember, User, SessionTypeConfig, SessionTypeConfigInput } from '@/lib/api';

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

  // Branding state
  const [branding, setBranding] = useState({
    businessName: 'Pitching Performance Lab',
    tagline: 'Train like a pro.',
    logoUrl: '',
    primaryColor: '#166534', // ppl-dark-green
    accentColor: '#4ade80', // ppl-light-green
  });
  const [brandSaved, setBrandSaved] = useState(false);

  const handleBrandSave = () => {
    // These would persist to a settings endpoint in production
    setBrandSaved(true);
    setTimeout(() => setBrandSaved(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Branding */}
      <div className="ppl-card">
        <h2 className="text-lg font-bold text-foreground mb-1">Branding</h2>
        <p className="text-sm text-muted mb-4">
          Customize your business name, logo, and brand colors. These appear throughout the app and client-facing pages.
        </p>

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 sm:col-span-1">
            <label className="text-xs font-medium text-muted block mb-1">Business Name</label>
            <input
              type="text"
              value={branding.businessName}
              onChange={(e) => setBranding({ ...branding, businessName: e.target.value })}
              className="ppl-input"
            />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="text-xs font-medium text-muted block mb-1">Tagline</label>
            <input
              type="text"
              value={branding.tagline}
              onChange={(e) => setBranding({ ...branding, tagline: e.target.value })}
              className="ppl-input"
              placeholder="Short tagline or motto"
            />
          </div>
          <div className="col-span-2">
            <label className="text-xs font-medium text-muted block mb-1">Logo URL</label>
            <input
              type="url"
              value={branding.logoUrl}
              onChange={(e) => setBranding({ ...branding, logoUrl: e.target.value })}
              className="ppl-input"
              placeholder="https://yourdomain.com/logo.png"
            />
            {branding.logoUrl && (
              <div className="mt-2 p-3 bg-background rounded-lg inline-block">
                <img src={branding.logoUrl} alt="Logo preview" className="max-h-12 object-contain" />
              </div>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-muted block mb-1">Primary Color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={branding.primaryColor}
                onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })}
                className="w-8 h-8 rounded border-none cursor-pointer"
              />
              <input
                type="text"
                value={branding.primaryColor}
                onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })}
                className="ppl-input text-xs flex-1"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted block mb-1">Accent Color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={branding.accentColor}
                onChange={(e) => setBranding({ ...branding, accentColor: e.target.value })}
                className="w-8 h-8 rounded border-none cursor-pointer"
              />
              <input
                type="text"
                value={branding.accentColor}
                onChange={(e) => setBranding({ ...branding, accentColor: e.target.value })}
                className="ppl-input text-xs flex-1"
              />
            </div>
          </div>
        </div>

        <button onClick={handleBrandSave} className="ppl-btn ppl-btn-primary text-sm mt-4">
          {brandSaved ? 'Saved!' : 'Save Branding'}
        </button>
      </div>

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

      {/* Session Type Configs */}
      <SessionTypeConfigPanel locations={locations} />

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

/* ─── Session Type Config Panel ─── */
function SessionTypeConfigPanel({ locations }: { locations: Location[] }) {
  const [configs, setConfigs] = useState<SessionTypeConfig[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [hasChanges, setHasChanges] = useState(false);

  // Auto-select first location
  useEffect(() => {
    if (locations.length > 0 && !selectedLocation) {
      setSelectedLocation(locations[0].id);
    }
  }, [locations, selectedLocation]);

  // Load configs when location changes
  useEffect(() => {
    if (!selectedLocation) return;
    setIsLoading(true);
    api.getSessionTypeConfigs(selectedLocation).then((res: any) => {
      if (res.data) setConfigs(res.data);
    }).catch(console.error).finally(() => setIsLoading(false));
  }, [selectedLocation]);

  const updateConfig = (idx: number, field: string, value: any) => {
    setConfigs((prev) => prev.map((c, i) => i === idx ? { ...c, [field]: value } : c));
    setHasChanges(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: SessionTypeConfigInput[] = configs.map((c) => ({
        sessionType: c.sessionType,
        label: c.label,
        maxCapacity: c.maxCapacity,
        durationMinutes: c.durationMinutes,
        registrationCutoffHours: c.registrationCutoffHours,
        cancellationCutoffHours: c.cancellationCutoffHours,
        color: c.color,
        isActive: c.isActive,
      }));
      await api.updateSessionTypeConfigs(selectedLocation, payload);
      setSaveMsg('Saved!');
      setHasChanges(false);
      setTimeout(() => setSaveMsg(''), 2000);
    } catch (err) {
      console.error(err);
      setSaveMsg('Error saving');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ppl-card">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-bold text-foreground">Session Type Presets</h2>
        {locations.length > 1 && (
          <select
            value={selectedLocation}
            onChange={(e) => setSelectedLocation(e.target.value)}
            className="ppl-input text-xs w-48"
          >
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>{loc.name}</option>
            ))}
          </select>
        )}
      </div>
      <p className="text-sm text-muted mb-4">
        Default capacity, duration, and cutoffs for each session type. These auto-fill when creating new sessions.
      </p>

      {isLoading ? (
        <div className="animate-pulse h-32 bg-background rounded-lg" />
      ) : (
        <div className="space-y-3">
          {configs.map((cfg, idx) => (
            <div
              key={cfg.sessionType}
              className={`p-4 rounded-lg border transition-all ${
                cfg.isActive
                  ? 'bg-background border-border'
                  : 'bg-background/50 border-border/50 opacity-60'
              }`}
            >
              <div className="flex items-center gap-3 mb-3">
                {/* Color dot */}
                <input
                  type="color"
                  value={cfg.color || '#6B7280'}
                  onChange={(e) => updateConfig(idx, 'color', e.target.value)}
                  className="w-6 h-6 rounded-full border-none cursor-pointer"
                  title="Calendar color"
                />
                {/* Label */}
                <input
                  type="text"
                  value={cfg.label}
                  onChange={(e) => updateConfig(idx, 'label', e.target.value)}
                  className="ppl-input text-sm font-semibold flex-1"
                />
                {/* Active toggle */}
                <button
                  onClick={() => updateConfig(idx, 'isActive', !cfg.isActive)}
                  className={`text-xs px-2 py-1 rounded-md font-medium ${
                    cfg.isActive
                      ? 'bg-ppl-dark-green/20 text-ppl-light-green'
                      : 'bg-red-500/10 text-red-400'
                  }`}
                >
                  {cfg.isActive ? 'Active' : 'Disabled'}
                </button>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-muted block mb-0.5">Max Capacity</label>
                  <input
                    type="number"
                    value={cfg.maxCapacity}
                    onChange={(e) => updateConfig(idx, 'maxCapacity', parseInt(e.target.value) || 1)}
                    className="ppl-input text-sm"
                    min={1}
                    max={50}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted block mb-0.5">Duration (min)</label>
                  <input
                    type="number"
                    value={cfg.durationMinutes}
                    onChange={(e) => updateConfig(idx, 'durationMinutes', parseInt(e.target.value) || 15)}
                    className="ppl-input text-sm"
                    min={15}
                    step={15}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted block mb-0.5">Reg. Cutoff (hrs)</label>
                  <input
                    type="number"
                    value={cfg.registrationCutoffHours}
                    onChange={(e) => updateConfig(idx, 'registrationCutoffHours', parseInt(e.target.value) || 0)}
                    className="ppl-input text-sm"
                    min={0}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted block mb-0.5">Cancel Cutoff (hrs)</label>
                  <input
                    type="number"
                    value={cfg.cancellationCutoffHours}
                    onChange={(e) => updateConfig(idx, 'cancellationCutoffHours', parseInt(e.target.value) || 0)}
                    className="ppl-input text-sm"
                    min={0}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {hasChanges && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="ppl-btn ppl-btn-primary text-sm mt-4"
        >
          {saving ? 'Saving...' : saveMsg || 'Save Session Type Presets'}
        </button>
      )}
      {saveMsg && !hasChanges && (
        <p className="text-xs text-ppl-light-green mt-2">{saveMsg}</p>
      )}
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
const LOCATION_ROLES = ['OWNER', 'COORDINATOR', 'COACH'] as const;
type LocRole = typeof LOCATION_ROLES[number];

function roleLabel(role: LocRole): string {
  const labels: Record<LocRole, string> = {
    OWNER: 'Owner',
    COORDINATOR: 'Coordinator',
    COACH: 'Coach',
  };
  return labels[role] || role;
}

function roleDescription(role: LocRole): string {
  const desc: Record<LocRole, string> = {
    OWNER: 'Full access — revenue, settings, manage staff',
    COORDINATOR: 'Revenue, member data, payment statuses',
    COACH: 'Schedule and assigned clients only',
  };
  return desc[role] || '';
}

function StaffSettings() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [expandedStaff, setExpandedStaff] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Draft permissions per staff member: { [staffId]: { [locationId]: LocRole | null } }
  const [drafts, setDrafts] = useState<Record<string, Record<string, LocRole | null>>>({});

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [staffRes, locRes] = await Promise.all([api.getStaffList(), api.getLocations()]);
      if (staffRes.data) setStaff(staffRes.data);
      if (locRes.data) setLocations(locRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Build a draft map for a given staff member from their current locations
  function buildDraft(member: StaffMember): Record<string, LocRole | null> {
    const map: Record<string, LocRole | null> = {};
    for (const loc of locations) {
      const existing = member.locations.find((l) => l.id === loc.id);
      map[loc.id] = existing?.locationRole as LocRole || null;
    }
    return map;
  }

  function toggleExpand(memberId: string) {
    if (expandedStaff === memberId) {
      setExpandedStaff(null);
      return;
    }
    setExpandedStaff(memberId);
    const member = staff.find((s) => s.id === memberId);
    if (member && !drafts[memberId]) {
      setDrafts((prev) => ({ ...prev, [memberId]: buildDraft(member) }));
    }
  }

  function updateDraft(staffId: string, locationId: string, role: LocRole | null) {
    setDrafts((prev) => ({
      ...prev,
      [staffId]: { ...(prev[staffId] || {}), [locationId]: role },
    }));
  }

  async function savePermissions(memberId: string) {
    const draft = drafts[memberId];
    if (!draft) return;

    const assignments = Object.entries(draft)
      .filter(([, role]) => role !== null)
      .map(([locationId, locationRole]) => ({ locationId, locationRole: locationRole as string }));

    setSavingId(memberId);
    try {
      await api.updateStaffLocations(memberId, assignments);
      setMessage({ type: 'success', text: 'Permissions saved!' });
      await loadData();
      // Rebuild draft with fresh data
      const freshRes = await api.getStaffList();
      if (freshRes.data) {
        const freshMember = freshRes.data.find((s: StaffMember) => s.id === memberId);
        if (freshMember) {
          setDrafts((prev) => ({ ...prev, [memberId]: buildDraft(freshMember) }));
        }
      }
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save' });
    } finally {
      setSavingId(null);
    }
  }

  // Check if draft differs from current state
  function hasChanges(memberId: string): boolean {
    const draft = drafts[memberId];
    const member = staff.find((s) => s.id === memberId);
    if (!draft || !member) return false;
    for (const loc of locations) {
      const current = member.locations.find((l) => l.id === loc.id)?.locationRole || null;
      const draftVal = draft[loc.id] || null;
      if (current !== draftVal) return true;
    }
    return false;
  }

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
          {staff.length} staff member{staff.length !== 1 ? 's' : ''} · {locations.length} location{locations.length !== 1 ? 's' : ''}
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
        {staff.map((member) => {
          const isExpanded = expandedStaff === member.id;
          const draft = drafts[member.id] || {};
          const changed = hasChanges(member.id);

          return (
            <div key={member.id} className="ppl-card">
              {/* Staff header row */}
              <div
                className="flex items-center gap-4 cursor-pointer"
                onClick={() => toggleExpand(member.id)}
              >
                <div className="w-10 h-10 rounded-full ppl-gradient flex items-center justify-center text-sm font-bold text-white shrink-0">
                  {member.fullName.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-foreground text-sm truncate">{member.fullName}</p>
                    <span className={`ppl-badge text-xs ${member.role === 'ADMIN' ? 'ppl-badge-active' : 'ppl-badge-warning'}`}>
                      {member.role}
                    </span>
                  </div>
                  <p className="text-xs text-muted">{member.email}</p>
                  {member.locations.length > 0 && (
                    <p className="text-xs text-muted mt-0.5">
                      {member.locations.map((l) => `${l.name} (${roleLabel(l.locationRole as LocRole || 'COACH')})`).join(' · ')}
                    </p>
                  )}
                </div>
                <span className="text-muted text-lg">{isExpanded ? '▾' : '▸'}</span>
              </div>

              {/* Expanded: Access control grid */}
              {isExpanded && (
                <div className="mt-4 pt-4 border-t border-surface">
                  <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">
                    Location Access
                  </p>

                  {locations.length === 0 ? (
                    <p className="text-xs text-muted">No locations configured. Add locations first.</p>
                  ) : (
                    <div className="space-y-3">
                      {locations.map((loc) => {
                        const currentRole = draft[loc.id] || null;
                        return (
                          <div key={loc.id} className="bg-background rounded-lg p-3">
                            <p className="font-semibold text-foreground text-sm mb-2">{loc.name}</p>
                            <div className="flex flex-wrap gap-2">
                              {/* No Access option */}
                              <button
                                type="button"
                                onClick={() => updateDraft(member.id, loc.id, null)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                  currentRole === null
                                    ? 'bg-surface text-foreground ring-1 ring-muted'
                                    : 'bg-background text-muted hover:bg-surface/50'
                                }`}
                              >
                                No Access
                              </button>
                              {LOCATION_ROLES.map((role) => (
                                <button
                                  key={role}
                                  type="button"
                                  onClick={() => updateDraft(member.id, loc.id, role)}
                                  title={roleDescription(role)}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                    currentRole === role
                                      ? role === 'OWNER'
                                        ? 'bg-ppl-dark-green text-white'
                                        : role === 'COORDINATOR'
                                        ? 'bg-ppl-light-green/20 text-ppl-light-green ring-1 ring-ppl-light-green/30'
                                        : 'bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/30'
                                      : 'bg-background text-muted hover:bg-surface/50'
                                  }`}
                                >
                                  {roleLabel(role)}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Save button */}
                  {locations.length > 0 && (
                    <div className="mt-4 flex items-center justify-between">
                      <p className="text-[10px] text-muted">
                        Owner = full access · Coordinator = revenue &amp; members · Coach = schedule only
                      </p>
                      <button
                        onClick={() => savePermissions(member.id)}
                        disabled={!changed || savingId === member.id}
                        className={`ppl-btn text-xs ${
                          changed ? 'ppl-btn-primary' : 'ppl-btn-secondary opacity-50 cursor-not-allowed'
                        }`}
                      >
                        {savingId === member.id ? 'Saving...' : 'Save Permissions'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {staff.length === 0 && (
          <div className="ppl-card text-center py-8">
            <p className="text-muted">No staff members yet. Invite your first coach above.</p>
          </div>
        )}
      </div>

      {showInviteModal && (
        <InviteStaffModal
          locations={locations}
          onClose={() => setShowInviteModal(false)}
          onInvited={() => {
            setShowInviteModal(false);
            setMessage({ type: 'success', text: 'Staff member invited!' });
            loadData();
          }}
        />
      )}
    </div>
  );
}

function InviteStaffModal({
  locations,
  onClose,
  onInvited,
}: {
  locations: Location[];
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
  // Location assignments during invite: { [locationId]: LocRole }
  const [locationAssignments, setLocationAssignments] = useState<Record<string, LocRole>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  function toggleLocation(locationId: string, role: LocRole | null) {
    setLocationAssignments((prev) => {
      const next = { ...prev };
      if (role === null) {
        delete next[locationId];
      } else {
        next[locationId] = role;
      }
      return next;
    });
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.fullName.trim() || !form.email.trim() || !form.password) {
      setError('Name, email, and password are required');
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      // Step 1: Create the staff account
      const res = await api.inviteStaff(form);

      // Step 2: If locations were assigned, save them
      const assignments = Object.entries(locationAssignments).map(([locationId, locationRole]) => ({
        locationId,
        locationRole,
      }));
      if (assignments.length > 0 && res.data?.id) {
        await api.updateStaffLocations(res.data.id, assignments);
      }

      onInvited();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to invite staff');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 overflow-y-auto">
      <div className="ppl-card w-full max-w-lg my-8">
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
              <label className="text-xs font-medium text-muted block mb-1">Global Role</label>
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

          {/* Location Access during invite */}
          {locations.length > 0 && (
            <div>
              <label className="text-xs font-medium text-muted block mb-2">Location Access</label>
              <div className="space-y-2">
                {locations.map((loc) => {
                  const currentRole = locationAssignments[loc.id] || null;
                  return (
                    <div key={loc.id} className="bg-background rounded-lg p-3">
                      <p className="font-semibold text-foreground text-xs mb-1.5">{loc.name}</p>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggleLocation(loc.id, null)}
                          className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                            currentRole === null
                              ? 'bg-surface text-foreground ring-1 ring-muted'
                              : 'bg-background text-muted hover:bg-surface/50'
                          }`}
                        >
                          No Access
                        </button>
                        {LOCATION_ROLES.map((role) => (
                          <button
                            key={role}
                            type="button"
                            onClick={() => toggleLocation(loc.id, role)}
                            className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                              currentRole === role
                                ? role === 'OWNER'
                                  ? 'bg-ppl-dark-green text-white'
                                  : role === 'COORDINATOR'
                                  ? 'bg-ppl-light-green/20 text-ppl-light-green ring-1 ring-ppl-light-green/30'
                                  : 'bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/30'
                                : 'bg-background text-muted hover:bg-surface/50'
                            }`}
                          >
                            {roleLabel(role)}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted mt-1">You can also configure this later from the staff list.</p>
            </div>
          )}

          <button type="submit" disabled={isSubmitting} className="ppl-btn ppl-btn-primary w-full justify-center">
            {isSubmitting ? 'Creating Account...' : 'Create & Invite'}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ─── Integration Settings ─── */
type HealthStatus = 'checking' | 'connected' | 'error' | 'not_configured';
interface IntegrationHealth {
  stripe: { status: HealthStatus; message?: string };
  email: { status: HealthStatus; message?: string };
  twilio: { status: HealthStatus; message?: string };
}

function IntegrationSettings() {
  const [health, setHealth] = useState<IntegrationHealth>({
    stripe: { status: 'checking' },
    email: { status: 'checking' },
    twilio: { status: 'checking' },
  });
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  const runHealthCheck = useCallback(async () => {
    setHealth({
      stripe: { status: 'checking' },
      email: { status: 'checking' },
      twilio: { status: 'checking' },
    });

    try {
      const res = await api.request<IntegrationHealth>('/integrations/health');
      if (res.data) setHealth(res.data);
      setLastChecked(new Date().toLocaleTimeString());
    } catch (err) {
      console.error('Health check failed:', err);
      setHealth({
        stripe: { status: 'error', message: 'Could not reach server' },
        email: { status: 'error', message: 'Could not reach server' },
        twilio: { status: 'error', message: 'Could not reach server' },
      });
    }
  }, []);

  useEffect(() => { runHealthCheck(); }, [runHealthCheck]);

  const statusBadge = (s: HealthStatus) => {
    switch (s) {
      case 'checking': return <span className="ppl-badge ppl-badge-warning animate-pulse">Checking...</span>;
      case 'connected': return <span className="ppl-badge ppl-badge-active">Connected</span>;
      case 'error': return <span className="ppl-badge ppl-badge-danger">Error</span>;
      case 'not_configured': return <span className="ppl-badge ppl-badge-danger">Not Configured</span>;
    }
  };

  const integrations = [
    {
      key: 'stripe' as const,
      name: 'Stripe',
      description: 'Payment processing for memberships and billing',
      icon: (
        <svg className="w-8 h-8" viewBox="0 0 24 24" fill="currentColor">
          <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z" />
        </svg>
      ),
    },
    {
      key: 'email' as const,
      name: 'Email (SMTP)',
      description: 'Transactional emails for notifications and receipts',
      icon: (
        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
        </svg>
      ),
    },
    {
      key: 'twilio' as const,
      name: 'Twilio (SMS)',
      description: 'Text message notifications and reminders',
      icon: (
        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
        </svg>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Integrations</h2>
          {lastChecked && <p className="text-xs text-muted">Last checked: {lastChecked}</p>}
        </div>
        <button onClick={runHealthCheck} className="ppl-btn ppl-btn-secondary text-xs">
          Re-check
        </button>
      </div>

      {integrations.map((integration) => {
        const h = health[integration.key];
        return (
          <div key={integration.key} className="ppl-card flex items-center gap-4">
            <div className="text-muted">{integration.icon}</div>
            <div className="flex-1">
              <h3 className="font-semibold text-foreground">{integration.name}</h3>
              <p className="text-sm text-muted">{integration.description}</p>
              {h.message && (
                <p className={`text-xs mt-0.5 ${h.status === 'connected' ? 'text-ppl-light-green' : 'text-red-400'}`}>
                  {h.message}
                </p>
              )}
            </div>
            <div>{statusBadge(h.status)}</div>
          </div>
        );
      })}

      <div className="ppl-card bg-background">
        <h3 className="font-semibold text-foreground mb-2">Configuration</h3>
        <p className="text-sm text-muted mb-3">
          Integration credentials are set via environment variables on the server (Railway).
        </p>
        <div className="bg-surface rounded-lg p-3 font-mono text-xs text-muted space-y-1">
          <p># Stripe</p>
          <p>STRIPE_SECRET_KEY=sk_live_...</p>
          <p>STRIPE_WEBHOOK_SECRET=whsec_...</p>
          <p className="mt-2"># Email (SMTP)</p>
          <p>SMTP_HOST=smtp.gmail.com</p>
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
