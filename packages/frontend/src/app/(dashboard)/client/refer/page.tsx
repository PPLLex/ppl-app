'use client';

/**
 * Refer-a-Friend page (#134).
 *
 * Shows the user's unique referral code + share URL, plus the status
 * of every referral they've made. Reward = 7 booking credits to BOTH
 * parties when the referee makes their first paid invoice.
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type ReferralData = NonNullable<Awaited<ReturnType<typeof api.getMyReferrals>>['data']>;

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-500/20 text-yellow-400',
  REWARDED: 'bg-green-500/20 text-green-400',
  EXPIRED: 'bg-zinc-500/20 text-zinc-400',
};

export default function ReferAFriendPage() {
  const [data, setData] = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.getMyReferrals();
        setData(res.data ?? null);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const copyCode = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.code);
      toast.success('Code copied!');
    } catch {
      toast.error('Could not copy');
    }
  };

  const copyLink = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.shareUrl);
      toast.success('Link copied!');
    } catch {
      toast.error('Could not copy');
    }
  };

  const share = async () => {
    if (!data) return;
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await (navigator as Navigator & { share: (d: ShareData) => Promise<void> }).share({
          title: 'Pitching Performance Lab',
          text: `Train with me at PPL — first week is on us. Use my referral code: ${data.code}`,
          url: data.shareUrl,
        });
      } catch {
        // user cancelled — no-op
      }
    } else {
      void copyLink();
    }
  };

  if (loading) return <div className="text-muted">Loading…</div>;
  if (!data) return <div className="text-muted">Could not load your referral info.</div>;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-foreground">Refer a Friend</h1>
      <p className="text-muted mt-1">
        Send a friend your code. When they make their first payment, you BOTH get a free week
        — 7 booking credits added to your accounts.
      </p>

      <div className="mt-6 bg-gradient-to-br from-[#5E9E50]/10 to-[#95C83C]/10 border border-[#5E9E50]/30 rounded-xl p-6">
        <p className="text-xs uppercase tracking-wide text-muted">Your referral code</p>
        <div className="mt-2 flex items-center gap-3 flex-wrap">
          <span className="font-mono text-3xl text-foreground">{data.code}</span>
          <button
            onClick={copyCode}
            className="text-xs px-3 py-1.5 border border-[#5E9E50]/50 text-[#95C83C] rounded-md hover:bg-[#5E9E50]/10"
          >
            Copy code
          </button>
        </div>
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <code className="text-xs text-muted bg-bg-secondary px-3 py-2 rounded font-mono break-all flex-1 min-w-0">
            {data.shareUrl}
          </code>
          <button
            onClick={copyLink}
            className="text-xs px-3 py-1.5 border border-border rounded-md hover:bg-bg-secondary"
          >
            Copy link
          </button>
          <button
            onClick={share}
            className="text-xs px-3 py-1.5 bg-[#5E9E50] text-white rounded-md hover:bg-[#4a7a3f]"
          >
            Share
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mt-6">
        <Stat label="Total" value={data.summary.total} />
        <Stat label="Pending" value={data.summary.pending} accent="text-yellow-400" />
        <Stat label="Rewarded" value={data.summary.rewarded} accent="text-green-400" />
      </div>

      {data.referredBy && (
        <div className="mt-6 bg-surface border border-border rounded-xl p-5">
          <p className="text-xs uppercase tracking-wide text-muted">You were referred by</p>
          <p className="text-foreground font-semibold mt-1">{data.referredBy.referrerName}</p>
          <p className="text-xs text-muted mt-1">
            Status:{' '}
            <span className={STATUS_COLORS[data.referredBy.status]?.replace('bg-', 'text-') || 'text-foreground'}>
              {data.referredBy.status}
            </span>
            {data.referredBy.rewardedAt && (
              <> · Rewarded {new Date(data.referredBy.rewardedAt).toLocaleDateString()}</>
            )}
          </p>
        </div>
      )}

      <div className="mt-8">
        <h2 className="text-lg font-bold text-foreground mb-3">People you&apos;ve referred</h2>
        {data.referrals.length === 0 ? (
          <p className="text-muted text-sm">No referrals yet — share your code above.</p>
        ) : (
          <div className="space-y-2">
            {data.referrals.map((r) => (
              <div
                key={r.id}
                className="bg-surface border border-border rounded-lg p-4 flex items-center justify-between"
              >
                <div>
                  <p className="font-semibold text-foreground">{r.refereeName}</p>
                  <p className="text-xs text-muted">
                    Joined {new Date(r.registeredAt).toLocaleDateString()}
                    {r.rewardedAt && <> · Rewarded {new Date(r.rewardedAt).toLocaleDateString()}</>}
                    {r.status === 'PENDING' && (
                      <> · Expires {new Date(r.expiresAt).toLocaleDateString()}</>
                    )}
                  </p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[r.status]}`}>
                  {r.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4 text-center">
      <p className={`text-3xl font-bold ${accent ?? 'text-foreground'}`}>{value}</p>
      <p className="text-xs text-muted uppercase tracking-wide mt-1">{label}</p>
    </div>
  );
}
