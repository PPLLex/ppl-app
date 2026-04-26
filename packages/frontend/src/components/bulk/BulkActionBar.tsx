'use client';

/**
 * Floating bulk-action bar (#U8). Pops in from the bottom of the
 * viewport when one or more rows on a list page are selected.
 *
 * Designed to slot into ANY list — pass:
 *   - selectedCount: how many rows are currently selected
 *   - onClear: callback to deselect everything
 *   - children: the page-specific action buttons (Tag, Archive, etc.)
 *
 * Visual treatment matches the rest of the premium polish: backdrop
 * blur + green-tinted border + slide-up entrance animation. Sticks
 * 16px above the bottom of the screen so it never overlaps with
 * mobile-Safari's home indicator area.
 */

import type { ReactNode } from 'react';

export interface BulkActionBarProps {
  selectedCount: number;
  onClear: () => void;
  children: ReactNode;
  /** Override the noun in the count label. Defaults to 'item'. */
  noun?: string;
}

export function BulkActionBar({
  selectedCount,
  onClear,
  children,
  noun = 'item',
}: BulkActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div
      className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 animate-[slideUp_180ms_ease-out_forwards]"
      // Slide-up keyframe inline so we don't need a tailwind config edit.
      style={{
        // @ts-expect-error CSS custom property
        '--tw-translate-y': '0px',
      }}
    >
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translate(-50%, 12px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
      <div
        className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-highlight/40 bg-background/85 backdrop-blur-md shadow-2xl shadow-black/40"
      >
        <span className="text-sm text-foreground font-medium whitespace-nowrap">
          {selectedCount} {noun}
          {selectedCount === 1 ? '' : 's'} selected
        </span>
        <div className="h-5 w-px bg-border" aria-hidden />
        <div className="flex items-center gap-2 flex-wrap">{children}</div>
        <div className="h-5 w-px bg-border" aria-hidden />
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-muted hover:text-foreground transition-colors px-2 py-1"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

/**
 * Tiny helper hook for the very common "set of selected IDs" pattern.
 * Returns { selected, isSelected, toggle, set, clear, allSelected,
 * toggleAll, count }. Keeps the bookkeeping out of every list page.
 */
import { useCallback, useMemo, useState } from 'react';

export function useRowSelection(allIds: string[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const isSelected = useCallback(
    (id: string) => selected.has(id),
    [selected]
  );

  const toggle = useCallback((id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const set = useCallback((ids: string[]) => setSelected(new Set(ids)), []);

  const allSelected = useMemo(
    () => allIds.length > 0 && allIds.every((id) => selected.has(id)),
    [allIds, selected]
  );

  const toggleAll = useCallback(() => {
    setSelected((s) => {
      // If everything is currently selected, clear; otherwise select all.
      const everySelected = allIds.length > 0 && allIds.every((id) => s.has(id));
      return everySelected ? new Set() : new Set(allIds);
    });
  }, [allIds]);

  return {
    selected,
    isSelected,
    toggle,
    clear,
    set,
    allSelected,
    toggleAll,
    count: selected.size,
    ids: useMemo(() => Array.from(selected), [selected]),
  };
}
