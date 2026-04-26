'use client';

/**
 * Reusable empty-state component (PREMIUM_AUDIT U3 + P1).
 *
 * Replaces generic "No data" placeholders with a branded SVG icon,
 * friendly title, helpful description, and an explicit primary CTA.
 * Premium apps never end on dead air — every empty state offers the
 * obvious next step.
 *
 *   <EmptyState
 *     icon="search"
 *     title="No leads match your filters"
 *     description="Try clearing a filter, or capture a new lead."
 *     action={<Link href="/admin/crm/new" className="ppl-btn ppl-btn-primary text-sm">+ New lead</Link>}
 *   />
 */

import React from 'react';
import Link from 'next/link';

type IconKind =
  | 'search'
  | 'inbox'
  | 'calendar'
  | 'users'
  | 'sparkle'
  | 'note'
  | 'tag'
  | 'workflow'
  | 'shield'
  | 'star';

const ICON_PATHS: Record<IconKind, React.ReactNode> = {
  search: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  ),
  inbox: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0l-2 5a2 2 0 01-2 1H8a2 2 0 01-2-1l-2-5m16 0H4" />
  ),
  calendar: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  ),
  users: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
  ),
  sparkle: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
  ),
  note: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  ),
  tag: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
  ),
  workflow: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
  ),
  shield: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
  ),
  star: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
  ),
};

export function EmptyState({
  icon = 'inbox',
  title,
  description,
  action,
  href,
  ctaLabel,
  className = '',
}: {
  icon?: IconKind;
  title: string;
  description?: string;
  /** Custom action element. If omitted, renders a CTA from `href` + `ctaLabel`. */
  action?: React.ReactNode;
  href?: string;
  ctaLabel?: string;
  className?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden bg-surface border border-border rounded-xl py-12 px-6 text-center ${className}`}
    >
      {/* Soft brand-gradient halo behind the icon for warmth and depth */}
      <div
        aria-hidden
        className="absolute top-0 left-1/2 -translate-x-1/2 w-72 h-72 bg-gradient-to-br from-[#5E9E50]/10 via-[#95C83C]/5 to-transparent blur-3xl pointer-events-none"
      />
      <div className="relative">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-[#5E9E50]/10 border border-[#5E9E50]/20 text-[#95C83C] mb-4">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            {ICON_PATHS[icon]}
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        {description && <p className="text-sm text-muted mt-1 max-w-sm mx-auto">{description}</p>}
        {(action || href) && (
          <div className="mt-5 flex justify-center">
            {action ?? (
              <Link href={href!} className="ppl-btn ppl-btn-primary text-sm">
                {ctaLabel ?? 'Get Started'}
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
