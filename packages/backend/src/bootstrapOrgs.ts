/**
 * Startup-time organization bootstrapping.
 *
 * Runs once at server boot BEFORE `app.listen()` in server.ts. Idempotent so
 * it can run every deploy without side effects. Lives in `src/` (not
 * `scripts/`) so the TypeScript build compiles it into `dist/` and ships
 * with the production container — no tsx, no loose .ts files to copy in
 * Docker.
 *
 * Previously this was a standalone `scripts/bootstrap-organizations.ts`
 * invoked via `npx tsx` from start.sh. That broke on Railway because the
 * production container didn't ship `scripts/` or `tsx` (both dev-only),
 * which caused healthcheck failures and silent deploy rollbacks. See
 * ARCHITECTURE.md for the org design.
 */

import { prisma } from './utils/prisma';

interface OrgSeed {
  id: string;
  name: string;
  shortName: string;
  tagline: string;
  primaryColor: string;
  accentColor: string;
  primaryDomain: string | null;
  additionalDomains: string[];
}

const ORGS: OrgSeed[] = [
  {
    id: 'ppl',
    name: 'Pitching Performance Lab',
    shortName: 'PPL',
    tagline: 'Train like a pro.',
    primaryColor: '#5E9E50',
    accentColor: '#95C83C',
    primaryDomain: 'app.pitchingperformancelab.com',
    additionalDomains: ['ppl-app-xsg5.vercel.app', 'ppl-app-taupe.vercel.app'],
  },
  {
    id: 'hpl',
    name: 'Hitting Performance Lab',
    shortName: 'HPL',
    tagline: 'Hit like a pro.',
    primaryColor: '#1E40AF',
    accentColor: '#3B82F6',
    primaryDomain: 'app.hittingperformancelab.com',
    additionalDomains: [],
  },
  {
    id: 'hpl-youth',
    name: 'HPL Youth',
    shortName: 'HPL Youth',
    tagline: 'Hitting for the next generation.',
    primaryColor: '#1E40AF',
    accentColor: '#60A5FA',
    primaryDomain: null,
    additionalDomains: [],
  },
  {
    id: 'renewed-performance',
    name: 'Renewed Performance',
    shortName: 'Renewed Performance',
    tagline: 'Physical therapy, screenings, and movement assessments.',
    primaryColor: '#374151',
    accentColor: '#9CA3AF',
    primaryDomain: null,
    additionalDomains: [],
  },
];

export async function bootstrapOrganizations(): Promise<void> {
  console.log('[bootstrap-orgs] Ensuring 4 core organizations exist…');
  // Cast to `any` so this file compiles before `prisma generate` has run in
  // sandbox environments. Railway regenerates cleanly at build so runtime
  // has full types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p: any = prisma;
  for (const org of ORGS) {
    const { id, ...rest } = org;
    try {
      await p.organization.upsert({
        where: { id },
        create: { id, ...rest },
        // Don't overwrite admin edits — only fill on create.
        update: {},
      });
      console.log(`  ✓ ${id}`);
    } catch (err) {
      console.error(`  ✗ ${id} — ${err instanceof Error ? err.message : err}`);
      // Don't throw — a bootstrap failure should never block server startup.
      // The org lookup service falls back to 'ppl' so the app still boots.
    }
  }
  console.log('[bootstrap-orgs] Done.');
}
