'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

interface PendingReview {
  onboardingRecordId: string;
  athleteProfileId: string;
  createdAt: string;
  selfReportedStatus: string;
  athlete: {
    id: string;
    fullName: string;
    email: string;
    phone: string | null;
    createdAt: string;
    location: { id: string; name: string } | null;
  };
}

export default function OnboardingReviewsPage() {
  const [reviews, setReviews] = useState<PendingReview[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [chargingId, setChargingId] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.getPendingOnboardingReviews();
      if (res.data) setReviews(res.data);
    } catch (err) {
      console.error('Failed to load reviews:', err);
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to load pending reviews',
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCharge = async (recordId: string) => {
    setChargingId(recordId);
    setMessage(null);
    try {
      const res = await api.chargeOnboardingFee(recordId, note.trim() || undefined);
      setMessage({
        type: 'success',
        text: res.message || 'Fee marked as required. Athlete has been emailed.',
      });
      setConfirmingId(null);
      setNote('');
      await load();
    } catch (err: unknown) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to charge fee',
      });
    } finally {
      setChargingId(null);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Onboarding Reviews</h1>
        <p className="text-sm text-muted mt-0.5">
          Athletes who claimed to be returning during signup. Verify against PPL records and
          charge the $300 fee if needed.
        </p>
      </div>

      <div className="mb-4 p-3 rounded-lg bg-surface border border-border text-sm text-muted">
        <strong className="text-foreground">Only one admin can charge per signup.</strong>{' '}
        When you click &ldquo;Charge $300&rdquo;, the system atomically marks the fee as
        required — if another admin has already acted on the same signup, you&apos;ll get an
        &ldquo;already processed&rdquo; error and nothing happens. No double-billing possible.
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

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => (
            <div key={n} className="ppl-card animate-pulse h-28" />
          ))}
        </div>
      ) : reviews.length === 0 ? (
        <div className="ppl-card text-center py-12">
          <p className="text-muted">
            No pending reviews. Returning-athlete signups will appear here for verification.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map((r) => (
            <div key={r.onboardingRecordId} className="ppl-card">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h2 className="text-lg font-bold text-foreground">{r.athlete.fullName}</h2>
                    <span className="ppl-badge ppl-badge-warning">Claims returning</span>
                  </div>
                  <div className="text-sm text-muted space-y-0.5">
                    <p>{r.athlete.email}</p>
                    {r.athlete.phone && <p>{r.athlete.phone}</p>}
                    <p>Location: {r.athlete.location?.name || 'Unassigned'}</p>
                    <p className="text-xs mt-1">Signed up {formatDate(r.createdAt)}</p>
                  </div>
                </div>

                {confirmingId === r.onboardingRecordId ? (
                  <div className="flex-shrink-0 w-72">
                    <label className="text-xs font-medium text-muted block mb-1">
                      Optional note to athlete
                    </label>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="ppl-input mb-2 text-sm"
                      rows={2}
                      placeholder="(Optional) Why they owe the fee…"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setConfirmingId(null);
                          setNote('');
                        }}
                        disabled={chargingId === r.onboardingRecordId}
                        className="ppl-btn ppl-btn-secondary text-xs flex-1"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleCharge(r.onboardingRecordId)}
                        disabled={chargingId === r.onboardingRecordId}
                        className="ppl-btn ppl-btn-primary text-xs flex-1"
                      >
                        {chargingId === r.onboardingRecordId
                          ? 'Charging…'
                          : 'Confirm $300 charge'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmingId(r.onboardingRecordId)}
                    className="ppl-btn ppl-btn-primary text-sm flex-shrink-0"
                  >
                    Charge $300
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
