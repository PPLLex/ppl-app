/**
 * Bootstrap the 4 Organization rows the app depends on.
 *
 * Runs on every deploy (called from start.sh after `prisma db push` has
 * created the organizations table). Idempotent — uses upsert so existing
 * rows aren't overwritten. This is separate from `prisma/seed.ts` because
 * seed.ts is manual (`npm run db:seed`) while this needs to run
 * automatically on Railway startup to guarantee the "ppl" org exists
 * before any org-tagged data references it.
 *
 * See ARCHITECTURE.md at the repo root for the full org design.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ORGS = [
  {
    id: 'ppl',
    name: 'Pitching Performance Lab',
    shortName: 'PPL',
    tagline: 'Train like a pro.',
    primaryColor: '#5E9E50',
    accentColor: '#95C83C',
    primaryDomain: 'app.pitchingperformancelab.com',
    additionalDomains: [
      'ppl-app-xsg5.vercel.app',
      'ppl-app-taupe.vercel.app',
    ],
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
] as const;

async function main() {
  console.log('[bootstrap-orgs] Ensuring 4 core organizations exist…');
  for (const org of ORGS) {
    const { id, primaryDomain, additionalDomains, ...rest } = org;
    await prisma.organization.upsert({
      where: { id },
      create: {
        id,
        primaryDomain: primaryDomain ?? null,
        additionalDomains: [...additionalDomains],
        ...rest,
      },
      // Only fill in fields that were NULL; don't overwrite admin edits
      update: {},
    });
    console.log(`  ✓ ${id}`);
  }
  console.log('[bootstrap-orgs] Done.');
}

main()
  .catch((err) => {
    console.error('[bootstrap-orgs] Failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
