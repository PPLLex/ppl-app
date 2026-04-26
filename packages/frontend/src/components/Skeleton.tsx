'use client';

/**
 * Skeleton loaders (#143).
 *
 * Replaces bare spinners across the app. Premium apps don't show
 * "I'm thinking" — they show "here's the SHAPE of what's coming so
 * your eye can settle in advance." Width-matched, height-matched,
 * subtle shimmer. CSS-only animation (no JS) to keep it cheap.
 *
 * Usage:
 *   <SkeletonLine width="60%" />          // single text line
 *   <SkeletonText lines={3} />            // multi-line block
 *   <SkeletonCard />                      // generic card placeholder
 *   <SkeletonStat />                      // stat-card placeholder
 *   <SkeletonRow />                       // list-row placeholder
 *   <SkeletonGrid cols={3} count={6} />   // grid of skeleton cards
 */

import React from 'react';

// Reuses the existing `.ppl-skeleton` class defined in globals.css —
// it already has a brand-tuned shimmer keyframe and respects
// prefers-reduced-motion.
const SHIMMER_BG = 'ppl-skeleton';

export function SkeletonLine({
  width = '100%',
  height = '0.875rem',
  className = '',
}: {
  width?: string;
  height?: string;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={`rounded ${SHIMMER_BG} ${className}`}
      style={{ width, height }}
    />
  );
}

export function SkeletonText({
  lines = 3,
  className = '',
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine key={i} width={i === lines - 1 ? '70%' : '100%'} />
      ))}
    </div>
  );
}

export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`bg-surface border border-border rounded-xl p-5 ${className}`}>
      <SkeletonLine width="40%" height="0.75rem" className="mb-3" />
      <SkeletonLine width="80%" height="1.25rem" className="mb-4" />
      <SkeletonText lines={2} />
    </div>
  );
}

export function SkeletonStat({ className = '' }: { className?: string }) {
  return (
    <div className={`bg-surface border border-border rounded-xl p-4 ${className}`}>
      <SkeletonLine width="50%" height="0.75rem" className="mb-3" />
      <SkeletonLine width="60%" height="2rem" />
    </div>
  );
}

export function SkeletonRow({ className = '' }: { className?: string }) {
  return (
    <div
      className={`bg-surface border border-border rounded-lg p-4 flex items-center gap-3 ${className}`}
    >
      <div className={`w-10 h-10 rounded-full ${SHIMMER_BG}`} />
      <div className="flex-1 space-y-2">
        <SkeletonLine width="40%" height="1rem" />
        <SkeletonLine width="60%" height="0.75rem" />
      </div>
      <SkeletonLine width="60px" height="1.5rem" className="rounded-full" />
    </div>
  );
}

export function SkeletonGrid({
  cols = 3,
  count = 6,
  className = '',
}: {
  cols?: number;
  count?: number;
  className?: string;
}) {
  const gridCols =
    cols === 1
      ? 'grid-cols-1'
      : cols === 2
      ? 'grid-cols-1 sm:grid-cols-2'
      : cols === 4
      ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
      : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
  return (
    <div className={`grid ${gridCols} gap-4 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonList({
  count = 5,
  className = '',
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={`space-y-3 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}
