/**
 * One-shot data migration: backfill UserRole rows from the legacy User.role
 * column (ADMIN / STAFF / CLIENT) + StaffLocation assignments.
 *
 * Safe to re-run — every insert uses the UNIQUE constraint on
 * (userId, role, locationId, schoolTeamId) with skipDuplicates. Rows already
 * migrated will be left alone.
 *
 * Mapping:
 *   User.role = ADMIN   → UserRole(ADMIN, global)
 *   User.role = STAFF   → for each StaffLocation row, UserRole(PERFORMANCE_COACH, locationId)
 *                          (Chad can manually promote some to COORDINATOR/MEDICAL later
 *                          via the staff admin UI that ships in commit 3)
 *   User.role = CLIENT  → if the user is the parentUserId of a Family → UserRole(PARENT)
 *                          if the user has their OWN AthleteProfile (userId=them) AND
 *                          is NOT a parent → UserRole(ATHLETE)
 *                          (both → both rows, i.e. a parent who also self-trains)
 *
 * Run with:
 *   npx tsx scripts/migrate-user-roles.ts
 * Or on Railway (safe, idempotent):
 *   railway run -- npx tsx scripts/migrate-user-roles.ts
 */

import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();

type Counts = {
  adminRowsCreated: number;
  performanceCoachRowsCreated: number;
  parentRowsCreated: number;
  athleteRowsCreated: number;
  skippedExisting: number;
  errors: Array<{ userId: string; reason: string }>;
};

async function main(): Promise<Counts> {
  const counts: Counts = {
    adminRowsCreated: 0,
    performanceCoachRowsCreated: 0,
    parentRowsCreated: 0,
    athleteRowsCreated: 0,
    skippedExisting: 0,
    errors: [],
  };

  // ========================================================================
  // Step 1 — ADMIN users
  // ========================================================================
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN' as Role },
    select: { id: true, email: true },
  });
  console.log(`Found ${admins.length} ADMIN user(s).`);

  for (const admin of admins) {
    try {
      const result = await prisma.userRole.createMany({
        data: [{ userId: admin.id, role: 'ADMIN' as Role }],
        skipDuplicates: true,
      });
      if (result.count > 0) {
        counts.adminRowsCreated += result.count;
        console.log(`  + ADMIN  ${admin.email}`);
      } else {
        counts.skippedExisting += 1;
      }
    } catch (e) {
      counts.errors.push({ userId: admin.id, reason: String(e) });
    }
  }

  // ========================================================================
  // Step 2 — STAFF users → PERFORMANCE_COACH for each of their StaffLocations
  // ========================================================================
  const staff = await prisma.user.findMany({
    where: { role: 'STAFF' as Role },
    select: {
      id: true,
      email: true,
      staffLocations: { select: { locationId: true, isActive: true } },
    },
  });
  console.log(`Found ${staff.length} STAFF user(s).`);

  for (const s of staff) {
    try {
      const activeLocationIds = s.staffLocations
        .filter((sl) => sl.isActive)
        .map((sl) => sl.locationId);

      if (activeLocationIds.length === 0) {
        // STAFF user with no active StaffLocations — skip (likely deactivated,
        // or org layer assigns them differently). Chad can repair manually.
        console.log(`  ~ STAFF  ${s.email} has no active locations; skipping`);
        continue;
      }

      const rows = activeLocationIds.map((locationId) => ({
        userId: s.id,
        role: 'PERFORMANCE_COACH' as Role,
        locationId,
      }));

      const result = await prisma.userRole.createMany({
        data: rows,
        skipDuplicates: true,
      });

      counts.performanceCoachRowsCreated += result.count;
      counts.skippedExisting += rows.length - result.count;
      if (result.count > 0) {
        console.log(
          `  + STAFF  ${s.email} → PERFORMANCE_COACH × ${result.count} location(s)`
        );
      }
    } catch (e) {
      counts.errors.push({ userId: s.id, reason: String(e) });
    }
  }

  // ========================================================================
  // Step 3 — CLIENT users → PARENT and/or ATHLETE
  // ========================================================================
  const clients = await prisma.user.findMany({
    where: { role: 'CLIENT' as Role },
    select: {
      id: true,
      email: true,
      // Is this user the parent of a Family? (User→Family is 1:1 via parentUserId)
      family: { select: { id: true } },
      // Does this user have their own AthleteProfile?
      athleteProfile: { select: { id: true, familyId: true } },
    },
  });
  console.log(`Found ${clients.length} CLIENT user(s).`);

  for (const c of clients) {
    const isParent = !!c.family;
    const isSelfAthlete = !!c.athleteProfile;

    const rows: Array<{ userId: string; role: Role }> = [];
    if (isParent) rows.push({ userId: c.id, role: 'PARENT' as Role });
    // A parent who also trains themselves gets BOTH roles. A client who only
    // has an AthleteProfile (and isn't a parent) becomes ATHLETE.
    if (isSelfAthlete) rows.push({ userId: c.id, role: 'ATHLETE' as Role });

    if (rows.length === 0) {
      // CLIENT with neither a child nor an AthleteProfile — orphan record.
      // Default them to ATHLETE so they can still log in; Chad can repair.
      rows.push({ userId: c.id, role: 'ATHLETE' as Role });
      console.log(`  ! CLIENT ${c.email} has no family/athlete link; defaulting to ATHLETE`);
    }

    try {
      const result = await prisma.userRole.createMany({
        data: rows,
        skipDuplicates: true,
      });
      for (const r of rows) {
        if (r.role === 'PARENT') counts.parentRowsCreated += 1;
        if (r.role === 'ATHLETE') counts.athleteRowsCreated += 1;
      }
      counts.skippedExisting += rows.length - result.count;
      if (result.count > 0) {
        console.log(
          `  + CLIENT ${c.email} → ${rows.map((r) => r.role).join(' + ')}`
        );
      }
    } catch (e) {
      counts.errors.push({ userId: c.id, reason: String(e) });
    }
  }

  return counts;
}

main()
  .then((counts) => {
    console.log('\n======================================');
    console.log('UserRole backfill complete.');
    console.log(`  ADMIN rows created:              ${counts.adminRowsCreated}`);
    console.log(`  PERFORMANCE_COACH rows created:  ${counts.performanceCoachRowsCreated}`);
    console.log(`  PARENT rows created:             ${counts.parentRowsCreated}`);
    console.log(`  ATHLETE rows created:            ${counts.athleteRowsCreated}`);
    console.log(`  Skipped (already existed):       ${counts.skippedExisting}`);
    if (counts.errors.length > 0) {
      console.log(`  Errors (${counts.errors.length}):`);
      for (const err of counts.errors) {
        console.log(`    userId=${err.userId} reason=${err.reason}`);
      }
    }
    console.log('======================================');
    return prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('Migration failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
