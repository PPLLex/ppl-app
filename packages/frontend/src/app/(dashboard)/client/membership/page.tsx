'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, MembershipPlan, MembershipDetail, PaymentRecord, SubscribeResult } from '@/lib/api';
import StripeCheckout from '@/components/payments/StripeCheckout';

const AGE_GROUP_LABELS: Record<string, string> = {
  college: 'College',
  ms_hs: '13+ (Middle School, High School, College, and Pro)',
  youth: 'Youth (12 & Under)',
};

export default function ClientMembershipPage() {
  const [membershipData, setMembershipData] = useState<MembershipDetail | null>(null);
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showPlans, setShowPlans] = useState(false);
  const [actionInProgress, setActionInProgress] = useState(false);
  const [checkoutData, setCheckoutData] = useState<SubscribeResult | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [membershipRes, plansRes] = await Promise.all([
        api.getMyMembership(),
        api.getMembershipPlans(),
      ]);
      setMembershipData(membershipRes.data || null);
      if (plansRes.data) setPlans(plansRes.data);

      // If no membership, show plan selection
      if (!membershipRes.data) {
        setShowPlans(true);
      }
    } catch (err) {
      console.error('Failed to load membership data:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSubscribe = async (planId: string) => {
    setMessage(null);
    setActionInProgress(true);
    try {
      const res = await api.subscribe(planId);
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
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="h-8 bg-surface-hover rounded animate-pulse w-48" />
        <div className="ppl-card animate-pulse h-48" />
        <div className="ppl-card animate-pulse h-32" />
      </div>
    );
  }

  const membership = membershipData?.membership;
  const credits = membershipData?.credits;
  const payments = membershipData?.recentPayments || [];

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">My Membership</h1>
        <p className="text-muted text-sm mt-1">Manage your plan, credits, and billing</p>
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
              {!membership.cancelRequestedAt && (
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
                plans.reduce<Record<string, MembershipPlan[]>>((groups, plan) => {
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
