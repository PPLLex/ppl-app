'use client';

/**
 * useAutoSaveDraft — debounced localStorage round-trip for long forms
 * (#U7 / PREMIUM_AUDIT). Differs from usePersistedState in three ways:
 *
 *   1. Designed for FORM state (objects), not single values.
 *   2. Returns a saved-status indicator the UI can render: 'idle',
 *      'saving' (debounced timer running), or 'saved' (just persisted).
 *   3. Provides a discardDraft() to clear the persisted copy on submit
 *      success — so the form doesn't auto-restore yesterday's submitted
 *      draft.
 *
 * Storage key is namespaced — pass something like 'workflow-draft-new'
 * or 'lead-note-{leadId}' so different forms don't collide.
 *
 * Hydration is optional and explicit: call hydrateDraft() in your form's
 * useEffect to merge any saved draft into your component state. We don't
 * auto-mutate state because the hook can't safely guess whether the
 * caller's setter is `useState` or something more complex.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const DEBOUNCE_MS = 800;

export type AutoSaveStatus = 'idle' | 'saving' | 'saved';

export interface UseAutoSaveDraftReturn<T> {
  status: AutoSaveStatus;
  /**
   * Read whatever's currently in localStorage (or null if nothing).
   * Caller should hydrate component state with it on mount, e.g.:
   *   useEffect(() => { const d = hydrateDraft(); if (d) setState(d); }, []);
   */
  hydrateDraft: () => T | null;
  /**
   * Clear the persisted draft. Call this on successful submit so a
   * stale draft doesn't auto-restore on the next visit.
   */
  discardDraft: () => void;
  /**
   * Last time we persisted (ms epoch). Useful for "Last saved 12s ago"
   * footnotes. Null if nothing has been written yet.
   */
  savedAt: number | null;
}

export function useAutoSaveDraft<T>(
  key: string,
  value: T,
  // Optional gate — return false to suspend persistence (e.g. when a
  // form is mid-submit). Defaults to always-on.
  enabled: boolean = true
): UseAutoSaveDraftReturn<T> {
  const [status, setStatus] = useState<AutoSaveStatus>('idle');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const timerRef = useRef<number | null>(null);
  // Skip the very first persist on mount — we don't want to flash 'Saved'
  // before the user has typed anything.
  const firstWriteRef = useRef(true);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;

    if (firstWriteRef.current) {
      firstWriteRef.current = false;
      return;
    }

    setStatus('saving');
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          key,
          JSON.stringify({ v: value, at: Date.now() })
        );
        setSavedAt(Date.now());
        setStatus('saved');
      } catch {
        // Quota exceeded / private mode / etc. — silently degrade.
        setStatus('idle');
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    // We only want to react to value changes; key is assumed stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, enabled]);

  const hydrateDraft = useCallback((): T | null => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { v: T; at?: number };
      if (parsed.at) setSavedAt(parsed.at);
      return parsed.v;
    } catch {
      return null;
    }
  }, [key]);

  const discardDraft = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
    setSavedAt(null);
    setStatus('idle');
    firstWriteRef.current = true;
  }, [key]);

  return { status, hydrateDraft, discardDraft, savedAt };
}

// AutoSaveIndicator now lives in its own .tsx file because hooks files
// shouldn't ship JSX. Re-exporting here keeps existing imports working.
export { AutoSaveIndicator } from '@/components/AutoSaveIndicator';
