'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api, Location, MembershipPlan, User, SessionTypeConfig, SessionTypeConfigInput, OrgSettings } from '@/lib/api';
import { useTheme } from '@/contexts/ThemeContext';

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
                ? 'bg-highlight/20 text-accent-text'
                : 'text-muted hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'general' && <GeneralSettings />}
      {activeTab === 'plans' && <PlanSettings />}
      {activeTab === 'staff' && <StaffRedirect />}
      {activeTab === 'integrations' && <IntegrationSettings />}
    </div>
  );
}

/* ─── General Settings ─── */
function GeneralSettings() {
  const { updateTheme, refreshBranding: refreshGlobalBranding } = useTheme();
  const [locations, setLocations] = useState<Location[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [defaults, setDefaults] = useState({
    defaultCapacity: 8,
    registrationCutoffHours: 1,
    cancellationCutoffHours: 6,
    sessionDurationMinutes: 60,
  });
  const [defaultsSaving, setDefaultsSaving] = useState(false);
  const [defaultsMsg, setDefaultsMsg] = useState('');
  const [branding, setBranding] = useState({
    businessName: 'Pitching Performance Lab',
    tagline: 'Train like a pro.',
    logoData: '' as string | null,
    primaryColor: '#166534',
    accentColor: '#4ade80',
  });
  const [brandSaving, setBrandSaving] = useState(false);
  const [brandMsg, setBrandMsg] = useState('');
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [locRes, brandRes] = await Promise.all([
          api.getLocations(),
          api.getBranding(),
        ]);
        if (locRes.data) setLocations(locRes.data);
        if (brandRes.data) {
          const s = brandRes.data;
          setBranding({
            businessName: s.businessName,
            tagline: s.tagline,
            logoData: s.logoData,
            primaryColor: s.primaryColor,
            accentColor: s.accentColor,
          });
          setDefaults({
            defaultCapacity: s.defaultCapacity,
            sessionDurationMinutes: s.sessionDurationMinutes,
            registrationCutoffHours: s.registrationCutoffHours,
            cancellationCutoffHours: s.cancellationCutoffHours,
          });
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const handleBrandSave = async () => {
    setBrandSaving(true);
    setBrandMsg('');
    try {
      await api.updateBranding({
        businessName: branding.businessName,
        tagline: branding.tagline,
        primaryColor: branding.primaryColor,
        accentColor: branding.accentColor,
      });
      // Refresh the global theme context so colors, name, tagline all update everywhere
      await refreshGlobalBranding();
      setBrandMsg('Saved!');
      setTimeout(() => setBrandMsg(''), 2000);
    } catch (err) {
      setBrandMsg('Error saving');
    } finally {
      setBrandSaving(false);
    }
  };

  const handleDefaultsSave = async () => {
    setDefaultsSaving(true);
    setDefaultsMsg('');
    try {
      await api.updateBranding({
        defaultCapacity: defaults.defaultCapacity,
        sessionDurationMinutes: defaults.sessionDurationMinutes,
        registrationCutoffHours: defaults.registrationCutoffHours,
        cancellationCutoffHours: defaults.cancellationCutoffHours,
      } as any);
      setDefaultsMsg('Saved!');
      setTimeout(() => setDefaultsMsg(''), 2000);
    } catch (err) {
      setDefaultsMsg('Error saving');
    } finally {
      setDefaultsSaving(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setBrandMsg('Logo must be under 10MB');
      return;
    }
    setLogoUploading(true);
    setBrandMsg('');
    try {
      const res = await api.uploadLogo(file);
      if (res.data) {
        setBranding((prev) => ({ ...prev, logoData: res.data!.logoData }));
        await refreshGlobalBranding();
        setBrandMsg('Logo uploaded!');
        setTimeout(() => setBrandMsg(''), 2000);
      }
    } catch (err) {
      setBrandMsg('Upload failed');
    } finally {
      setLogoUploading(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

  const handleLogoRemove = async () => {
    setLogoUploading(true);
    try {
      await api.removeLogo();
      setBranding((prev) => ({ ...prev, logoData: null }));
      await refreshGlobalBranding();
      setBrandMsg('Logo removed');
      setTimeout(() => setBrandMsg(''), 2000);
    } catch (err) {
      setBrandMsg('Failed to remove logo');
    } finally {
      setLogoUploading(false);
    }
  };

  if (isLoading) {
    return <div className="ppl-card animate-pulse h-48" />;
  }

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
            <label className="text-xs font-medium text-muted block mb-1">Logo</label>
            <div className="flex items-center gap-4">
              {branding.logoData ? (
                <div className="relative group">
                  <div className="w-16 h-16 rounded-lg bg-background border border-border flex items-center justify-center overflow-hidden">
                    <img src={branding.logoData} alt="Logo" className="max-w-full max-h-full object-contain" />
                  </div>
                  <button
                    onClick={handleLogoRemove}
                    disabled={logoUploading}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Remove logo"
                  >
                    &times;
                  </button>
                </div>
              ) : (
                <div className="w-16 h-16 rounded-lg bg-background border-2 border-dashed border-border flex items-center justify-center">
                  <svg className="w-6 h-6 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                  </svg>
                </div>
              )}
              <div>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
                  onChange={handleLogoUpload}
                  className="hidden"
                  id="logo-upload"
                />
                <label
                  htmlFor="logo-upload"
                  className={`ppl-btn ppl-btn-secondary text-xs cursor-pointer inline-block ${logoUploading ? 'opacity-50 pointer-events-none' : ''}`}
                >
                  {logoUploading ? 'Uploading...' : branding.logoData ? 'Change Logo' : 'Upload Logo'}
                </label>
                <p className="text-[10px] text-muted mt-1">PNG, JPG, WebP, SVG, or GIF. Max 10MB.</p>
              </div>
            </div>
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

        {/* Swap Colors + Live Preview */}
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => {
              const swapped = {
                ...branding,
                primaryColor: branding.accentColor,
                accentColor: branding.primaryColor,
              };
              setBranding(swapped);
              // Live-preview the swap immediately
              updateTheme({ primaryColor: swapped.primaryColor, accentColor: swapped.accentColor });
            }}
            className="ppl-btn ppl-btn-secondary text-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
            </svg>
            Swap Colors
          </button>
          <div className="flex items-center gap-2 text-xs text-muted">
            <span>Preview:</span>
            <div className="flex gap-1">
              <span className="inline-block w-5 h-5 rounded" style={{ background: branding.primaryColor }} title="Primary" />
              <span className="inline-block w-5 h-5 rounded" style={{ background: branding.accentColor }} title="Accent" />
            </div>
            <span className="inline-block h-5 px-2 rounded text-[11px] leading-5 font-medium ppl-btn ppl-btn-primary">
              Button
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-3">
          <button onClick={handleBrandSave} disabled={brandSaving} className="ppl-btn ppl-btn-primary text-sm">
            {brandSaving ? 'Saving...' : brandMsg || 'Save Branding'}
          </button>
          {brandMsg && !brandSaving && (
            <span className={`text-xs ${brandMsg.includes('Error') || brandMsg.includes('failed') ? 'text-red-400' : 'text-accent-text'}`}>
              {brandMsg}
            </span>
          )}
        </div>
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

        <div className="flex items-center gap-3 mt-4">
          <button onClick={handleDefaultsSave} disabled={defaultsSaving} className="ppl-btn ppl-btn-primary text-sm">
            {defaultsSaving ? 'Saving...' : defaultsMsg || 'Save Defaults'}
          </button>
          {defaultsMsg && !defaultsSaving && (
            <span className={`text-xs ${defaultsMsg.includes('Error') ? 'text-red-400' : 'text-accent-text'}`}>
              {defaultsMsg}
            </span>
          )}
        </div>
      </div>

      {/* Session Type Configs */}
      <SessionTypeConfigPanel locations={locations} />

      {/* Kiosk Setup */}
      <KioskSetupPanel locations={locations} />

      {/* Location Overview */}
      <div className="ppl-card">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-bold text-foreground">Locations</h2>
            <p className="text-sm text-muted">Quick view of your facilities</p>
          </div>
          <a href="/admin/locations" className="text-sm text-accent-text hover:underline">
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
                      ? 'bg-highlight/20 text-accent-text'
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
        <p className="text-xs text-accent-text mt-2">{saveMsg}</p>
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
              ? 'bg-highlight/10 border border-highlight/20 text-accent-text'
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
                    <p className="text-lg font-bold text-accent-text">
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

/* ─── Staff Redirect ─── */

function StaffRedirect() {
  return (
    <div className="ppl-card text-center py-12">
      <div className="w-16 h-16 bg-highlight/10 rounded-full flex items-center justify-center mx-auto mb-4">
        <svg className="w-8 h-8 text-highlight-text" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">Staff Management Has Moved</h3>
      <p className="text-sm text-muted mb-4">Staff management now has its own dedicated section with expanded features.</p>
      <a
        href="/admin/staff"
        className="inline-block px-6 py-2.5 bg-highlight text-on-accent rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity"
      >
        Go to Staff Management
      </a>
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
                <p className={`text-xs mt-0.5 ${h.status === 'connected' ? 'text-accent-text' : 'text-red-400'}`}>
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

/* ─── Kiosk Setup Panel ─── */
function KioskSetupPanel({ locations }: { locations: Location[] }) {
  const [pins, setPins] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    // Load current kiosk PINs for each location
    const initial: Record<string, string> = {};
    locations.forEach((loc) => {
      initial[loc.id] = (loc as any).kioskPin || '';
    });
    setPins(initial);
    // Also fetch actual values from API
    locations.forEach(async (loc) => {
      try {
        const res = await api.getLocation(loc.id);
        if (res.data && (res.data as any).kioskPin) {
          setPins((prev) => ({ ...prev, [loc.id]: (res.data as any).kioskPin }));
        }
      } catch { /* ignore */ }
    });
  }, [locations]);

  const handleSavePin = async (locationId: string) => {
    setSaving(locationId);
    try {
      await api.request(`/locations/${locationId}`, {
        method: 'PATCH',
        body: JSON.stringify({ kioskPin: pins[locationId] || null }),
      });
      setSaved(locationId);
      setTimeout(() => setSaved(null), 2000);
    } catch (err) {
      console.error('Failed to save kiosk PIN:', err);
    } finally {
      setSaving(null);
    }
  };

  const generatePin = (locationId: string) => {
    const newPin = Math.floor(1000 + Math.random() * 9000).toString();
    setPins((prev) => ({ ...prev, [locationId]: newPin }));
  };

  const appDomain = typeof window !== 'undefined' ? window.location.origin : 'https://app.pitchingperformancelab.com';

  return (
    <div className="ppl-card">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-bold text-foreground">Self-Service Kiosk</h2>
        <span className="ppl-badge bg-highlight/10 text-accent-text border border-highlight/20 text-xs">New</span>
      </div>
      <p className="text-sm text-muted mb-4">
        Set up a tablet at your facility for athletes to check themselves in. Each location gets its own PIN.
      </p>

      <div className="space-y-3">
        {locations.map((loc) => (
          <div key={loc.id} className="p-4 bg-background rounded-xl border border-border">
            <div className="flex items-center justify-between mb-3">
              <p className="font-semibold text-foreground text-sm">{loc.name}</p>
              {pins[loc.id] && (
                <a
                  href={`${appDomain}/kiosk`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-accent-text hover:underline"
                >
                  Open Kiosk &rarr;
                </a>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="text-xs text-muted block mb-1">Kiosk PIN</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={pins[loc.id] || ''}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                      setPins((prev) => ({ ...prev, [loc.id]: val }));
                    }}
                    className="ppl-input text-lg tracking-[0.3em] text-center font-mono w-32"
                    placeholder="----"
                    maxLength={6}
                  />
                  <button
                    onClick={() => generatePin(loc.id)}
                    className="ppl-btn ppl-btn-secondary text-xs"
                    title="Generate random PIN"
                  >
                    Generate
                  </button>
                  <button
                    onClick={() => handleSavePin(loc.id)}
                    disabled={saving === loc.id}
                    className="ppl-btn ppl-btn-primary text-xs"
                  >
                    {saving === loc.id ? 'Saving...' : saved === loc.id ? 'Saved!' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
            {pins[loc.id] && (
              <p className="text-xs text-muted mt-2">
                Kiosk URL: <code className="text-foreground bg-surface px-1 rounded">{appDomain}/kiosk</code> — enter PIN <code className="text-accent-text bg-surface px-1 rounded">{pins[loc.id]}</code>
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 p-3 bg-surface rounded-lg">
        <p className="text-xs text-muted">
          <strong className="text-foreground">Setup guide:</strong> Open{' '}
          <code className="text-accent-text">{appDomain}/kiosk</code> on a tablet browser, enter the
          location PIN, then use the browser&apos;s fullscreen mode (or &quot;Add to Home Screen&quot; on
          iPad) for the best experience. The kiosk auto-refreshes and doesn&apos;t require login.
        </p>
      </div>
    </div>
  );
}
