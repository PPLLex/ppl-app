'use client';

/**
 * Animated number counter (PREMIUM_AUDIT P13).
 *
 * Counts up from 0 to the target value over `durationMs`, with an
 * ease-out curve so the start is fast and the end is gentle. Used in
 * stat cards across the admin dashboards so the page feels alive on
 * load instead of cold-flashing the final number.
 *
 *   <AnimatedNumber value={1247} />
 *   <AnimatedNumber value={29.5} decimals={1} suffix="%" />
 *   <AnimatedNumber value={4250} prefix="$" />
 *
 * Respects prefers-reduced-motion: snaps directly to value if so.
 */

import { useEffect, useRef, useState } from 'react';

interface Props {
  value: number;
  durationMs?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}

export function AnimatedNumber({
  value,
  durationMs = 900,
  decimals = 0,
  prefix = '',
  suffix = '',
  className,
}: Props) {
  const [display, setDisplay] = useState<number>(value);
  const fromRef = useRef<number>(0);
  const startedAtRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // Honor reduced-motion preference — snap, don't animate
    if (
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setDisplay(value);
      return;
    }

    fromRef.current = display;
    startedAtRef.current = performance.now();
    const target = value;

    // ease-out cubic feels best for stat counters
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

    const tick = (now: number) => {
      const elapsed = now - startedAtRef.current;
      const t = Math.min(1, elapsed / durationMs);
      const eased = easeOut(t);
      setDisplay(fromRef.current + (target - fromRef.current) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(target);
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs]);

  const formatted = display.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return (
    <span className={className}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
