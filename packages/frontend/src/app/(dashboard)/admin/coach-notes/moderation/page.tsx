'use client';

/**
 * Admin — Coach Notes Moderation.
 *
 * Lets Chad (or any admin) review every coach note in one place,
 * filter by visibility, and toggle `isVisible` on anything that looks
 * inappropriate before it reaches parents. Parents only ever see
 * `isVisible: true` notes (enforced server-side).
 *
 * This is a simple list view — not a full editor. Use the existing
 * /admin/notes or staff notes page for drafting; this page is the
 * safety net that sits between coach submissions and parent emails.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from '@/components/PageTransitionLink';
import { api } from '@/lib/api';
import { toast } from 'sonner';

interface ModerationNote {
  id: string;
  rawContent: string;
  cleanedContent: string | null;
  displayContent: string;
  trainingCategory: string | null;
  sessionDate: string;
  isVisible: boolean;
  coach: { id: string; fullName: string };
  athlete: { id: string; fullName: string; email: string };
}

type Visibility = 'all' | 'visible' | 'hidden';

export default function ModerationPage() {
  const [notes, setNotes] = useState<ModerationNote[] | null>(null);
  const [visibility, setVisibility] = useState<Visibility>('all');
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setNotes(null);
    try {
      const res = await api.listModerationNotes({ visibility, limit: 200 });
      setNotes(res.data || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load');
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibility]);

  const filtered = useMemo(() => {
    if (!notes) return null;
    const needle = q.trim().toLowerCase();
    if (!needle) return notes;
    return notes.filter(
      (n) =>
        n.athlete.fullName.toLowerCase().includes(needle) ||
        n.coach.fullName.toLowerCase().includes(needle) ||
        n.displayContent.toLowerCase().includes(needle)
    );
  }, [notes, q]);

  const toggle = async (note: ModerationNote) => {
    setBusyId(note.id);
    try {
      await api.setNoteVisibility(note.id, !note.isVisible);
      toast.success(note.isVisible ? 'Hidden from parents' : 'Restored — parents will see it');
      setNotes((prev) =>
        prev?.map((n) => (n.id === note.id ? { ...n, isVisible: !note.isVisible } : n)) ?? null
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update visibility');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className="ppl-page-root">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <Link href="/admin" className="text-sm text-muted hover:text-foreground">
          ← Admin
        </Link>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl uppercase tracking-[0.04em] text-foreground">
              Coach Notes Moderation
            </h1>
            <p className="text-sm text-muted mt-1">
              Review notes before parents see them. Hidden notes are invisible to clients and
              excluded from weekly parent emails.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as Visibility)}
              className="ppl-input text-sm"
            >
              <option value="all">All notes</option>
              <option value="visible">Visible only</option>
              <option value="hidden">Hidden only</option>
            </select>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search athlete, coach, or text…"
              className="ppl-input text-sm w-60"
            />
          </div>
        </div>

        {err && (
          <div className="mt-6 p-4 border border-destructive/40 rounded-lg text-sm text-destructive bg-destructive/10">
            {err}
          </div>
        )}

        <section className="mt-6 space-y-3">
          {filtered === null && <p className="text-sm text-muted">Loading…</p>}
          {filtered !== null && filtered.length === 0 && (
            <p className="text-sm text-muted">No notes match this filter.</p>
          )}
          {filtered?.map((n) => (
            <article
              key={n.id}
              className={`border rounded-lg p-4 ${
                n.isVisible
                  ? 'border-border bg-card'
                  : 'border-amber-500/40 bg-amber-500/5'
              }`}
            >
              <header className="flex items-baseline justify-between gap-3">
                <div>
                  <h3 className="font-display text-base text-foreground">{n.athlete.fullName}</h3>
                  <p className="text-xs text-muted mt-0.5">
                    By {n.coach.fullName} ·{' '}
                    {new Date(n.sessionDate).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                    {n.trainingCategory && ` · ${n.trainingCategory}`}
                  </p>
                </div>
                <span
                  className={`text-[10px] uppercase tracking-[0.16em] ${
                    n.isVisible ? 'text-accent-text' : 'text-amber-400'
                  }`}
                >
                  {n.isVisible ? 'Visible' : 'Hidden'}
                </span>
              </header>
              <p className="text-sm text-foreground/90 mt-3 leading-relaxed whitespace-pre-wrap">
                {n.displayContent}
              </p>
              {n.cleanedContent && n.rawContent !== n.cleanedContent && (
                <details className="mt-3">
                  <summary className="text-[11px] text-muted cursor-pointer hover:text-foreground">
                    View original (pre-AI cleanup)
                  </summary>
                  <p className="text-xs text-muted mt-2 leading-relaxed whitespace-pre-wrap">
                    {n.rawContent}
                  </p>
                </details>
              )}
              <footer className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => toggle(n)}
                  disabled={busyId === n.id}
                  className={`ppl-btn text-xs ${
                    n.isVisible ? 'ppl-btn-secondary' : 'ppl-btn-primary'
                  } disabled:opacity-60`}
                >
                  {busyId === n.id ? 'Saving…' : n.isVisible ? 'Hide from parents' : 'Restore'}
                </button>
              </footer>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
