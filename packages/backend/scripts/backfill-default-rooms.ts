/**
 * Backfill default rooms for every Location.
 *
 * Why: the POST /api/locations endpoint auto-creates a 13+ calendar and a Youth
 * calendar for every new location. Locations that predate that logic
 * (e.g. Lexington, Louisville) never got those rooms. This script walks every
 * location, checks whether each default room exists, and inserts any that are
 * missing. It's safe to re-run — existing rooms are detected by name pattern
 * rather than exact string, so old short names ("13+", "Youth") and the new
 * long name ("13+ (Middle School, High School, College, and Pro)") both count.
 *
 * Usage:
 *   pnpm --filter @ppl/backend exec tsx scripts/backfill-default-rooms.ts           # writes
 *   pnpm --filter @ppl/backend exec tsx scripts/backfill-default-rooms.ts --dry-run # reports only
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_TEEN_ROOM_NAME = '13+ (Middle School, High School, College, and Pro)';
const DEFAULT_YOUTH_ROOM_NAME = 'Youth';

// Pattern matchers so we don't double-create rooms that already exist under
// an older short name (e.g. "13+" or "Teen" or "Youth").
function isTeenRoom(name: string): boolean {
  return /^\s*13\s*\+/i.test(name.trim());
}

function isYouthRoom(name: string): boolean {
  return /^\s*youth\b/i.test(name.trim());
}

type Summary = {
  locationId: string;
  locationName: string;
  hadTeen: boolean;
  hadYouth: boolean;
  created: string[];
};

async function main() {
  const isDryRun = process.argv.includes('--dry-run');

  const locations = await prisma.location.findMany({
    include: {
      rooms: { select: { id: true, name: true, isActive: true } },
    },
    orderBy: { name: 'asc' },
  });

  if (locations.length === 0) {
    console.log('No locations found. Nothing to do.');
    return;
  }

  console.log(
    `\n${isDryRun ? '[DRY RUN] ' : ''}Checking ${locations.length} location${
      locations.length === 1 ? '' : 's'
    } for default rooms…\n`
  );

  const summaries: Summary[] = [];

  for (const loc of locations) {
    const hadTeen = loc.rooms.some((r) => isTeenRoom(r.name));
    const hadYouth = loc.rooms.some((r) => isYouthRoom(r.name));

    const toCreate: { name: string; sortOrder: number }[] = [];
    if (!hadTeen) toCreate.push({ name: DEFAULT_TEEN_ROOM_NAME, sortOrder: 0 });
    if (!hadYouth) toCreate.push({ name: DEFAULT_YOUTH_ROOM_NAME, sortOrder: 1 });

    const summary: Summary = {
      locationId: loc.id,
      locationName: loc.name,
      hadTeen,
      hadYouth,
      created: [],
    };

    if (toCreate.length === 0) {
      summaries.push(summary);
      continue;
    }

    if (!isDryRun) {
      await prisma.room.createMany({
        data: toCreate.map((r) => ({
          locationId: loc.id,
          name: r.name,
          sortOrder: r.sortOrder,
        })),
      });
    }

    summary.created = toCreate.map((r) => r.name);
    summaries.push(summary);
  }

  // Report
  const padName = Math.max(...summaries.map((s) => s.locationName.length), 8);

  console.log(
    `${'Location'.padEnd(padName)}  ${'13+'.padEnd(5)}  ${'Youth'.padEnd(5)}  Action`
  );
  console.log('-'.repeat(padName + 30));

  let totalCreated = 0;
  for (const s of summaries) {
    const teen = s.hadTeen ? 'ok' : s.created.some(isTeenRoom) ? 'new' : '—';
    const youth = s.hadYouth ? 'ok' : s.created.some(isYouthRoom) ? 'new' : '—';
    const action =
      s.created.length === 0
        ? 'nothing to do'
        : `created ${s.created.length} room${s.created.length === 1 ? '' : 's'}`;
    console.log(
      `${s.locationName.padEnd(padName)}  ${teen.padEnd(5)}  ${youth.padEnd(5)}  ${action}`
    );
    totalCreated += s.created.length;
  }

  console.log('');
  console.log(
    isDryRun
      ? `[DRY RUN] Would create ${totalCreated} room${totalCreated === 1 ? '' : 's'}. No changes written.`
      : `Done. Created ${totalCreated} room${totalCreated === 1 ? '' : 's'}.`
  );
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
