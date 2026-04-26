'use client';

/**
 * Tiny status indicator for forms wired with useAutoSaveDraft (#U7).
 * Render next to the submit button so users see "Saving... → Saved 3s ago".
 *
 *   <AutoSaveIndicator status={draft.status} savedAt={draft.savedAt} />
 *
 * Renders nothing when status is 'idle' so it doesn't show up on a
 * fresh form before the user has typed anything.
 */

import { useEffect, useState } from 'react';
import type { AutoSaveStatus } from '@/hooks/useAutoSaveDraft';

export function AutoSaveIndicator({
  status,
  savedAt,
}: {
  status: AutoSaveStatus;
  savedAt: number | null;
}) {
  // Re-tick once a minute so "Saved 3m ago" stays accurate without
  // requiring the parent component to re-render.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (status !== 'saved') return;
    const id = window.setInterval(() => forceTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, [status]);

  if (status === 'idle') return null;
  if (status === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        Saving…
      </span>
    );
  }
  const ago = savedAt ? Math.floor((Date.now() - savedAt) / 1000) : 0;
  const label =
    ago < 5
      ? 'Saved'
      : ago < 60
        ? `Saved ${ago}s ago`
        : `Saved ${Math.floor(ago / 60)}m ago`;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
      {label}
    </span>
  );
}
