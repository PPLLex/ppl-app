'use client';

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { api, MembershipPlan, MembershipDetail, PaymentRecord, SubscribeResult } from '@/lib/api';
import StripeCheckout from '@/components/payments/StripeCheckout';

const AGE_GROUP_LABELS: Record<string, string> = {
  college: 'College',
  ms_hs: '13+ (Middle School, High School, College, and Pro)',
  youth: 'Youth (12 & Under)',
};

type AthleteSummary = {
  id: string;
  firstName: string;
  lastName: string;
  ageGroup: string | null;
  relationToParent: string;
};

function ClientMembershipPageInner() {
  const searchParams = useSearchParams();
  // Parents managing multiple kids land here with ?athleteId=X so each
  // sibling's subscription is scoped to their own AthleteProfile. When
  // the param is absent we fall back to the self-managed athlete flow
  // (single user subscribing for themselves).
  const athleteId = searchParams.get('athleteId') || undefined;

  const [membershipData, setMembershipData] = useState<MembershipDetail | null>(null);
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [athletes, setAthletes] = useState<AthleteSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showPlans, setShowPlans] = useState(false);
  const [actionInProgress, setActionInProgress] = useState(false);
  const [checkoutData, setCheckoutData] = useState<SubscribeResult | null>(null);
  const [showPauseModal, setShowPauseModal] = useState(false);

  // Resolve the active athlete (when parent is managing a specific kid).
  // null = self-managed / no selection. Used for the header name +
  // plan filter below.
  const activeAthlete = useMemo<AthleteSummary | null>(() => {
    if (!athleteId) return null;
    return athletes.find((a) => a.id === athleteId) || null;
  }, [athleteId, athletes]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Fire all three in parallel — membership lookup is scoped by
      // athleteId when present; athletes list is used to render the
      // kid's name in the header.
      const [membershipRes, plansRes, athletesRes] = await Promise.all([
        api.getMyMembership(athleteId),
        api.getMembershipPlans(),
        api.getMyAthletes().catch(() => ({ data: [] })),
      ]);
      setMembershipData(membershipRes.data || null);
      if (plansRes.data) setPlans(plansRes.data);
      if (athletesRes.data) setAthletes(athletesRes.data);

      // If no membership for this scope, default to showing plans.
      if (!membershipRes.data) {
        setShowPlans(true);
      } else {
        setShowPlans(false);
      }
    } catch (err) {
      console.error('Failed to load membership data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [athleteId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSubscribe = async (planId: string) => {
    setMessage(null);
    setActionInProgress(true);
    try {
      // Pass athleteId through so parents with multiple kids get one
      // subscription per AthleteProfile rather than a single one on the
      // parent user that gets reused/overwritten.
      const res = await api.subscribe(planId, athleteId);
      if (res.data) {
        // Open Stripe Elements checkout modal
        setCheckoutData(res.data);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to subscribe';
      setMessage({ type: 'error', text: msg });
    } finally {
      setActionInProgress(false);
    }
  };

  const handleCardChangeRequest = async () => {
    setMessage(null);
    setActionInProgress(true);
    try {
      const res = await api.requestCardChange();
      setMessage({
        type: 'success',
        text: res.message || 'Card change request submitted. An admin will send you a secure link.',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Request failed';
      setMessage({ type: 'error', text: msg });
    } finally {
      setActionInProgress(false);
    }
  };

  const handleCancelRequest = async () => {
    if (!confirm('Are you sure you want to request cancellation? An admin will review your request.')) {
      return;
    }

    setMessage(null);
    setActionInProgress(true);
    try {
      const res = await api.requestCancellation();
      setMessage({
        type: 'success',
        text: res.message || 'Cancellation request submitted.',
      });
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Request failed';
      setMessage({ type: 'error', text: msg });
    } finally {
      setActionInProgress(false);
    }
  };

  const formatPrice = (cents: number) => `$${(cents / 100).toFixed(0)}`;
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  if (isLoading) {
    return (
      // Shimmer skeleton matched to membership-card layout (header → big
      // status block → recent payments list).
      <div className="max-w-2xl mx-auto space-y-4" aria-hidden>
        <div className="ppl-skeleton h-8 w-48" />
        <div className="ppl-card space-y-3">
          <div className="ppl-skeleton h-5 w-1/3" />
          <div className="ppl-skeleton h-10 w-1/2" />
          <div className="ppl-skeleton h-4 w-2/3" />
        </div>
        <div className="ppl-card space-y-2">
          <div className="ppl-skeleton h-4 w-1/4" />
          {[1, 2, 3].map((n) => (
            <div key={n} className="ppl-skeleton h-10 w-full" />
          ))}
        </div>
        <span className="sr-only">Loading membership…</span>
      </div>
    );
  }

  const membership = membershipData?.membership;
  const credits = membershipData?.credits;
  const payments = membershipData?.recentPayments || [];

  // When a parent is managing a specific kid, scope the plan list to
  // that athlete's age group so we aren't offering Youth plans to a
  // college athlete (and vice-versa).
  const visiblePlans = activeAthlete?.ageGroup
    ? plans.filter((p) => p.ageGroup === activeAthlete.ageGroup)
    : plans;

  const headerTitle = activeAthlete
    ? `${activeAthlete.firstName}${activeAthlete.lastName ? ' ' + activeAthlete.lastName : ''}`
    : 'My Membership';
  const headerSubtitle = activeAthlete
    ? 'Manage this athlete\u2019s plan, credits, and billing'
    : 'Manage your plan, credits, and billing';

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        {activeAthlete && (
          <p className="text-xs text-muted uppercase tracking-[0.12em] mb-1">
            Membership for
          </p>
        )}
        <h1 className="text-2xl font-bold text-foreground">{headerTitle}</h1>
        <p className="text-muted text-sm mt-1">{headerSubtitle}</p>
      </div>

      {/* Status message */}
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

      {/* Active Membership */}
      {membership ? (
        <>
          {/* Plan Card */}
          <div className="ppl-card mb-4">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-foreground">{membership.plan.name}</h2>
                <p className="text-sm text-muted mt-0.5">
                  {membership.location.name} &middot; Since {formatDate(membership.startedAt)}
                </p>
              </div>
              <div className="text-right">
                <span
                  className={`ppl-badge ${
                    membership.status === 'ACTIVE'
                      ? 'ppl-badge-active'
                      : membership.status === 'PAST_DUE'
                      ? 'ppl-badge-danger'
                      : 'ppl-badge-warning'
                  }`}
                >
                  {membership.status === 'PAST_DUE' ? 'Past Due' : membership.status}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 p-3 bg-surface rounded-lg">
              <div className="text-center">
                <p className="text-2xl font-bold text-accent-text">
                  {formatPrice(membership.plan.priceCents)}
                </p>
                <p className="text-xs text-muted">per week</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-foreground">
                  {membership.plan.sessionsPerWeek === null ? '∞' : membership.plan.sessionsPerWeek}
                </p>
                <p className="text-xs text-muted">sessions/week</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-foreground">{membership.billingDay}</p>
                <p className="text-xs text-muted">billing day</p>
              </div>
            </div>

            {membership.status === 'PAST_DUE' && (
              <div className="mt-4 p-3 bg-danger/10 border border-danger/20 rounded-lg">
                <p className="text-sm text-danger font-medium">
                  Your payment has failed. Please update your card to continue booking sessions.
                </p>
                <button
                  onClick={handleCardChangeRequest}
                  disabled={actionInProgress}
                  className="ppl-btn ppl-btn-primary mt-2 text-sm"
                >
                  Request Card Update
                </button>
              </div>
            )}

            {membership.cancelRequestedAt && (
              <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <p className="text-sm text-amber-400">
                  Cancellation requested on {formatDate(membership.cancelRequestedAt)}. An admin is reviewing your request.
                </p>
              </div>
            )}
          </div>

          {/* Credits Card (for limited plans) */}
          {credits && (
            <div className="ppl-card mb-4">
              <h3 className="font-semibold text-foreground mb-3">This Week&rsquo;s Credits</h3>
              <div className="flex items-center gap-4">
                {/* Credit bar */}
                <div className="flex-1">
                  <div className="h-3 bg-surface rounded-full overflow-hidden">
                    <div
                      className="h-full ppl-gradient rounded-full transition-all"
                      style={{
                        width: `${((credits.total - credits.remaining) / credits.total) * 100}%`,
                      }}
                    />
                  </div>
                  <div className="flex justify-between mt-1.5">
                    <span className="text-xs text-muted">
                      {credits.used} of {credits.total} used
                    </span>
                    <span className="text-xs text-accent-text font-medium">
                      {credits.remaining} remaining
                    </span>
                  </div>
                </div>
                <div className="text-center min-w-[60px]">
                  <p className="text-3xl font-bold text-accent-text">{credits.remaining}</p>
                  <p className="text-xs text-muted">left</p>
                </div>
              </div>
              <p className="text-xs text-muted mt-2">
                Credits reset on {membership.billingDay.toLowerCase()}s when your payment processes.
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="ppl-card mb-4">
            <h3 className="font-semibold text-foreground mb-3">Account Actions</h3>
            <div className="space-y-2">
              <button
                onClick={handleCardChangeRequest}
                disabled={actionInProgress}
                className="ppl-btn ppl-btn-secondary w-full text-left justify-start"
              >
                <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
                Update Payment Card
              </button>
              {membership.status === 'PAUSED' ? (
                <button
                  onClick={async () => {
                    if (!confirm('Resume your membership now? Billing restarts today.')) return;
                    setActionInProgress(true);
                    try {
                      await api.resumeMembership(membership.id);
                      toast.success('Membership resumed');
                      void loadData();
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Resume failed');
                    } finally {
                      setActionInProgress(false);
                    }
                  }}
                  disabled={actionInProgress}
                  className="ppl-btn ppl-btn-primary w-full text-left justify-start"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Resume Membership
                </button>
              ) : (
                <button
                  onClick={() => setShowPauseModal(true)}
                  disabled={actionInProgress || membership.status !== 'ACTIVE'}
                  className="ppl-btn ppl-btn-secondary w-full text-left justify-start"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Pause Membership
                </button>
              )}
              {!membership.cancelRequestedAt && membership.status !== 'PAUSED' && (
                <button
                  onClick={handleCancelRequest}
                  disabled={actionInProgress}
                  className="ppl-btn ppl-btn-secondary w-full text-left justify-start text-danger border-danger/30 hover:bg-danger/10"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Request Cancellation
                </button>
              )}
            </div>
          </div>

          {/* Paused banner — when status is PAUSED, show the resume date and reason */}
          {membership.status === 'PAUSED' && membership.pauseUntil && (
            <div className="mb-4 p-4 rounded-xl bg-blue-500/10 border border-blue-500/30">
              <p className="text-sm font-semibold text-blue-400">Membership paused</p>
              <p className="text-sm text-muted mt-1">
                Auto-resumes on{' '}
                <span className="text-foreground font-medium">{formatDate(membership.pauseUntil)}</span>.
                No payments will be taken in the meantime.
              </p>
            </div>
          )}

          {/* Pause modal */}
          {showPauseModal && (
            <PauseMembershipModal
              onClose={() => setShowPauseModal(false)}
              onConfirm={async (weeks, reason) => {
                setActionInProgress(true);
                try {
                  await api.pauseMembership(membership.id, weeks, reason);
                  toast.success(`Paused for ${weeks} week${weeks === 1 ? '' : 's'}`);
                  setShowPauseModal(false);
                  void loadData();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Pause failed');
                } finally {
                  setActionInProgress(false);
                }
              }}
            />
          )}

          {/* Recent Payments */}
          {payments.length > 0 && (
            <div className="ppl-card">
              <h3 className="font-semibold text-foreground mb-3">Recent Payments</h3>
              <div className="space-y-2">
                {payments.map((payment: PaymentRecord) => (
                  <div
                    key={payment.id}
                    className="flex items-center justify-between p-2 bg-surface rounded-lg"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {formatPrice(payment.amountCents)}
                      </p>
                      <p className="text-xs text-muted">{formatDate(payment.createdAt)}</p>
                    </div>
                    <span
                      className={`ppl-badge ${
                        payment.status === 'SUCCEEDED'
                          ? 'ppl-badge-active'
                          : payment.status === 'FAILED'
                          ? 'ppl-badge-danger'
                          : 'ppl-badge-warning'
                      }`}
                    >
                      {payment.status === 'SUCCEEDED' ? 'Paid' : payment.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        /* No membership — show plan selection */
        <div>
          <div className="ppl-card text-center py-8 mb-6">
            <svg
              className="w-16 h-16 mx-auto text-muted mb-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <h2 className="text-lg font-bold text-foreground mb-1">No Active Membership</h2>
            <p className="text-sm text-muted mb-4">
              Choose a plan below to start booking sessions at PPL.
            </p>
            {!showPlans && (
              <button onClick={() => setShowPlans(true)} className="ppl-btn ppl-btn-primary">
                View Plans
              </button>
            )}
          </div>

          {showPlans && (
            <div>
              <h2 className="text-lg font-semibold text-foreground mb-4">Choose Your Plan</h2>

              {/* Group plans by age group */}
              {Object.entries(
                visiblePlans.reduce<Record<string, MembershipPlan[]>>((groups, plan) => {
                  const group = plan.ageGroup;
                  if (!groups[group]) groups[group] = [];
                  groups[group].push(plan);
                  return groups;
                }, {})
              ).map(([ageGroup, groupPlans]) => (
                <div key={ageGroup} className="mb-6">
                  <h3 className="text-sm font-semibold text-muted uppercase tracking-wider mb-3">
                    {AGE_GROUP_LABELS[ageGroup] || ageGroup}
                  </h3>
                  <div className="space-y-3">
                    {groupPlans.map((plan) => (
                      <div key={plan.id} className="ppl-card flex items-center justify-between">
                        <div className="flex-1">
                          <h4 className="font-semibold text-foreground">{plan.name}</h4>
                          <p className="text-sm text-muted mt-0.5">
                            {plan.sessionsPerWeek === null
                              ? 'Unlimited sessions per week'
                              : `${plan.sessionsPerWeek} session${plan.sessionsPerWeek > 1 ? 's' : ''} per week`}
                          </p>
                          {plan.description && (
                            <p className="text-xs text-muted mt-1">{plan.description}</p>
                          )}
                        </div>
                        <div className="text-right ml-4">
                          <p className="text-2xl font-bold text-accent-text">
                            {formatPrice(plan.priceCents)}
                          </p>
                          <p className="text-xs text-muted">/week</p>
                          <button
                            onClick={() => handleSubscribe(plan.id)}
                            disabled={actionInProgress}
                            className="ppl-btn ppl-btn-primary text-sm mt-2"
                          >
                            {actionInProgress ? 'Processing...' : 'Select'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stripe Checkout Modal */}
      {checkoutData && (
        <StripeCheckout
          clientSecret={checkoutData.clientSecret}
          planName={checkoutData.plan.name}
          priceCents={checkoutData.plan.priceCents}
          billingDay={checkoutData.billingDay}
          onSuccess={() => {
            setCheckoutData(null);
            setMessage({ type: 'success', text: 'Payment successful! Your membership is now active.' });
            loadData();
          }}
          onCancel={() => setCheckoutData(null)}
        />
      )}
    </div>
  );
}

// useSearchParams requires a Suspense boundary for Next.js App Router
// prerendering; the inner component reads `?athleteId=X` so parents
// managing multiple kids each get their own scoped membership view.
export default function ClientMembershipPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-2xl mx-auto space-y-4" aria-hidden>
          <div className="ppl-skeleton h-8 w-48" />
          <div className="ppl-skeleton h-48 rounded-xl" />
        </div>
      }
    >
      <ClientMembershipPageInner />
    </Suspense>
  );
}

// ============================================================
// PauseMembershipModal — picks 1-12 weeks + optional reason
// ============================================================
function PauseMembershipModal({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (weeks: number, reason: string) => void;
}) {
  const [weeks, setWeeks] = useState(2);
  const [reason, setReason] = useState('');

  const resumeDate = new Date(Date.now() + weeks * 7 * 24 * 60 * 60 * 1000);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-surface border border-border rounded-xl p-6 max-w-md w-full">
        <h2 className="text-lg font-bold text-foreground">Pause your membership</h2>
        <p className="text-sm text-muted mt-1">
          We&apos;ll pause your billing and your bookings for the chosen window. Your
          membership resumes automatically — no action required.
        </p>

        <label className="block mt-5 text-sm font-semibold text-foreground">How long?</label>
        <div className="grid grid-cols-6 gap-2 mt-2">
          {[1, 2, 3, 4, 6, 8].map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWeeks(w)}
              className={`py-2 rounded-md text-sm transition ${
                weeks === w
                  ? 'bg-[#5E9E50] text-white'
                  : 'bg-bg-secondary border border-border text-muted hover:text-foreground'
              }`}
            >
              {w}w
            </button>
          ))}
        </div>
        <input
          type="range"
          min={1}
          max={12}
          value={weeks}
          onChange={(e) => setWeeks(Number(e.target.value))}
          className="w-full mt-3"
        />
        <p className="text-xs text-muted mt-1">
          Pausing for <span className="text-foreground font-semibold">{weeks} week{weeks === 1 ? '' : 's'}</span> — resumes on{' '}
          <span className="text-foreground font-semibold">
            {resumeDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>
        </p>

        <label className="block mt-5 text-sm font-semibold text-foreground">
          Reason (optional)
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="ppl-input mt-1"
          placeholder="On vacation, injury recovery, etc."
        />

        <div className="flex justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="ppl-btn ppl-btn-secondary text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(weeks, reason.trim())}
            className="ppl-btn ppl-btn-primary text-sm"
          >
            Pause for {weeks} week{weeks === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}
