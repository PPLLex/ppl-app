'use client';

import { useAnimatedNumber } from '@/lib/useAnimatedNumber';

/**
 * Animated integer-dollar display — when the `cents` prop changes, the
 * rendered dollar number ease-outs from the previous value to the new one
 * over ~420ms instead of snapping. Respects prefers-reduced-motion.
 *
 * Usage:
 *   <AnimatedPrice cents={plan.priceCents} />
 *
 * Renders just the "$55" portion; callers are responsible for adjacent
 * "/week" or "/mo" text.
 */
export function AnimatedPrice({
  cents,
  className = '',
}: {
  cents: number;
  className?: string;
}) {
  const animatedDollars = useAnimatedNumber(Math.round(cents / 100));
  return (
    <span className={`tabular-nums ${className}`}>${animatedDollars}</span>
  );
}
