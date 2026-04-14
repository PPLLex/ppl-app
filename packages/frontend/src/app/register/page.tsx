'use client';

import { useState, useEffect } from 'react';
import { api, Location } from '@/lib/api';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState(1); // 1: info, 2: location + age group
  const [locations, setLocations] = useState<Location[]>([]);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Step 1 fields
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Step 2 fields
  const [locationId, setLocationId] = useState('');
  const [ageGroup, setAgeGroup] = useState('');

  useEffect(() => {
    api.getLocations().then((res) => {
      if (res.data) setLocations(res.data);
    });
  }, []);

  const handleStep1 = (e: React.FormEvent) => {
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
    setStep(2);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!locationId) {
      setError('Please select your training location');
      return;
    }
    if (!ageGroup) {
      setError('Please select your age group');
      return;
    }

    setIsLoading(true);
    try {
      const res = await api.register({
        fullName,
        email,
        phone,
        password,
        locationId,
        ageGroup,
      });

      if (res.data) {
        localStorage.setItem('ppl_token', res.data.token);
        // New client goes to client dashboard (will eventually go to membership selection)
        router.push('/client');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Registration failed. Please try again.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full ppl-gradient mb-4">
            <span className="text-white text-3xl font-bold">P</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">Join PPL</h1>
          <p className="text-muted mt-1">Create your account to start training</p>
        </div>

        {/* Progress indicator */}
        <div className="flex items-center gap-2 mb-6">
          <div className={`h-1 flex-1 rounded-full ${step >= 1 ? 'ppl-gradient' : 'bg-border'}`} />
          <div className={`h-1 flex-1 rounded-full ${step >= 2 ? 'ppl-gradient' : 'bg-border'}`} />
        </div>

        <div className="ppl-card">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">
              {error}
            </div>
          )}

          {step === 1 && (
            <form onSubmit={handleStep1} className="space-y-4">
              <h2 className="text-lg font-semibold text-foreground mb-2">Your Information</h2>

              <div>
                <label htmlFor="fullName" className="block text-sm font-medium text-foreground mb-1.5">
                  Full Name
                </label>
                <input
                  id="fullName"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="John Smith"
                  className="ppl-input"
                  required
                />
              </div>

              <div>
                <label htmlFor="regEmail" className="block text-sm font-medium text-foreground mb-1.5">
                  Email
                </label>
                <input
                  id="regEmail"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="ppl-input"
                  required
                />
              </div>

              <div>
                <label htmlFor="regPhone" className="block text-sm font-medium text-foreground mb-1.5">
                  Phone Number
                </label>
                <input
                  id="regPhone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(555) 123-4567"
                  className="ppl-input"
                />
              </div>

              <div>
                <label htmlFor="regPassword" className="block text-sm font-medium text-foreground mb-1.5">
                  Password
                </label>
                <input
                  id="regPassword"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="ppl-input"
                  required
                  minLength={8}
                />
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground mb-1.5">
                  Confirm Password
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  className="ppl-input"
                  required
                />
              </div>

              <button type="submit" className="ppl-btn ppl-btn-primary w-full py-3 text-base">
                Continue
              </button>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <h2 className="text-lg font-semibold text-foreground mb-2">Training Details</h2>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Select Your Location
                </label>
                <div className="space-y-2">
                  {locations.map((loc) => (
                    <button
                      key={loc.id}
                      type="button"
                      onClick={() => setLocationId(loc.id)}
                      className={`w-full text-left p-3 rounded-lg border transition-all ${
                        locationId === loc.id
                          ? 'border-ppl-dark-green bg-ppl-dark-green/10'
                          : 'border-border hover:border-border-light'
                      }`}
                    >
                      <span className="font-medium text-foreground">{loc.name}</span>
                      {loc.address && (
                        <span className="block text-sm text-muted mt-0.5">{loc.address}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Age Group
                </label>
                <div className="space-y-2">
                  {[
                    { value: 'youth', label: 'Youth', desc: '12 and under' },
                    { value: 'ms_hs', label: 'Middle School / High School', desc: 'Ages 13-18' },
                    { value: 'college', label: 'College', desc: 'College athletes' },
                  ].map((group) => (
                    <button
                      key={group.value}
                      type="button"
                      onClick={() => setAgeGroup(group.value)}
                      className={`w-full text-left p-3 rounded-lg border transition-all ${
                        ageGroup === group.value
                          ? 'border-ppl-dark-green bg-ppl-dark-green/10'
                          : 'border-border hover:border-border-light'
                      }`}
                    >
                      <span className="font-medium text-foreground">{group.label}</span>
                      <span className="block text-sm text-muted mt-0.5">{group.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="ppl-btn ppl-btn-secondary flex-1 py-3"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="ppl-btn ppl-btn-primary flex-1 py-3 text-base"
                >
                  {isLoading ? 'Creating Account...' : 'Create Account'}
                </button>
              </div>
            </form>
          )}

          <div className="mt-6 text-center">
            <p className="text-sm text-muted">
              Already have an account?{' '}
              <Link href="/login" className="text-ppl-light-green hover:text-ppl-dark-green transition-colors">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
