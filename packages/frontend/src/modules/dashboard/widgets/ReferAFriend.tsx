'use client';

/**
 * Refer-a-Friend dashboard widget (#134).
 *
 * Compact version of the full /client/refer page. Shows the user's
 * code + a one-click share button + their lifetime rewarded count
 * (so they can see "you've earned 3 free weeks!"). Always present
 * for client-role dashboards — works as a passive nudge.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface ReferralStats {
  code: string;
  shareUrl: string;
  rewarded: number;
  pending: number;
}

export function ReferAFriendWidget() {
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getMyReferrals();
        if (cancelled) return;
        setStats({
          code: res.data!.code,
          shareUrl: res.data!.shareUrl,
          rewarded: res.data!.summary.rewarded,
          pending: res.data!.summary.pending,
        });
      } catch {
        // Silently skip — non-critical widget
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const share = async () => {
    if (!stats) return;
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await (navigator as Navigator & { share: (d: ShareData) => Promise<void> }).share({
          title: 'Pitching Performance Lab',
          text: `Train with me at PPL — first week is on us. Use my code: ${stats.code}`,
          url: stats.shareUrl,
        });
      } catch {
        // user cancelled
      }
    } else {
      try {
        // @ts-expect-error TS narrows navigator to `never` after the share check
        await navigator.clipboard.writeText(stats.shareUrl);
        toast.success('Link copied!');
      } catch {
        toast.error('Could not copy');
      }
    }
  };

  if (loading) {
    return (
      <div className="bg-surface border border-border rounded-xl p-5">
        <p className="text-muted text-sm">Loading…</p>
      </div>
    );
  }
  if (!stats) return null;

  return (
    <div className="bg-gradient-to-br from-[#5E9E50]/10 to-[#95C83C]/10 border border-[#5E9E50]/30 rounded-xl p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-base font-bold text-foreground">Refer a Friend</h3>
          <p className="text-xs text-muted mt-0.5">
            Both get a free week when they join.
          </p>
        </div>
        {stats.rewarded > 0 && (
          <span className="text-xs px-2 py-1 bg-green-500/20 text-green-400 rounded-full whitespace-nowrap">
            🎉 {stats.rewarded} earned
          </span>
        )}
      </div>
      <div className="bg-bg-secondary border border-border rounded-md px-3 py-2 mb-3">
        <p className="text-xs text-muted uppercase tracking-wide">Your code</p>
        <p className="font-mono text-lg text-foreground">{stats.code}</p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={share}
          className="flex-1 px-3 py-2 bg-[#5E9E50] text-white rounded-md text-sm font-semibold hover:bg-[#4a7a3f]"
        >
          Share
        </button>
        <Link
          href="/client/refer"
          className="px-3 py-2 border border-border rounded-md text-sm hover:bg-bg-secondary"
        >
          Details
        </Link>
      </div>
    </div>
  );
}
