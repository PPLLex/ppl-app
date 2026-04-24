'use client';

/**
 * EducationalContent widget — parent dashboard.
 *
 * Shows up to 3 admin-curated resources (videos / guides / onboarding
 * explainers) filtered to the current user's age group. Each card is a
 * tap target that routes to the full resource view. When an admin
 * hasn't published anything yet, falls back to a welcoming CTA.
 *
 * Data source: /api/educational-resources (list).
 */

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import Link from '@/components/PageTransitionLink';
import type { WidgetProps } from '../types';

interface ResourceRow {
  id: string;
  title: string;
  description: string;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  category: string;
}

export function EducationalContentWidget(_props: WidgetProps) {
  const [items, setItems] = useState<ResourceRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.request<ResourceRow[]>('/educational-resources');
        if (!cancelled) setItems((res.data ?? []).slice(0, 3));
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (items === null) {
    return (
      <div className="flex gap-3 overflow-hidden">
        <div className="ppl-skeleton h-20 w-40 flex-shrink-0" aria-hidden="true" />
        <div className="ppl-skeleton h-20 w-40 flex-shrink-0" aria-hidden="true" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col h-full justify-between gap-2">
        <p className="text-sm text-muted leading-snug">
          Videos and guides explaining everything included with your membership.
          New content drops weekly.
        </p>
        <p className="text-[11px] uppercase tracking-[0.14em] text-foreground/60">
          Library launching soon
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-3">
      <ul className="flex gap-3 overflow-x-auto -mx-1 px-1 pb-1 flex-1">
        {items.map((r) => (
          <li key={r.id} className="flex-shrink-0 w-48">
            <Link
              href={`/client/learn/${r.id}`}
              className="block rounded-lg border border-border bg-background/50 hover:border-border-light transition-colors p-3 h-full"
            >
              {r.thumbnailUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={r.thumbnailUrl}
                  alt=""
                  className="w-full h-20 object-cover rounded mb-2"
                  loading="lazy"
                />
              )}
              <p className="text-[10px] uppercase tracking-[0.12em] text-accent-text font-medium">
                {r.category}
              </p>
              <p className="text-sm font-semibold text-foreground mt-1 leading-snug line-clamp-2">
                {r.title}
              </p>
              <p className="text-[11px] text-muted mt-1 leading-snug line-clamp-2">
                {r.description}
              </p>
            </Link>
          </li>
        ))}
      </ul>
      <Link
        href="/client/learn"
        className="text-xs font-medium text-accent-text hover:brightness-110 self-start"
      >
        Browse all →
      </Link>
    </div>
  );
}
