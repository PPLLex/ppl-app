'use client';

/**
 * usePersistedState — drop-in `useState` replacement that persists to
 * localStorage under a given key. Used for filter state on long-lived
 * admin pages (CRM, members, history) so navigating away + back keeps
 * the filters the user just set.
 *
 *   const [search, setSearch] = usePersistedState('crm-search', '');
 *
 * SSR-safe: reads localStorage only after mount.
 * Versioned: pass `version` in the key when the shape changes to bust
 * stale persisted state.
 */

import { useEffect, useState } from 'react';

export function usePersistedState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);

  // Hydrate from localStorage after mount (avoids SSR mismatch)
  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
      if (raw !== null) {
        setValue(JSON.parse(raw) as T);
      }
    } catch {
      // localStorage unavailable or stale shape — ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist on change
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, JSON.stringify(value));
      }
    } catch {
      // quota exceeded or unavailable — silently noop
    }
  }, [key, value]);

  return [value, setValue];
}
