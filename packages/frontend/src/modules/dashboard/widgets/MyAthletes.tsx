'use client';

/**
 * MyAthletes widget — parent dashboard.
 *
 * Shows every athlete in the parent's Family (kids + optionally their
 * own self-managed profile) and provides an inline "Add an athlete"
 * button that expands into a form. After a successful add, the list
 * refetches and a toast confirms. Parent can then pick a plan for the
 * new kid from the membership page.
 *
 * Data sources:
 *   GET  /api/account/athletes   — list family athletes
 *   POST /api/account/athletes   — create new athlete under family
 */

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import Link from '@/components/PageTransitionLink';
import { haptic } from '@/lib/haptic';
import type { WidgetProps } from '../types';

interface Athlete {
  id: string;
  firstName: string;
  lastName: string;
  ageGroup: string | null;
  dateOfBirth: string | null;
  relationToParent: string;
}

const LEVEL_LABELS: Record<string, string> = {
  youth: 'Youth',
  ms_hs: 'MS/HS',
  college: 'College',
  pro: 'Pro',
};

export function MyAthletesWidget(_props: WidgetProps) {
  const [athletes, setAthletes] = useState<Athlete[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    ageGroup: '',
  });

  async function load() {
    try {
      const res = await api.getMyAthletes();
      setAthletes(res.data ?? []);
    } catch {
      setAthletes([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast.error("Please enter the athlete's first and last name.");
      return;
    }
    if (!form.ageGroup) {
      toast.error('Please pick a playing level.');
      return;
    }
    setIsSaving(true);
    try {
      const res = await api.addAthlete({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        dateOfBirth: form.dateOfBirth || undefined,
        ageGroup: form.ageGroup,
      });
      haptic.success();
      toast.success(
        `${res.data?.firstName} added. Pick a plan for them from the membership page.`
      );
      setShowForm(false);
      setForm({ firstName: '', lastName: '', dateOfBirth: '', ageGroup: '' });
      await load();
    } catch (err) {
      haptic.error();
      toast.error(err instanceof Error ? err.message : 'Could not add athlete.');
    } finally {
      setIsSaving(false);
    }
  }

  if (athletes === null) {
    return (
      <div className="space-y-2">
        <div className="ppl-skeleton h-10" aria-hidden="true" />
        <div className="ppl-skeleton h-10" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-3">
      {athletes.length === 0 ? (
        <p className="text-sm text-muted leading-snug">
          No athletes on your account yet. Add your first one below.
        </p>
      ) : (
        <ul className="space-y-2">
          {athletes.map((a) => (
            <li
              key={a.id}
              className="rounded-lg border border-border bg-background/50 px-3 py-2 flex items-center justify-between gap-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">
                  {a.firstName} {a.lastName}
                </p>
                {a.ageGroup && (
                  <p className="text-[11px] text-muted mt-0.5">
                    {LEVEL_LABELS[a.ageGroup] ?? a.ageGroup}
                  </p>
                )}
              </div>
              <Link
                href={`/client/membership?athleteId=${a.id}`}
                className="text-[11px] font-medium text-accent-text hover:brightness-110 whitespace-nowrap"
              >
                Manage →
              </Link>
            </li>
          ))}
        </ul>
      )}

      {!showForm ? (
        <button
          type="button"
          onClick={() => {
            haptic.light();
            setShowForm(true);
          }}
          className="self-start text-xs font-medium text-accent-text hover:brightness-110"
        >
          + Add an athlete
        </button>
      ) : (
        <form
          onSubmit={submit}
          className="mt-2 space-y-2 rounded-lg border border-border/60 bg-surface/60 p-3"
        >
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              className="ppl-input text-sm"
              placeholder="First name"
              required
            />
            <input
              type="text"
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              className="ppl-input text-sm"
              placeholder="Last name"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              value={form.dateOfBirth}
              onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
              className="ppl-input text-sm"
            />
            <select
              value={form.ageGroup}
              onChange={(e) => setForm({ ...form, ageGroup: e.target.value })}
              className="ppl-input text-sm"
              required
            >
              <option value="">Playing level</option>
              <option value="youth">Youth (12 &amp; under)</option>
              <option value="ms_hs">Middle / High School</option>
              <option value="college">College</option>
              <option value="pro">Pro</option>
            </select>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={isSaving} className="ppl-btn ppl-btn-primary text-xs">
              {isSaving ? 'Adding…' : 'Add athlete'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setForm({ firstName: '', lastName: '', dateOfBirth: '', ageGroup: '' });
              }}
              className="text-xs text-muted hover:text-foreground px-2"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
