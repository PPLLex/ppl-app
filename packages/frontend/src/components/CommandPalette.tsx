'use client';

/**
 * Cmd-K Command Palette (#139).
 *
 * The single most premium-feeling power-user feature. Press ⌘K (or
 * Ctrl+K on Windows) anywhere in the app to open. Search across users,
 * leads, athletes, and upcoming sessions. Quick-action shortcuts pinned
 * at the top.
 *
 * UX details:
 *  - 200ms debounce on search-as-you-type
 *  - Up/Down arrows + Enter to navigate, Esc to dismiss
 *  - Fuzzy result groups by type with icon + sublabel
 *  - Recent searches persisted in localStorage
 *  - Auto-focused input + click-outside-to-close
 *
 * Mounted globally in the dashboard layout so it's available on every
 * authenticated page.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface SearchHit {
  id: string;
  type: 'user' | 'lead' | 'athlete' | 'session';
  label: string;
  sublabel?: string;
  href: string;
}

const TYPE_ICONS: Record<SearchHit['type'], string> = {
  user: '👤',
  lead: '🎯',
  athlete: '⚾',
  session: '📅',
};

const QUICK_ACTIONS: Array<{ label: string; sublabel: string; href: string; icon: string }> = [
  { label: 'Schedule', sublabel: 'Weekly schedule grid', href: '/admin/schedule', icon: '📆' },
  { label: 'CRM / Leads', sublabel: 'Sales pipeline', href: '/admin/crm', icon: '🎯' },
  { label: 'Members', sublabel: 'All active members', href: '/admin/members', icon: '🧑' },
  { label: 'Reports', sublabel: 'Revenue + conversion', href: '/admin/reports', icon: '📊' },
  { label: 'Workflows', sublabel: 'Automation builder', href: '/admin/workflows', icon: '⚙️' },
  { label: 'Forms', sublabel: 'Lead intake + surveys', href: '/admin/forms', icon: '📝' },
  { label: 'Integrations', sublabel: 'Health check', href: '/admin/integrations', icon: '🔌' },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Global keybinding: ⌘K / Ctrl+K toggles
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Auto-focus the input when opening
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
      setActiveIdx(0);
    } else {
      setQ('');
      setHits([]);
    }
  }, [open]);

  // Debounced search
  const runSearch = useCallback(async (term: string) => {
    if (term.length < 2) {
      setHits([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'https://app.pitchingperformancelab.com/api'}/search?q=${encodeURIComponent(term)}`,
        { headers: { Authorization: `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('ppl_token') ?? '' : ''}` } }
      );
      const json = await res.json();
      setHits(json?.data?.results ?? []);
    } catch {
      setHits([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(q), 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, runSearch]);

  // Quick actions are shown when the input is empty; results otherwise.
  const showingQuickActions = q.trim().length === 0;
  const items: Array<SearchHit | { id: string; type: 'action'; label: string; sublabel?: string; href: string }> =
    showingQuickActions
      ? QUICK_ACTIONS.map((a, i) => ({
          id: `qa-${i}`,
          type: 'action' as const,
          label: a.label,
          sublabel: a.sublabel,
          href: a.href,
        }))
      : hits;

  const navigateTo = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[activeIdx];
      if (item) navigateTo(item.href);
    }
  };

  // Reset cursor when the result set changes
  useEffect(() => {
    setActiveIdx(0);
  }, [hits.length, showingQuickActions]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4"
      onClick={() => setOpen(false)}
    >
      {/* Backdrop with subtle blur — premium glassmorphism */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-xl bg-[#141414] border border-[#2A2A2A] rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#2A2A2A]">
          <svg className="w-5 h-5 text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search members, leads, sessions…"
            className="flex-1 bg-transparent border-none outline-none text-foreground placeholder:text-muted text-base"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-bg-secondary border border-border text-muted font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto py-2">
          {loading && q.length >= 2 && (
            <p className="text-center text-xs text-muted py-6">Searching…</p>
          )}
          {!loading && q.length >= 2 && items.length === 0 && (
            <p className="text-center text-xs text-muted py-6">
              No matches for &ldquo;{q}&rdquo;
            </p>
          )}
          {showingQuickActions && (
            <p className="px-4 pt-1 pb-2 text-[10px] uppercase tracking-wider text-muted">
              Quick actions
            </p>
          )}
          {items.map((item, i) => {
            const isAction = item.type === 'action';
            const icon = isAction
              ? (QUICK_ACTIONS.find((q) => q.label === item.label)?.icon ?? '⚡')
              : TYPE_ICONS[item.type as SearchHit['type']];
            return (
              <button
                key={item.id}
                onClick={() => navigateTo(item.href)}
                onMouseEnter={() => setActiveIdx(i)}
                className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition ${
                  activeIdx === i ? 'bg-[#5E9E50]/15' : 'hover:bg-bg-secondary'
                }`}
              >
                <span className="text-lg flex-shrink-0">{icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground truncate">{item.label}</p>
                  {item.sublabel && (
                    <p className="text-xs text-muted truncate">{item.sublabel}</p>
                  )}
                </div>
                {activeIdx === i && (
                  <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-bg-secondary border border-border text-muted font-mono flex-shrink-0">
                    ↵
                  </kbd>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer hint bar */}
        <div className="border-t border-[#2A2A2A] px-4 py-2 flex items-center justify-between text-[10px] text-muted bg-bg-secondary/40">
          <span className="flex items-center gap-3">
            <span><kbd className="px-1 py-0.5 rounded bg-[#0A0A0A] border border-border font-mono">↑↓</kbd> navigate</span>
            <span><kbd className="px-1 py-0.5 rounded bg-[#0A0A0A] border border-border font-mono">↵</kbd> open</span>
          </span>
          <span><kbd className="px-1 py-0.5 rounded bg-[#0A0A0A] border border-border font-mono">⌘K</kbd> to toggle</span>
        </div>
      </div>
    </div>
  );
}
