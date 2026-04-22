/**
 * Organization lookup helpers. Used by orgContext middleware and any route
 * that needs to resolve an org from a slug, domain, or user.
 *
 * See ARCHITECTURE.md for the org model + rules.
 */

import { prisma } from '../utils/prisma';

// Cast to `any` so this file typechecks before `prisma generate` has run
// (e.g., in local sandboxes where node_modules can't be refreshed). Railway's
// deploy regenerates the Prisma client cleanly, so production has full types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p: any = prisma;

export interface ActiveOrg {
  id: string;           // slug, e.g., "ppl"
  name: string;
  shortName: string;
  primaryColor: string;
  accentColor: string;
  stripeAccountId: string | null;
}

const CACHE_TTL_MS = 60_000;
let cache: { at: number; orgs: ActiveOrg[] } | null = null;

async function allOrgs(): Promise<ActiveOrg[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.orgs;
  const rows = await p.organization.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      shortName: true,
      primaryColor: true,
      accentColor: true,
      stripeAccountId: true,
      primaryDomain: true,
      additionalDomains: true,
    },
  });
  cache = {
    at: Date.now(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    orgs: rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      shortName: r.shortName,
      primaryColor: r.primaryColor,
      accentColor: r.accentColor,
      stripeAccountId: r.stripeAccountId,
    })),
  };
  return cache.orgs;
}

export async function getOrgBySlug(slug: string): Promise<ActiveOrg | null> {
  const orgs = await allOrgs();
  return orgs.find((o) => o.id === slug) ?? null;
}

/**
 * Resolve the org that owns a given hostname. Used by the middleware when
 * the request comes in from one of our branded frontends
 * (app.pitchingperformancelab.com, app.hittingperformancelab.com, etc.).
 *
 * Matches against primaryDomain first, then additionalDomains, case-
 * insensitive. Returns null if no org claims this hostname — caller decides
 * the fallback (we default to 'ppl' during rollout).
 */
export async function getOrgByDomain(host: string): Promise<ActiveOrg | null> {
  if (!host) return null;
  const lower = host.toLowerCase();
  // We need the domain fields, which the cached list doesn't include; refetch.
  const rows = await p.organization.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      shortName: true,
      primaryColor: true,
      accentColor: true,
      stripeAccountId: true,
      primaryDomain: true,
      additionalDomains: true,
    },
  });
  for (const r of rows) {
    if (r.primaryDomain?.toLowerCase() === lower) return mapToActiveOrg(r);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (r.additionalDomains.some((d: any) => d.toLowerCase() === lower)) {
      return mapToActiveOrg(r);
    }
  }
  return null;
}

/**
 * Invalidate the in-memory cache. Call this after an admin edits an Org row.
 */
export function invalidateOrgCache(): void {
  cache = null;
}

function mapToActiveOrg(r: {
  id: string;
  name: string;
  shortName: string;
  primaryColor: string;
  accentColor: string;
  stripeAccountId: string | null;
}): ActiveOrg {
  return {
    id: r.id,
    name: r.name,
    shortName: r.shortName,
    primaryColor: r.primaryColor,
    accentColor: r.accentColor,
    stripeAccountId: r.stripeAccountId,
  };
}
