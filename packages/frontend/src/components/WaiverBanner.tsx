'use client';

/**
 * WaiverBanner — renders above the client dashboard grid when one or
 * more athletes in the user's family have NOT signed the current
 * liability waiver version. Quietly unmounts once everyone is signed.
 *
 * Intentionally not a Dashboard widget — it's a full-width warning
 * banner, not a grid tile, and it affects ALL role configs. Keeping it
 * as a page-level component avoids having to duplicate logic per role
 * config.
 */

import { useEffect, useState } from 'react';
import Link from '@/components/PageTransitionLink';
import { api } from '@/lib/api';

interface UnsignedAthlete {
  athleteProfileId: string;
  athleteName: string;
}

export function WaiverBanner() {
  const [unsigned, setUnsigned] = useState<UnsignedAthlete[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getWaiverStatus();
        if (cancelled) return;
        const list = (res.data?.athletes || [])
          .filter((a) => !a.signed)
          .map((a) => ({
            athleteProfileId: a.athleteProfileId,
            athleteName: a.athleteName,
          }));
        setUnsigned(list);
      } catch {
        if (!cancelled) setUnsigned([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!unsigned || unsigned.length === 0) return null;

  const names =
    unsigned.length === 1
      ? unsigned[0].athleteName
      : unsigned.length === 2
        ? `${unsigned[0].athleteName} and ${unsigned[1].athleteName}`
        : `${unsigned
            .slice(0, -1)
            .map((u) => u.athleteName)
            .join(', ')}, and ${unsigned[unsigned.length - 1].athleteName}`;

  return (
    <div className="mb-6 p-5 rounded-xl border-2 border-amber-500/40 bg-amber-500/10">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
          <svg
            className="w-5 h-5 text-amber-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-bold text-foreground">Liability waiver required</h2>
          <p className="text-sm text-foreground/80 mt-1">
            {unsigned.length === 1
              ? `${names} needs a signed liability waiver before their next booking.`
              : `${names} need signed liability waivers before their next bookings.`}
          </p>
          <Link
            href="/client/waiver"
            className="ppl-btn ppl-btn-primary text-sm mt-3 inline-block"
          >
            Sign now
          </Link>
        </div>
      </div>
    </div>
  );
}
