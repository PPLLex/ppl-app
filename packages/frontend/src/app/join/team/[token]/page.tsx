'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { api, SchoolTeamPublic, RosterAthlete } from '@/lib/api';

interface AthleteRow {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

const emptyRow = (): AthleteRow => ({ firstName: '', lastName: '', email: '', phone: '' });

export default function CoachRosterPage() {
  const params = useParams();
  const token = params.token as string;

  const [school, setSchool] = useState<SchoolTeamPublic | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Roster rows
  const [athletes, setAthletes] = useState<AthleteRow[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number; createdNames: string[]; skippedReasons: string[] } | null>(null);

  // Brand colors with fallbacks
  const primaryColor = school?.brandColors?.primary || '#1a3e72';
  const secondaryColor = school?.brandColors?.secondary || '#c4a34d';

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await api.getSchoolByToken(token);
        if (res.data) {
          setSchool(res.data);
          if (res.data.rosterSubmittedAt) {
            setError('This roster has already been submitted. Contact PPL if you need to make changes.');
          }
        }
      } catch {
        setError('Invalid or expired invite link. Please contact PPL for a new one.');
      } finally {
        setIsLoading(false);
      }
    })();
  }, [token]);

  function updateRow(index: number, field: keyof AthleteRow, value: string) {
    setAthletes(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function addRow() {
    setAthletes(prev => [...prev, emptyRow()]);
  }

  function removeRow(index: number) {
    if (athletes.length <= 1) return;
    setAthletes(prev => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    // Filter out empty rows and validate
    const validAthletes: RosterAthlete[] = athletes
      .filter(a => a.firstName.trim() && a.lastName.trim() && a.email.trim())
      .map(a => ({
        firstName: a.firstName.trim(),
        lastName: a.lastName.trim(),
        email: a.email.trim(),
        phone: a.phone.trim() || undefined,
      }));

    if (validAthletes.length === 0) {
      setError('Please add at least one athlete with a first name, last name, and email.');
      return;
    }

    // Basic email validation
    const badEmails = validAthletes.filter(a => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email));
    if (badEmails.length > 0) {
      setError(`Invalid email for: ${badEmails.map(a => `${a.firstName} ${a.lastName}`).join(', ')}`);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await api.submitRoster(token, validAthletes);
      if (res.data) {
        setResult(res.data);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit roster. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  // ----- Loading state -----
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${primaryColor}15 0%, #0a0a0a 50%, ${secondaryColor}15 100%)` }}>
        <div className="animate-spin w-10 h-10 border-3 border-t-transparent rounded-full" style={{ borderColor: primaryColor, borderTopColor: 'transparent' }} />
      </div>
    );
  }

  // ----- Error state (no school found) -----
  if (!school) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #0a0a0a 100%)' }}>
        <div className="w-full max-w-md text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-500/10 mb-4">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Link Not Found</h1>
          <p className="text-gray-400">{error || 'This invite link is invalid or has expired.'}</p>
          <p className="text-gray-500 text-sm mt-4">
            Need help? Contact PPL at{' '}
            <a href="mailto:info@pitchingperformancelab.com" className="text-green-400 hover:underline">
              info@pitchingperformancelab.com
            </a>
          </p>
        </div>
      </div>
    );
  }

  // ----- Success state -----
  if (result) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: `linear-gradient(135deg, ${primaryColor}20 0%, #0a0a0a 50%, ${secondaryColor}20 100%)` }}>
        <div className="w-full max-w-lg text-center">
          {/* Dual branding header */}
          <div className="flex items-center justify-center gap-4 mb-8">
            {school.brandLogoUrl ? (
              <img src={school.brandLogoUrl} alt={school.name} className="w-14 h-14 rounded-lg object-cover" />
            ) : (
              <div className="w-14 h-14 rounded-lg flex items-center justify-center text-white font-bold text-xl" style={{ backgroundColor: primaryColor }}>
                {school.name.charAt(0)}
              </div>
            )}
            <span className="text-gray-500 text-2xl font-light">&times;</span>
            <div className="w-14 h-14 rounded-full flex items-center justify-center bg-gradient-to-br from-green-600 to-green-500">
              <span className="text-white text-xl font-bold">P</span>
            </div>
          </div>

          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full mb-6" style={{ backgroundColor: `${primaryColor}20` }}>
            <svg className="w-10 h-10" style={{ color: secondaryColor }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <h1 className="text-2xl font-bold text-white mb-2">Roster Submitted!</h1>
          <p className="text-gray-400 mb-6">
            {result.created} athlete{result.created !== 1 ? 's' : ''} added to {school.name}&apos;s roster with PPL.
          </p>

          {result.created > 0 && (
            <div className="rounded-lg border border-gray-700 p-4 mb-4 text-left">
              <p className="text-sm font-medium text-gray-300 mb-2">Athletes added:</p>
              <div className="space-y-1">
                {result.createdNames.map((name, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <svg className="w-4 h-4 shrink-0" style={{ color: secondaryColor }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-300">{name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.skipped > 0 && (
            <div className="rounded-lg border border-yellow-600/30 bg-yellow-500/5 p-4 mb-4 text-left">
              <p className="text-sm font-medium text-yellow-400 mb-2">{result.skipped} skipped:</p>
              <div className="space-y-1">
                {result.skippedReasons.map((reason, i) => (
                  <p key={i} className="text-sm text-yellow-300/70">{reason}</p>
                ))}
              </div>
            </div>
          )}

          <p className="text-gray-500 text-sm mt-6">
            Each athlete will receive a branded invite email to set up their PPL account.
          </p>
        </div>
      </div>
    );
  }

  // ----- Already submitted state -----
  if (school.rosterSubmittedAt) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: `linear-gradient(135deg, ${primaryColor}20 0%, #0a0a0a 50%, ${secondaryColor}20 100%)` }}>
        <div className="w-full max-w-md text-center">
          <div className="flex items-center justify-center gap-4 mb-8">
            {school.brandLogoUrl ? (
              <img src={school.brandLogoUrl} alt={school.name} className="w-14 h-14 rounded-lg object-cover" />
            ) : (
              <div className="w-14 h-14 rounded-lg flex items-center justify-center text-white font-bold text-xl" style={{ backgroundColor: primaryColor }}>
                {school.name.charAt(0)}
              </div>
            )}
            <span className="text-gray-500 text-2xl font-light">&times;</span>
            <div className="w-14 h-14 rounded-full flex items-center justify-center bg-gradient-to-br from-green-600 to-green-500">
              <span className="text-white text-xl font-bold">P</span>
            </div>
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Roster Already Submitted</h1>
          <p className="text-gray-400">
            The roster for {school.name} has already been submitted. If you need to make changes, please contact PPL.
          </p>
          <p className="text-gray-500 text-sm mt-4">
            <a href="mailto:info@pitchingperformancelab.com" className="text-green-400 hover:underline">
              info@pitchingperformancelab.com
            </a>
          </p>
        </div>
      </div>
    );
  }

  // ----- Main roster form -----
  return (
    <div className="min-h-screen px-4 py-8" style={{ background: `linear-gradient(135deg, ${primaryColor}15 0%, #0a0a0a 40%, ${secondaryColor}10 100%)` }}>
      <div className="w-full max-w-3xl mx-auto">
        {/* Dual branding header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-4 mb-6">
            {school.brandLogoUrl ? (
              <img src={school.brandLogoUrl} alt={school.name} className="w-16 h-16 rounded-lg object-cover shadow-lg" />
            ) : (
              <div className="w-16 h-16 rounded-lg flex items-center justify-center text-white font-bold text-2xl shadow-lg" style={{ backgroundColor: primaryColor }}>
                {school.name.charAt(0)}
              </div>
            )}
            <span className="text-gray-500 text-3xl font-light">&times;</span>
            <div className="w-16 h-16 rounded-full flex items-center justify-center bg-gradient-to-br from-green-600 to-green-500 shadow-lg">
              <span className="text-white text-2xl font-bold">P</span>
            </div>
          </div>

          <h1 className="text-2xl font-bold text-white mb-1">
            <span style={{ color: primaryColor }}>{school.name}</span>
            {' '}+ PPL
          </h1>
          <p className="text-gray-400">
            Enter your athletes below to get them set up with Pitching Performance Lab
          </p>
          {school.coachName && (
            <p className="text-sm mt-2" style={{ color: secondaryColor }}>
              Welcome, Coach {school.coachName}
            </p>
          )}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Desktop header row */}
          <div className="hidden md:grid md:grid-cols-[1fr_1fr_1.5fr_1fr_40px] gap-3 mb-2 px-1">
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">First Name *</span>
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Last Name *</span>
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Email *</span>
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Phone</span>
            <span />
          </div>

          <div className="space-y-3">
            {athletes.map((athlete, index) => (
              <div
                key={index}
                className="rounded-lg border border-gray-700/50 p-3 md:p-0 md:border-0 md:rounded-none"
                style={{ borderColor: `${primaryColor}30` }}
              >
                {/* Mobile: stacked labels */}
                <div className="md:hidden space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-wide" style={{ color: secondaryColor }}>
                      Athlete {index + 1}
                    </span>
                    {athletes.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeRow(index)}
                        className="text-gray-500 hover:text-red-400 transition-colors text-xs"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={athlete.firstName}
                      onChange={e => updateRow(index, 'firstName', e.target.value)}
                      placeholder="First name"
                      className="w-full px-3 py-2.5 rounded-lg border border-gray-700 bg-gray-900/50 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-1"
                      style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                    />
                    <input
                      type="text"
                      value={athlete.lastName}
                      onChange={e => updateRow(index, 'lastName', e.target.value)}
                      placeholder="Last name"
                      className="w-full px-3 py-2.5 rounded-lg border border-gray-700 bg-gray-900/50 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-1"
                      style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                    />
                  </div>
                  <input
                    type="email"
                    value={athlete.email}
                    onChange={e => updateRow(index, 'email', e.target.value)}
                    placeholder="Email address"
                    className="w-full px-3 py-2.5 rounded-lg border border-gray-700 bg-gray-900/50 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-1"
                    style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                  />
                  <input
                    type="tel"
                    value={athlete.phone}
                    onChange={e => updateRow(index, 'phone', e.target.value)}
                    placeholder="Phone (optional)"
                    className="w-full px-3 py-2.5 rounded-lg border border-gray-700 bg-gray-900/50 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-1"
                    style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                  />
                </div>

                {/* Desktop: single row */}
                <div className="hidden md:grid md:grid-cols-[1fr_1fr_1.5fr_1fr_40px] gap-3 items-center">
                  <input
                    type="text"
                    value={athlete.firstName}
                    onChange={e => updateRow(index, 'firstName', e.target.value)}
                    placeholder="First name"
                    className="w-full px-3 py-2.5 rounded-lg border border-gray-700 bg-gray-900/50 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-1"
                    style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                  />
                  <input
                    type="text"
                    value={athlete.lastName}
                    onChange={e => updateRow(index, 'lastName', e.target.value)}
                    placeholder="Last name"
                    className="w-full px-3 py-2.5 rounded-lg border border-gray-700 bg-gray-900/50 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-1"
                    style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                  />
                  <input
                    type="email"
                    value={athlete.email}
                    onChange={e => updateRow(index, 'email', e.target.value)}
                    placeholder="athlete@email.com"
                    className="w-full px-3 py-2.5 rounded-lg border border-gray-700 bg-gray-900/50 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-1"
                    style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                  />
                  <input
                    type="tel"
                    value={athlete.phone}
                    onChange={e => updateRow(index, 'phone', e.target.value)}
                    placeholder="(555) 123-4567"
                    className="w-full px-3 py-2.5 rounded-lg border border-gray-700 bg-gray-900/50 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-1"
                    style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                  />
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    disabled={athletes.length <= 1}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Add athlete button */}
          <button
            type="button"
            onClick={addRow}
            className="mt-3 w-full py-2.5 rounded-lg border-2 border-dashed border-gray-700 text-gray-400 text-sm font-medium hover:border-gray-500 hover:text-gray-300 transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Another Athlete
          </button>

          {/* Athlete count */}
          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-gray-500">
              {athletes.filter(a => a.firstName.trim() && a.lastName.trim() && a.email.trim()).length} athlete{athletes.filter(a => a.firstName.trim() && a.lastName.trim() && a.email.trim()).length !== 1 ? 's' : ''} ready to submit
            </p>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-6 w-full py-4 rounded-lg text-white font-semibold text-base transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
            style={{
              background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 150%)`,
            }}
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Submitting Roster...
              </span>
            ) : (
              'Submit Roster'
            )}
          </button>

          {/* Info footer */}
          <div className="mt-8 rounded-lg border border-gray-700/50 p-4">
            <h3 className="text-sm font-medium text-gray-300 mb-2">What happens next?</h3>
            <div className="space-y-2 text-sm text-gray-500">
              <div className="flex items-start gap-2">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold shrink-0 mt-0.5" style={{ backgroundColor: `${primaryColor}30`, color: primaryColor }}>1</span>
                <span>Each athlete receives a personalized invite email to create their PPL account</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold shrink-0 mt-0.5" style={{ backgroundColor: `${primaryColor}30`, color: primaryColor }}>2</span>
                <span>Athletes are automatically tagged to {school.name}&apos;s roster in the PPL system</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold shrink-0 mt-0.5" style={{ backgroundColor: `${primaryColor}30`, color: primaryColor }}>3</span>
                <span>PPL coaches will have access to your team&apos;s programming and progress</span>
              </div>
            </div>
          </div>

          {/* PPL footer branding */}
          <div className="mt-8 text-center">
            <p className="text-xs text-gray-600">
              Powered by{' '}
              <span className="text-green-500 font-medium">Pitching Performance Lab</span>
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
