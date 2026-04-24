'use client';

/**
 * Client — Educational Resources library.
 *
 * The landing page a client hits when they tap "Browse all →" on the
 * EducationalContent widget. Shows every resource visible to them as
 * a responsive grid of cards grouped by category.
 */

import { useEffect, useState } from 'react';
import Link from '@/components/PageTransitionLink';
import { api } from '@/lib/api';

interface Resource {
  id: string;
  title: string;
  description: string;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  category: string;
}

export default function LearnLibraryPage() {
  const [items, setItems] = useState<Resource[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.request<Resource[]>('/educational-resources');
        setItems(res.data ?? []);
      } catch {
        setItems([]);
      }
    })();
  }, []);

  if (items === null) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <div key={n} className="ppl-skeleton h-60" aria-hidden="true" />
        ))}
      </div>
    );
  }

  // Group by category so parents can scan the library quickly.
  const byCategory = items.reduce<Record<string, Resource[]>>((acc, r) => {
    (acc[r.category] ||= []).push(r);
    return acc;
  }, {});
  const orderedCategories = Object.keys(byCategory).sort();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl uppercase tracking-[0.04em] text-foreground">
          Learn
        </h1>
        <p className="text-sm text-muted mt-1">
          Videos and guides from PPL coaches. Everything you need to get the most out
          of your membership.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="ppl-card text-center py-16">
          <p className="text-sm text-muted">
            New content is on the way. Check back soon.
          </p>
        </div>
      ) : (
        orderedCategories.map((cat) => (
          <section key={cat}>
            <h2 className="font-display uppercase tracking-[0.06em] text-foreground text-sm mb-3">
              {cat}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {byCategory[cat].map((r) => (
                <Link
                  key={r.id}
                  href={`/client/learn/${r.id}`}
                  className="ppl-card hover:border-border-light transition-colors p-0 overflow-hidden flex flex-col"
                >
                  {r.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.thumbnailUrl}
                      alt=""
                      className="w-full h-40 object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-40 bg-surface-hover flex items-center justify-center">
                      <span className="font-display uppercase text-muted text-xs tracking-[0.14em]">
                        PPL
                      </span>
                    </div>
                  )}
                  <div className="p-4 flex-1 flex flex-col">
                    <p className="text-[10px] uppercase tracking-[0.12em] text-accent-text">
                      {r.category}
                    </p>
                    <h3 className="font-semibold text-foreground mt-1 leading-snug line-clamp-2">
                      {r.title}
                    </h3>
                    <p className="text-xs text-muted mt-2 line-clamp-3 flex-1">
                      {r.description}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
