'use client';

/**
 * Client — Educational Resource detail view.
 *
 * Shows one resource: title, description, embedded video (if present),
 * and markdown body (if present). Back link returns to the library.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from '@/components/PageTransitionLink';
import { api } from '@/lib/api';

interface Resource {
  id: string;
  title: string;
  description: string;
  body: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  category: string;
}

/**
 * Convert a YouTube watch URL into its embed equivalent. Leaves other
 * URLs alone. Supports the common share + watch link formats.
 */
function toEmbedUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') {
      return `https://www.youtube.com/embed/${u.pathname.slice(1)}`;
    }
    if (u.hostname.includes('youtube.com') && u.searchParams.get('v')) {
      return `https://www.youtube.com/embed/${u.searchParams.get('v')}`;
    }
    return url;
  } catch {
    return url;
  }
}

export default function LearnDetailPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : (params.id as string);
  const [resource, setResource] = useState<Resource | null | undefined>(undefined);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.request<Resource>(`/educational-resources/${id}`);
        setResource(res.data ?? null);
      } catch {
        setResource(null);
      }
    })();
  }, [id]);

  if (resource === undefined) {
    return (
      <div className="space-y-4 max-w-3xl">
        <div className="ppl-skeleton h-6 w-32" aria-hidden="true" />
        <div className="ppl-skeleton h-8 w-3/4" aria-hidden="true" />
        <div className="ppl-skeleton aspect-video w-full" aria-hidden="true" />
      </div>
    );
  }

  if (!resource) {
    return (
      <div className="max-w-3xl">
        <Link
          href="/client/learn"
          className="text-sm text-muted hover:text-foreground"
        >
          ← Back to library
        </Link>
        <div className="ppl-card text-center py-16 mt-4">
          <p className="text-sm text-muted">Resource not found or no longer available.</p>
        </div>
      </div>
    );
  }

  const embedUrl = resource.videoUrl ? toEmbedUrl(resource.videoUrl) : null;

  return (
    <div className="max-w-3xl space-y-4">
      <Link
        href="/client/learn"
        className="text-sm text-muted hover:text-foreground inline-block"
      >
        ← Back to library
      </Link>

      <div>
        <p className="text-[11px] uppercase tracking-[0.14em] text-accent-text">
          {resource.category}
        </p>
        <h1 className="font-display text-2xl uppercase tracking-[0.04em] text-foreground mt-2">
          {resource.title}
        </h1>
        <p className="text-sm text-muted mt-2 leading-relaxed">
          {resource.description}
        </p>
      </div>

      {embedUrl && (
        <div className="aspect-video w-full rounded-xl overflow-hidden border border-border bg-black">
          <iframe
            src={embedUrl}
            title={resource.title}
            className="w-full h-full"
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
      )}

      {resource.body && (
        <div className="ppl-card">
          {/* Renders the body as preformatted text — if we adopt a
              markdown renderer later we can swap to that here without
              touching the data or API shape. */}
          <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
            {resource.body}
          </div>
        </div>
      )}
    </div>
  );
}
