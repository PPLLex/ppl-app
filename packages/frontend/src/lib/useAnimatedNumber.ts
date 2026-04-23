'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Animate a number toward a target value with an ease-out curve. Used for
 * price counters ("$55 → $90" when toggling hitting), stat card counts
 * ticking up as they load, etc. — the "feel alive, not just render" move.
 *
 * Respects `prefers-reduced-motion` (skips the animation and returns the
 * final value immediately).
 *
 * @param target        The value to animate to.
 * @param durationMs    Animation duration (default 420ms).
 * @param skipFirstRender If true, the first mount snaps to `target` instead
 *                      of animating from 0. Use on load to avoid "0 → 127"
 *                      flash on dashboards. Default true.
 *
 * Returns the current animating integer value.
 */
export function useAnimatedNumber(
  target: number,
  durationMs = 420,
  skipFirstRender = true
): number {
  const [display, setDisplay] = useState(skipFirstRender ? target : 0);
  const fromRef = useRef<number>(skipFirstRender ? target : 0);
  const rafRef = useRef<number | null>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    // Honor reduced-motion — go straight to the target, no interpolation.
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      setDisplay(target);
      fromRef.current = target;
      return;
    }

    // Skip animation on first render if asked — prevents the 0-to-N flash
    // on mount.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      if (skipFirstRender) {
        setDisplay(target);
        fromRef.current = target;
        return;
      }
    }

    // Same-value no-op (React sometimes calls effects unnecessarily).
    if (fromRef.current === target) return;

    const from = fromRef.current;
    const delta = target - from;
    const start = performance.now();

    const step = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / durationMs);
      // Ease-out cubic — fast at start, smooth settle at end.
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + delta * eased));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = target;
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs, skipFirstRender]);

  return display;
}
