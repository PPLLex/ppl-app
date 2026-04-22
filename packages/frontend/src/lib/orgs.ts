/**
 * Org branding + domain mapping — frontend source of truth for the small
 * amount of org metadata the client needs before it can talk to the API.
 *
 * We hardcode the 4 orgs here for Phase 1 so nothing on first paint depends
 * on a backend round-trip. In a later phase we'll fetch the full org record
 * via /api/organizations/current and merge, but keeping this static avoids a
 * cold-start flash of the wrong brand.
 *
 * See ARCHITECTURE.md at the repo root for the org model.
 */

export interface OrgBrand {
  slug: string; // 'ppl', 'hpl', 'hpl-youth', 'renewed-performance'
  name: string; // 'Pitching Performance Lab'
  shortName: string; // 'PPL'
  primaryColor: string;
  accentColor: string;
  /**
   * Domains this org owns. The first one in the list is the canonical one.
   * Used to resolve the current org from window.location.hostname.
   */
  domains: string[];
}

const ORGS: OrgBrand[] = [
  {
    slug: 'ppl',
    name: 'Pitching Performance Lab',
    shortName: 'PPL',
    primaryColor: '#5E9E50',
    accentColor: '#95C83C',
    domains: [
      'app.pitchingperformancelab.com',
      'ppl-app-xsg5.vercel.app',
      'ppl-app-taupe.vercel.app',
    ],
  },
  {
    slug: 'hpl',
    name: 'Hitting Performance Lab',
    shortName: 'HPL',
    primaryColor: '#1E40AF',
    accentColor: '#3B82F6',
    domains: ['app.hittingperformancelab.com'],
  },
  {
    slug: 'hpl-youth',
    name: 'HPL Youth',
    shortName: 'HPL Youth',
    primaryColor: '#1E40AF',
    accentColor: '#60A5FA',
    domains: [],
  },
  {
    slug: 'renewed-performance',
    name: 'Renewed Performance',
    shortName: 'Renewed Performance',
    primaryColor: '#374151',
    accentColor: '#9CA3AF',
    domains: [],
  },
];

/** The org we fall back to when no domain matches (local dev, localhost, etc). */
export const DEFAULT_ORG_SLUG = 'ppl';

/**
 * Resolve the active org from the current window.location.hostname. Returns
 * the PPL record if nothing matches (e.g., localhost during development).
 *
 * Case-insensitive and strips port. Subdomain-exact match only — we don't do
 * wildcard DNS matching since each org's own branded domain is explicit.
 */
export function resolveOrgFromHost(hostname: string): OrgBrand {
  const lower = (hostname || '').toLowerCase().split(':')[0];
  for (const org of ORGS) {
    if (org.domains.some((d) => d.toLowerCase() === lower)) return org;
  }
  return ORGS.find((o) => o.slug === DEFAULT_ORG_SLUG)!;
}

export function getOrgBySlug(slug: string): OrgBrand | undefined {
  return ORGS.find((o) => o.slug === slug);
}

export function allOrgs(): OrgBrand[] {
  return ORGS;
}
