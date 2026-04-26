'use client';

/**
 * Admin promo-code management (#138).
 *
 * Two views:
 *   - List of all promo codes (active + archived) with redemption counts.
 *   - Inline "create new code" form that mirrors to Stripe on submit.
 *
 * Editing once a code exists is intentionally limited (label + archive).
 * Stripe doesn't allow editing the discount math on a Coupon — admins
 * must archive + create a new code.
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type Promo = Awaited<ReturnType<typeof api.listPromoCodes>>['data'] extends (infer T)[] | undefined
  ? T
  : never;

const formatPercent = (n: number | null) => (n ? `${n}%` : '—');
const formatCents = (cents: number | null) =>
  cents !== null && cents !== undefined ? `$${(cents / 100).toFixed(2)}` : '—';
const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString() : '—';

export default function AdminPromoCodesPage() {
  const [promos, setPromos] = useState<Promo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  // Create form state
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [discountType, setDiscountType] = useState<'PERCENT_OFF' | 'AMOUNT_OFF'>('PERCENT_OFF');
  const [percentOff, setPercentOff] = useState('');
  const [amountOffDollars, setAmountOffDollars] = useState('');
  const [duration, setDuration] = useState<'ONCE' | 'REPEATING' | 'FOREVER'>('ONCE');
  const [durationInMonths, setDurationInMonths] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.listPromoCodes();
      if (res.data) setPromos(res.data);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not load promo codes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const resetForm = () => {
    setCode('');
    setLabel('');
    setDiscountType('PERCENT_OFF');
    setPercentOff('');
    setAmountOffDollars('');
    setDuration('ONCE');
    setDurationInMonths('');
    setMaxRedemptions('');
    setExpiresAt('');
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.createPromoCode({
        code: code.trim().toUpperCase(),
        label: label.trim(),
        discountType,
        percentOff: discountType === 'PERCENT_OFF' ? Number(percentOff) : null,
        amountOffCents:
          discountType === 'AMOUNT_OFF'
            ? Math.round(Number(amountOffDollars) * 100)
            : null,
        duration,
        durationInMonths: duration === 'REPEATING' ? Number(durationInMonths) : null,
        maxRedemptions: maxRedemptions ? Number(maxRedemptions) : null,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
      toast.success(`Created ${code.toUpperCase()}`);
      resetForm();
      setShowCreate(false);
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not create promo code');
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchive = async (promo: Promo) => {
    if (!promo.isActive) return;
    if (!confirm(`Archive ${promo.code}? Existing subscriptions keep their discount; new redemptions will be blocked.`)) {
      return;
    }
    try {
      await api.updatePromoCode(promo.id, { isActive: false });
      toast.success(`Archived ${promo.code}`);
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Archive failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Promo Codes</h1>
          <p className="text-sm text-muted mt-0.5">
            Discounts that mirror to Stripe Coupons. Apply automatically on subscription create.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="ppl-btn ppl-btn-primary"
        >
          {showCreate ? 'Cancel' : 'New promo code'}
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="ppl-card p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Code</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="SUMMER2026"
                className="ppl-input font-mono uppercase"
                required
              />
              <p className="text-xs text-muted mt-1">A–Z, 0–9, hyphens, underscores. 3–32 chars.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Internal label</label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Summer 2026 youth promo"
                className="ppl-input"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Discount type</label>
              <select
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as 'PERCENT_OFF' | 'AMOUNT_OFF')}
                className="ppl-input"
              >
                <option value="PERCENT_OFF">Percent off</option>
                <option value="AMOUNT_OFF">Flat amount off</option>
              </select>
            </div>
            <div>
              {discountType === 'PERCENT_OFF' ? (
                <>
                  <label className="block text-sm font-medium text-foreground mb-1">Percent (1–100)</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={percentOff}
                    onChange={(e) => setPercentOff(e.target.value)}
                    placeholder="20"
                    className="ppl-input"
                    required
                  />
                </>
              ) : (
                <>
                  <label className="block text-sm font-medium text-foreground mb-1">Amount off (USD)</label>
                  <input
                    type="number"
                    step="0.01"
                    min={0.01}
                    value={amountOffDollars}
                    onChange={(e) => setAmountOffDollars(e.target.value)}
                    placeholder="25.00"
                    className="ppl-input"
                    required
                  />
                </>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Duration</label>
              <select
                value={duration}
                onChange={(e) => setDuration(e.target.value as 'ONCE' | 'REPEATING' | 'FOREVER')}
                className="ppl-input"
              >
                <option value="ONCE">Once (first invoice only)</option>
                <option value="REPEATING">Repeating (N months)</option>
                <option value="FOREVER">Forever</option>
              </select>
            </div>
            {duration === 'REPEATING' && (
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Months (1–24)</label>
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={durationInMonths}
                  onChange={(e) => setDurationInMonths(e.target.value)}
                  className="ppl-input"
                  required
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Max redemptions (optional)</label>
              <input
                type="number"
                min={1}
                value={maxRedemptions}
                onChange={(e) => setMaxRedemptions(e.target.value)}
                placeholder="Unlimited"
                className="ppl-input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Expires (optional)</label>
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="ppl-input"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => {
                resetForm();
                setShowCreate(false);
              }}
              className="ppl-btn"
            >
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="ppl-btn ppl-btn-primary">
              {submitting ? 'Creating...' : 'Create + mirror to Stripe'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="ppl-skeleton h-14 rounded-lg" />
          ))}
        </div>
      ) : promos.length === 0 ? (
        <div className="ppl-card p-10 text-center">
          <p className="text-foreground font-medium">No promo codes yet</p>
          <p className="text-sm text-muted mt-1">Create one to start running launch promos and referral bonuses.</p>
        </div>
      ) : (
        <div className="ppl-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-background/50 text-muted text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Code</th>
                <th className="px-4 py-3 text-left">Label</th>
                <th className="px-4 py-3 text-left">Discount</th>
                <th className="px-4 py-3 text-left">Duration</th>
                <th className="px-4 py-3 text-left">Redeemed</th>
                <th className="px-4 py-3 text-left">Expires</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {promos.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-4 py-3 font-mono text-foreground">
                    {p.code}
                    {!p.isActive && (
                      <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-surface text-muted">
                        Archived
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-foreground">{p.label}</td>
                  <td className="px-4 py-3 text-foreground">
                    {p.discountType === 'PERCENT_OFF'
                      ? formatPercent(p.percentOff)
                      : formatCents(p.amountOffCents)}
                  </td>
                  <td className="px-4 py-3 text-muted text-xs">
                    {p.duration === 'ONCE'
                      ? 'Once'
                      : p.duration === 'REPEATING'
                        ? `${p.durationInMonths} months`
                        : 'Forever'}
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    {p.redemptionCount}
                    {p.maxRedemptions ? ` / ${p.maxRedemptions}` : ''}
                  </td>
                  <td className="px-4 py-3 text-muted text-xs">{formatDate(p.expiresAt)}</td>
                  <td className="px-4 py-3 text-right">
                    {p.isActive && (
                      <button
                        type="button"
                        onClick={() => handleArchive(p)}
                        className="text-xs text-muted hover:text-danger transition-colors"
                      >
                        Archive
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
