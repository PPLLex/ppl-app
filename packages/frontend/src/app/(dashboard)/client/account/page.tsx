'use client';

import { useState, useEffect } from 'react';
import { api, UserProfile } from '@/lib/api';

export default function ClientAccountPage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<'profile' | 'password'>('profile');
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
        <p className="text-sm text-muted mt-0.5">Manage your profile and security</p>
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

      {/* Section Tabs */}
      <div className="flex gap-1 mb-6 bg-surface rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveSection('profile')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
            activeSection === 'profile'
              ? 'bg-ppl-dark-green/20 text-ppl-light-green'
              : 'text-muted hover:text-foreground'
          }`}
        >
          Profile
        </button>
        <button
          onClick={() => setActiveSection('password')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
            activeSection === 'password'
              ? 'bg-ppl-dark-green/20 text-ppl-light-green'
              : 'text-muted hover:text-foreground'
          }`}
        >
          Password
        </button>
      </div>

      {activeSection === 'profile' && (
        <ProfileSection profile={profile} onSaved={(msg) => setMessage(msg)} />
      )}
      {activeSection === 'password' && (
        <PasswordSection onSaved={(msg) => setMessage(msg)} />
      )}
    </div>
  );
}

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
