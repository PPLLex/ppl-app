'use client';

/**
 * OrgContext — provides the current Organization to every frontend component.
 *
 * Resolution: first render reads window.location.hostname via lib/orgs.ts
 * and picks the matching OrgBrand (or falls back to PPL). This runs entirely
 * client-side so SSR and client render pick the same org without a flash.
 *
 * Consumers: `useOrg()` returns { current, switchTo }. `switchTo` is for
 * admin impersonation of other orgs (Phase 2); for typical clients the org
 * is determined by the domain and never changes at runtime.
 *
 * The api.ts fetch client reads the current org slug out of this context
 * (via a module-level ref updated on mount) and sends it as the
 * X-Organization header on every request so the backend's orgContext
 * middleware can double-check.
 *
 * See ARCHITECTURE.md for the full design.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { resolveOrgFromHost, type OrgBrand, DEFAULT_ORG_SLUG, getOrgBySlug } from '@/lib/orgs';

interface OrgContextValue {
  current: OrgBrand;
  /** For Phase 2+ admin impersonation. Has no effect for clients. */
  switchTo: (slug: string) => void;
}

const OrgContext = createContext<OrgContextValue | null>(null);

// A module-level ref so lib/api.ts can read the current slug without a React hook.
let currentSlugRef = DEFAULT_ORG_SLUG;

export function getCurrentOrgSlug(): string {
  return currentSlugRef;
}

export function OrgProvider({ children }: { children: ReactNode }) {
  // Read from window on mount; SSR always starts at default. No flash because
  // the actual DOM paint happens after the hydration step on the client.
  const [current, setCurrent] = useState<OrgBrand>(() => {
    if (typeof window === 'undefined') return resolveOrgFromHost(DEFAULT_ORG_SLUG);
    return resolveOrgFromHost(window.location.hostname);
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const resolved = resolveOrgFromHost(window.location.hostname);
      setCurrent(resolved);
    }
  }, []);

  useEffect(() => {
    currentSlugRef = current.slug;
  }, [current]);

  const value = useMemo<OrgContextValue>(() => ({
    current,
    switchTo: (slug: string) => {
      const match = getOrgBySlug(slug);
      if (match) setCurrent(match);
    },
  }), [current]);

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg(): OrgContextValue {
  const v = useContext(OrgContext);
  if (!v) {
    throw new Error('useOrg must be called inside an <OrgProvider>. Check root layout.');
  }
  return v;
}
