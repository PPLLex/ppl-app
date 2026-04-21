'use client';

import { useState, useEffect } from 'react';
import { api, UserProfile, OutsideCoachLink } from '@/lib/api';

export default function ClientAccountPage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<'profile' | 'coaches' | 'password'>('profile');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.getProfile();
        if (res.data) setProfile(res.data);
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  if (isLoading || !profile) {
    return (
      <div className="space-y-4">
        <div className="ppl-card animate-pulse h-32" />
        <div className="ppl-card animate-pulse h-64" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">My Account</h1>
        <p className="text-sm text-muted mt-0.5">Manage your profile, coaches, and security</p>
      </div>

      {message && (
        <div
          className={`mb-4 p-3 rounded-lg text-sm ${
            message.type === 'success'
              ? 'bg-primary/10 border border-primary/20 text-accent'
              : 'bg-danger/10 border border-danger/20 text-danger'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Section Tabs */}
      <div className="flex gap-1 mb-6 bg-surface rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveSection('profile')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
            activeSection === 'profile'
              ? 'bg-primary/20 text-accent'
              : 'text-muted hover:text-foreground'
          }`}
        >
          Profile
        </button>
        <button
          onClick={() => setActiveSection('coaches')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
            activeSection === 'coaches'
              ? 'bg-primary/20 text-accent'
              : 'text-muted hover:text-foreground'
          }`}
        >
          My Coaches
        </button>
        <button
          onClick={() => setActiveSection('password')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
            activeSection === 'password'
              ? 'bg-primary/20 text-accent'
              : 'text-muted hover:text-foreground'
          }`}
        >
          Password
        </button>
      </div>

      {activeSection === 'profile' && (
        <ProfileSection profile={profile} onSaved={(msg) => setMessage(msg)} />
      )}
      {activeSection === 'coaches' && (
        <CoachesSection onMessage={(msg) => setMessage(msg)} />
      )}
      {activeSection === 'password' && (
        <PasswordSection onSaved={(msg) => setMessage(msg)} />
      )}
    </div>
  );
}

// ─── Profile Section ───

function ProfileSection({
  profile,
  onSaved,
}: {
  profile: UserProfile;
  onSaved: (msg: { type: 'success' | 'error'; text: string }) => void;
}) {
  const [form, setForm] = useState({
    fullName: profile.fullName,
    phone: profile.phone || '',
    parentName: profile.clientProfile?.parentName || '',
    parentEmail: profile.clientProfile?.parentEmail || '',
    parentPhone: profile.clientProfile?.parentPhone || '',
    emergencyContact: profile.clientProfile?.emergencyContact || '',
    emergencyPhone: profile.clientProfile?.emergencyPhone || '',
    trainingGoals: profile.clientProfile?.trainingGoals || '',
  });
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await api.updateProfile(form);
      onSaved({ type: 'success', text: 'Profile updated!' });
    } catch (err: unknown) {
      onSaved({ type: 'error', text: err instanceof Error ? err.message : 'Failed to update' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Basic Info */}
      <div className="ppl-card">
        <h2 className="text-lg font-bold text-foreground mb-4">Basic Information</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-muted block mb-1">Full Name</label>
            <input
              type="text"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              className="ppl-input"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted block mb-1">Email</label>
            <input type="email" value={profile.email} disabled className="ppl-input opacity-50" />
            <p className="text-xs text-muted mt-1">Contact PPL to change your email</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted block mb-1">Phone</label>
            <input
              type="text"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="ppl-input"
              placeholder="(214) 555-0100"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted block mb-1">Home Location</label>
            <input
              type="text"
              value={profile.homeLocation?.name || 'Not assigned'}
              disabled
              className="ppl-input opacity-50"
            />
          </div>
        </div>
      </div>

      {/* Parent / Guardian */}
      {profile.clientProfile && (
        <div className="ppl-card">
          <h2 className="text-lg font-bold text-foreground mb-4">Parent / Guardian</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted block mb-1">Parent Name</label>
              <input
                type="text"
                value={form.parentName}
                onChange={(e) => setForm({ ...form, parentName: e.target.value })}
                className="ppl-input"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted block mb-1">Parent Email</label>
              <input
                type="email"
                value={form.parentEmail}
                onChange={(e) => setForm({ ...form, parentEmail: e.target.value })}
                className="ppl-input"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted block mb-1">Parent Phone</label>
              <input
                type="text"
                value={form.parentPhone}
                onChange={(e) => setForm({ ...form, parentPhone: e.target.value })}
                className="ppl-input"
              />
            </div>
          </div>
        </div>
      )}

      {/* Emergency Contact */}
      <div className="ppl-card">
        <h2 className="text-lg font-bold text-foreground mb-4">Emergency Contact</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-muted block mb-1">Contact Name</label>
            <input
              type="text"
              value={form.emergencyContact}
              onChange={(e) => setForm({ ...form, emergencyContact: e.target.value })}
              className="ppl-input"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted block mb-1">Contact Phone</label>
            <input
              type="text"
              value={form.emergencyPhone}
              onChange={(e) => setForm({ ...form, emergencyPhone: e.target.value })}
              className="ppl-input"
            />
          </div>
        </div>
      </div>

      {/* Training Goals */}
      <div className="ppl-card">
        <h2 className="text-lg font-bold text-foreground mb-4">Training Goals</h2>
        <textarea
          value={form.trainingGoals}
          onChange={(e) => setForm({ ...form, trainingGoals: e.target.value })}
          rows={3}
          className="ppl-input"
          placeholder="What are you working toward?"
        />
      </div>

      <button type="submit" disabled={isSaving} className="ppl-btn ppl-btn-primary">
        {isSaving ? 'Saving...' : 'Save Changes'}
      </button>
    </form>
  );
}

// ─── Coaches Section ───

function CoachesSection({
  onMessage,
}: {
  onMessage: (msg: { type: 'success' | 'error'; text: string }) => void;
}) {
  const [coaches, setCoaches] = useState<OutsideCoachLink[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const loadCoaches = async () => {
    try {
      const res = await api.getMyOutsideCoaches();
      if (res.data) setCoaches(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCoaches();
  }, []);

  const handleRemove = async (linkId: string, coachName: string) => {
    if (!confirm(`Remove ${coachName} as your outside coach?`)) return;
    setRemovingId(linkId);
    try {
      await api.removeOutsideCoach(linkId);
      setCoaches(prev => prev.filter(c => c.id !== linkId));
      onMessage({ type: 'success', text: `${coachName} has been removed` });
    } catch (err: unknown) {
      onMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to remove coach' });
    } finally {
      setRemovingId(null);
    }
  };

  if (isLoading) {
    return <div className="ppl-card animate-pulse h-48" />;
  }

  return (
    <div className="space-y-6">
      {/* Info card */}
      <div className="ppl-card">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground mb-1">Outside Coaches</h2>
            <p className="text-sm text-muted">
              Link your high school, travel ball, or personal coaches so they can view your PPL training notes and progress.
              They&apos;ll get read-only access — no booking or account control.
            </p>
          </div>
          <button
            onClick={() => setShowAddForm(true)}
            className="ppl-btn ppl-btn-primary text-sm shrink-0"
          >
            + Add Coach
          </button>
        </div>
      </div>

      {/* Add Coach Form */}
      {showAddForm && (
        <AddCoachForm
          onAdded={(coach) => {
            setCoaches(prev => [coach, ...prev]);
            setShowAddForm(false);
            onMessage({ type: 'success', text: `${coach.coachName} has been added!` });
          }}
          onCancel={() => setShowAddForm(false)}
          onError={(msg) => onMessage({ type: 'error', text: msg })}
        />
      )}

      {/* Coach List */}
      {coaches.length === 0 && !showAddForm ? (
        <div className="ppl-card text-center py-12">
          <div className="w-16 h-16 rounded-full bg-surface-hover mx-auto mb-4 flex items-center justify-center">
            <svg className="w-8 h-8 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
          </div>
          <p className="text-muted text-sm mb-2">No outside coaches linked yet</p>
          <p className="text-xs text-muted/60">Add your high school or travel ball coach to share your training progress</p>
        </div>
      ) : (
        <div className="space-y-3">
          {coaches.map(coach => (
            <div key={coach.id} className="ppl-card flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-accent font-bold text-lg">
                    {coach.coachName.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <p className="font-semibold text-foreground">{coach.coachName}</p>
                  <p className="text-sm text-muted">{coach.coachEmail}</p>
                  <div className="flex gap-3 mt-1">
                    {coach.organization && (
                      <span className="text-xs text-muted/80">{coach.organization}</span>
                    )}
                    {coach.coachRole && (
                      <span className="text-xs bg-surface-hover px-2 py-0.5 rounded">{coach.coachRole}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {coach.acceptedAt ? (
                  <span className="text-xs bg-primary/10 text-accent px-2 py-1 rounded">Connected</span>
                ) : (
                  <span className="text-xs bg-yellow-500/10 text-yellow-400 px-2 py-1 rounded">Invited</span>
                )}
                <button
                  onClick={() => handleRemove(coach.id, coach.coachName)}
                  disabled={removingId === coach.id}
                  className="text-xs text-danger hover:text-danger/80 px-2 py-1 rounded hover:bg-danger/10 transition-all"
                >
                  {removingId === coach.id ? 'Removing...' : 'Remove'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddCoachForm({
  onAdded,
  onCancel,
  onError,
}: {
  onAdded: (coach: OutsideCoachLink) => void;
  onCancel: () => void;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState({
    coachName: '',
    coachEmail: '',
    coachPhone: '',
    organization: '',
    coachRole: '',
  });
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.coachName.trim() || !form.coachEmail.trim()) {
      onError('Coach name and email are required');
      return;
    }
    setIsSaving(true);
    try {
      const res = await api.addOutsideCoach({
        coachName: form.coachName.trim(),
        coachEmail: form.coachEmail.trim(),
        coachPhone: form.coachPhone.trim() || undefined,
        organization: form.organization.trim() || undefined,
        coachRole: form.coachRole.trim() || undefined,
      });
      if (res.data) onAdded(res.data);
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Failed to add coach');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="ppl-card border-2 border-primary/20">
      <h3 className="text-base font-bold text-foreground mb-4">Add Outside Coach</h3>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-muted block mb-1">Coach Name *</label>
          <input
            type="text"
            value={form.coachName}
            onChange={(e) => setForm({ ...form, coachName: e.target.value })}
            className="ppl-input"
            placeholder="Coach Smith"
            required
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted block mb-1">Coach Email *</label>
          <input
            type="email"
            value={form.coachEmail}
            onChange={(e) => setForm({ ...form, coachEmail: e.target.value })}
            className="ppl-input"
            placeholder="coach@school.edu"
            required
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted block mb-1">Phone</label>
          <input
            type="text"
            value={form.coachPhone}
            onChange={(e) => setForm({ ...form, coachPhone: e.target.value })}
            className="ppl-input"
            placeholder="(555) 555-0100"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted block mb-1">Organization</label>
          <input
            type="text"
            value={form.organization}
            onChange={(e) => setForm({ ...form, organization: e.target.value })}
            className="ppl-input"
            placeholder="Allen High School"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted block mb-1">Role</label>
          <input
            type="text"
            value={form.coachRole}
            onChange={(e) => setForm({ ...form, coachRole: e.target.value })}
            className="ppl-input"
            placeholder="Head Coach, Pitching Coach, etc."
          />
        </div>
      </div>
      <div className="flex gap-3 mt-5">
        <button type="submit" disabled={isSaving} className="ppl-btn ppl-btn-primary text-sm">
          {isSaving ? 'Adding...' : 'Add Coach'}
        </button>
        <button type="button" onClick={onCancel} className="ppl-btn text-sm text-muted hover:text-foreground">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Password Section ───

function PasswordSection({
  onSaved,
}: {
  onSaved: (msg: { type: 'success' | 'error'; text: string }) => void;
}) {
  const [form, setForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.newPassword !== form.confirmPassword) {
      onSaved({ type: 'error', text: 'New passwords do not match' });
      return;
    }
    if (form.newPassword.length < 8) {
      onSaved({ type: 'error', text: 'New password must be at least 8 characters' });
      return;
    }
    setIsSaving(true);
    try {
      await api.changePassword({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      onSaved({ type: 'success', text: 'Password updated!' });
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err: unknown) {
      onSaved({ type: 'error', text: err instanceof Error ? err.message : 'Failed to change password' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-md">
      <div className="ppl-card space-y-4">
        <h2 className="text-lg font-bold text-foreground">Change Password</h2>
        <div>
          <label className="text-xs font-medium text-muted block mb-1">Current Password</label>
          <input
            type="password"
            value={form.currentPassword}
            onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
            className="ppl-input"
            required
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted block mb-1">New Password</label>
          <input
            type="password"
            value={form.newPassword}
            onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
            className="ppl-input"
            required
            minLength={8}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted block mb-1">Confirm New Password</label>
          <input
            type="password"
            value={form.confirmPassword}
            onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
            className="ppl-input"
            required
          />
        </div>
        <button type="submit" disabled={isSaving} className="ppl-btn ppl-btn-primary w-full justify-center">
          {isSaving ? 'Updating...' : 'Update Password'}
        </button>
      </div>
    </form>
  );
}
