'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, StaffInviteDetails } from '@/lib/api';
import { PasswordInput } from '@/components/auth/PasswordInput';
import { isCommonPassword } from '@/lib/common-passwords';

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  PITCHING_COORDINATOR: 'Pitching Coordinator',
  YOUTH_COORDINATOR: 'Youth Coordinator',
  COACH: 'Coach',
  TRAINER: 'Trainer',
};

export default function StaffOnboardingPage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;

  const [invite, setInvite] = useState<StaffInviteDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Form fields
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await api.getStaffInviteDetails(token);
        if (res.data) {
          setInvite(res.data);
          if (res.data.phone) setPhone(res.data.phone);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Invitation not found or has expired');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (isCommonPassword(password)) {
      setError('That password is too common. Please choose something unique.');
      return;
    }

    setSubmitting(true);
    try {
      await api.acceptStaffInvite(token, {
        password,
        phone: phone.trim() || undefined,
      });
      setSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create account');
    } finally {
      setSubmitting(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="animate-pulse text-gray-400">Loading...</div>
      </div>
    );
  }

  // Error state (expired/invalid)
  if (!invite && error) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Invalid Invitation</h1>
          <p className="text-gray-400 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  // Success state
  if (success) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Welcome to the team!</h1>
          <p className="text-gray-400 text-sm mb-6">
            Your account has been created. You can now sign in with your email and password.
          </p>
          <button
            onClick={() => router.push('/login')}
            className="w-full py-3 bg-green-600 hover:bg-green-500 text-white rounded-lg font-semibold transition-colors"
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  if (!invite) return null;

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-lg">
        {/* Header */}
        <div className="p-6 border-b border-gray-800 text-center">
          <div className="w-14 h-14 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-7 h-7 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white">Join the Team</h1>
          <p className="text-sm text-gray-400 mt-1">
            Welcome, {invite.fullName}! Set up your account to get started.
          </p>
        </div>

        {/* Your assignments */}
        <div className="p-6 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-gray-300 mb-3">Your Assignments</h2>
          <div className="space-y-2">
            {invite.locations.map((loc, i) => (
              <div key={i} className="bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-3">
                <p className="text-sm font-medium text-white mb-1">{loc.locationName}</p>
                <div className="flex flex-wrap gap-1.5">
                  {loc.roleLabels.map((label, j) => (
                    <span
                      key={j}
                      className="text-xs px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/30"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Setup form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Email</label>
            <input
              type="email"
              value={invite.email}
              disabled
              className="w-full bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2.5 text-gray-400 text-sm cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50"
              placeholder="(555) 123-4567"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Create Password *</label>
            <PasswordInput
              variant="create"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              inputClassName="w-full bg-gray-800 border border-gray-700 rounded-lg pl-3 pr-11 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50"
              required
              minLength={8}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Confirm Password *</label>
            <PasswordInput
              variant="create"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              matchValue={password}
              inputClassName="w-full bg-gray-800 border border-gray-700 rounded-lg pl-3 pr-11 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50"
              required
              minLength={8}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 bg-green-600 hover:bg-green-500 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 mt-2"
          >
            {submitting ? 'Creating Account...' : 'Create My Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
