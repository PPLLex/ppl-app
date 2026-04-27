'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { api, UserProfile } from '@/lib/api';
import { TwoFactorPanel } from '@/components/security/TwoFactorPanel';
import { AvatarUploader } from '@/components/AvatarUploader';

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Profile form
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Password form
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  const [activeTab, setActiveTab] = useState<'profile' | 'password' | 'security'>('profile');

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.getProfile();
        if (res.data) {
          setProfile(res.data);
          setFullName(res.data.fullName || '');
          setPhone(res.data.phone || '');
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleSaveProfile = async () => {
    setMessage(null);
    if (!fullName.trim()) {
      setMessage({ type: 'error', text: 'Name is required' });
      return;
    }

    setSaving(true);
    try {
      await api.updateProfile({ fullName: fullName.trim(), phone: phone.trim() || undefined });
      setMessage({ type: 'success', text: 'Profile updated successfully' });
      // Refresh the auth context so sidebar shows updated name
      if (refreshUser) refreshUser();
    } catch (err: unknown) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to update profile' });
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    setMessage(null);
    if (!currentPassword || !newPassword) {
      setMessage({ type: 'error', text: 'Current and new passwords are required' });
      return;
    }
    if (newPassword.length < 6) {
      setMessage({ type: 'error', text: 'New password must be at least 6 characters' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'New passwords do not match' });
      return;
    }

    setChangingPassword(true);
    try {
      await api.changePassword({ currentPassword, newPassword });
      setMessage({ type: 'success', text: 'Password changed successfully' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to change password' });
    } finally {
      setChangingPassword(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="ppl-card animate-pulse h-32" />
        <div className="ppl-card animate-pulse h-64" />
      </div>
    );
  }

  const roleLabel = user?.role === 'ADMIN' ? 'Administrator' : user?.role === 'STAFF' ? 'Staff' : 'Member';

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">My Profile</h1>
        <p className="text-sm text-muted mt-0.5">Manage your personal information and security</p>
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

      {/* Profile Card */}
      <div className="ppl-card p-5 mb-6">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full overflow-hidden ppl-gradient flex items-center justify-center flex-shrink-0">
            {profile?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.avatarUrl}
                alt={profile.fullName}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-white text-2xl font-bold">
                {(profile?.fullName || 'U').charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">{profile?.fullName}</h2>
            <p className="text-sm text-muted">{profile?.email}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                user?.role === 'ADMIN'
                  ? 'bg-amber-500/15 text-amber-400'
                  : user?.role === 'STAFF'
                    ? 'bg-highlight/15 text-highlight-text'
                    : 'bg-emerald-500/15 text-emerald-400'
              }`}>
                {roleLabel}
              </span>
              {profile?.homeLocation && (
                <span className="text-xs text-muted">{profile.homeLocation.name}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tab Switcher */}
      <div className="flex gap-1 mb-6 bg-surface rounded-lg p-1 w-fit">
        <button
          onClick={() => { setActiveTab('profile'); setMessage(null); }}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
            activeTab === 'profile'
              ? 'bg-highlight/20 text-accent-text'
              : 'text-muted hover:text-foreground'
          }`}
        >
          Edit Profile
        </button>
        <button
          onClick={() => { setActiveTab('password'); setMessage(null); }}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
            activeTab === 'password'
              ? 'bg-highlight/20 text-accent-text'
              : 'text-muted hover:text-foreground'
          }`}
        >
          Change Password
        </button>
        <button
          onClick={() => { setActiveTab('security'); setMessage(null); }}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
            activeTab === 'security'
              ? 'bg-highlight/20 text-accent-text'
              : 'text-muted hover:text-foreground'
          }`}
        >
          Security
        </button>
      </div>

      {/* Profile Edit Form */}
      {activeTab === 'profile' && (
        <div className="ppl-card p-5 space-y-5">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Full Name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-highlight/50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Email</label>
            <input
              type="email"
              value={profile?.email || ''}
              disabled
              className="w-full bg-background/50 border border-border rounded-lg px-3 py-2.5 text-muted text-sm cursor-not-allowed"
            />
            <p className="text-xs text-muted mt-1">Contact PPL to change your email address</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Phone Number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-highlight/50"
              placeholder="(555) 123-4567"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Role</label>
            <input
              type="text"
              value={roleLabel}
              disabled
              className="w-full bg-background/50 border border-border rounded-lg px-3 py-2.5 text-muted text-sm cursor-not-allowed"
            />
          </div>

          {profile?.homeLocation && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Home Location</label>
              <input
                type="text"
                value={profile.homeLocation.name}
                disabled
                className="w-full bg-background/50 border border-border rounded-lg px-3 py-2.5 text-muted text-sm cursor-not-allowed"
              />
            </div>
          )}

          <div className="pt-2">
            <button
              onClick={handleSaveProfile}
              disabled={saving}
              className="px-6 py-2.5 bg-highlight text-on-accent rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}

      {/* Change Password Form */}
      {activeTab === 'password' && (
        <div className="ppl-card p-5 space-y-5">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Current Password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-highlight/50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-highlight/50"
              placeholder="At least 6 characters"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Confirm New Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-highlight/50"
            />
          </div>

          <div className="pt-2">
            <button
              onClick={handleChangePassword}
              disabled={changingPassword}
              className="px-6 py-2.5 bg-highlight text-on-accent rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {changingPassword ? 'Changing...' : 'Change Password'}
            </button>
          </div>
        </div>
      )}

      {/* Security tab — 2FA enrollment + recovery codes (#141) plus
          profile photo (#P11). Future: device sessions, login history. */}
      {activeTab === 'security' && (
        <div className="space-y-4">
          <AvatarUploader
            avatarUrl={profile?.avatarUrl ?? null}
            fullName={profile?.fullName ?? ''}
            onChange={(next) => {
              setProfile((p) => (p ? { ...p, avatarUrl: next } : p));
              if (refreshUser) refreshUser();
            }}
          />
          <TwoFactorPanel />
        </div>
      )}
    </div>
  );
}
