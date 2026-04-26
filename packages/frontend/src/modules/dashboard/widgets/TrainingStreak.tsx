'use client';

/**
 * Training Streak widget (#U22 / PREMIUM_AUDIT).
 *
 * Shows the consecutive-week training streak for the calling user (or
 * their athlete). Three visual states:
 *   - 0 weeks: "Start your streak this week" with a gentle CTA
 *   - 1-3 weeks: "Nice — N weeks in a row" (highlight color)
 *   - 4+ weeks: trophy treatment with a personal-best comparison
 *
 * Premium polish:
 *   - Animated count up to the current number on first paint.
 *   - Skeleton-matched layout while loading.
 *   - Subtle gradient on the streak number for the milestone tier (4+).
 */

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface StreakData {
  currentWeeks: number;
  longestWeeks: number;
  thisWeekCompleted: number;
  lastSessionAt: string | null;
}

export function TrainingStreakWidget() {
  const [data, setData] = useState<StreakData | null>(null);
  const [loading, setLoading] = useState(true);
  const [animatedCurrent, setAnimatedCurrent] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .getMyStreak()
      .then((res) => {
        if (cancelled) return;
        if (res.data) setData(res.data);
      })
      .catch(() => {
        // Silent — widget renders zero-state on error.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Count-up animation — 0 → currentWeeks over ~700ms.
  useEffect(() => {
    if (!data) return;
    const target = data.currentWeeks;
    if (target === 0) {
      setAnimatedCurrent(0);
      return;
    }
    const duration = 700;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const progress = Math.min(1, (t - start) / duration);
      // ease-out
      const eased = 1 - Math.pow(1 - progress, 3);
      setAnimatedCurrent(Math.round(eased * target));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [data]);

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="ppl-skeleton h-8 w-24 rounded" />
        <div className="ppl-skeleton h-4 w-44 rounded" />
        <div className="ppl-skeleton h-3 w-32 rounded" />
      </div>
    );
  }

  if (!data) return null;

  const isMilestone = data.currentWeeks >= 4;
  const isStarting = data.currentWeeks === 0;
  const isPersonalBest =
    data.currentWeeks > 0 && data.currentWeeks === data.longestWeeks && data.longestWeeks >= 2;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <span
          className={`font-stat tabular-nums leading-none text-5xl ${
            isMilestone
              ? 'bg-gradient-to-br from-highlight to-amber-400 bg-clip-text text-transparent'
              : 'text-foreground'
          }`}
        >
          {animatedCurrent}
        </span>
        <span className="text-sm text-muted pb-1">
          week{animatedCurrent === 1 ? '' : 's'}
        </span>
      </div>

      {isStarting ? (
        <p className="text-sm text-muted">
          Book a session this week to start your streak.
        </p>
      ) : (
        <p className="text-sm text-foreground/90">
          {isMilestone ? '🔥 ' : ''}
          {data.currentWeeks} {data.currentWeeks === 1 ? 'week' : 'weeks'} in a row
          {isPersonalBest && data.currentWeeks >= 2 && (
            <span className="text-accent-text"> · personal best</span>
          )}
        </p>
      )}

      <div className="text-xs text-muted">
        {data.thisWeekCompleted > 0 && (
          <>This week: {data.thisWeekCompleted} session{data.thisWeekCompleted === 1 ? '' : 's'}</>
        )}
        {data.thisWeekCompleted > 0 && data.longestWeeks > data.currentWeeks && ' · '}
        {data.longestWeeks > data.currentWeeks && (
          <>Best run: {data.longestWeeks} weeks</>
        )}
      </div>
    </div>
  );
}
