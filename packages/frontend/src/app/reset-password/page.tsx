'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import Link from 'next/link';

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const [form, setForm] = useState({ newPassword: '', confirmPassword: '' });
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  if (!token) {
    return (
      <div className="ppl-card text-center">
        <p className="text-danger mb-3">Invalid reset link. No token provided.</p>
        <Link href="/forgot-password" className="text-sm text-accent-text hover:underline">
          Request a new reset link
        </Link>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.newPassword !== form.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (form.newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      await api.resetPassword({ token, newPassword: form.newPassword });
      setSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Reset failed. The link may have expired.');
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className="ppl-card text-center">
        <div className="w-12 h-12 rounded-full bg-primary/20 mx-auto mb-3 flex items-center justify-center">
          <svg className="w-6 h-6 text-accent-text" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="font-semibold text-foreground mb-1">Password Reset!</h2>
        <p className="text-sm text-muted mb-4">Your password has been updated. You can now log in.</p>
        <Link href="/login" className="ppl-btn ppl-btn-primary inline-flex">
          Go to Login
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="ppl-card space-y-4">
      {error && (
        <div className="p-2 bg-danger/10 border border-danger/20 rounded-lg text-sm text-danger">
          {error}
        </div>
      )}
      <div>
        <label className="text-xs font-medium text-muted block mb-1">New Password</label>
        <input
          type="password"
          value={form.newPassword}
          onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
          className="ppl-input"
          required
          minLength={8}
          autoFocus
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted block mb-1">Confirm Password</label>
        <input
          type="password"
          value={form.confirmPassword}
          onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
          className="ppl-input"
          required
        />
      </div>
      <button type="submit" disabled={isLoading} className="ppl-btn ppl-btn-primary w-full justify-center">
        {isLoading ? 'Resetting...' : 'Set New Password'}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full ppl-gradient mx-auto mb-4 flex items-center justify-center">
            <span className="text-white text-2xl font-bold">P</span>
          </div>
          <h1 className="text-xl font-bold text-foreground">Set New Password</h1>
        </div>
        <Suspense fallback={<div className="ppl-card animate-pulse h-48" />}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
