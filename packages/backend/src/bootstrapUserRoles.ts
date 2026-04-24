/**
 * Idempotent backfill of UserRole rows from legacy User.role + StaffLocation.
 *
 * Runs once at server boot BEFORE `app.listen()`. On fresh deploys after the
 * April 2026 Role-expansion migration, this gives every existing user the
 * UserRole rows they need for the new permission model — without anyone
 * having to manually run `railway run -- npx tsx scripts/migrate-user-roles.ts`.
 *
 * Mapping (mirrors scripts/migrate-user-roles.ts, which remains for manual use):
 *   User.role = ADMIN   → UserRole(ADMIN, global)
 *   User.role = STAFF   → UserRole(PERFORMANCE_COACH, locationId) per StaffLocation
 *                          Chad can manually promote to COORDINATOR / MEDICAL later
 *                          via the staff admin UI.
 *   User.role = CLIENT  → UserRole(PARENT) if the user parents a Family
 *                          UserRole(ATHLETE) if the user has their own AthleteProfile
 *                          (both if both; orphaned CLIENT users default to ATHLETE)
 *
 * Performance: skips the backfill entirely if the UserRole table already has
 * rows for every legacy user — i.e. after the first successful run, this
 * function is essentially free on every subsequent boot.
 *
 * Swallows errors so a hiccup here can never block server startup. If the
 * backfill fails, we log and move on; the /api/roles/me endpoint gracefully
 * falls back to legacy User.role until we retry.
 */

import { PrismaClient, Role } from '@prisma/client';

export async function bootstrapUserRoles(prisma: PrismaClient): Promise<void> {
  try {
    // Quick short-circuit — if every legacy user already has at least one
    // UserRole row, we have nothing to do.
    const legacyUserCount = await prisma.user.count({
      where: { role: { in: [Role.ADMIN, Role.STAFF, Role.CLIENT] } },
    });
    if (legacyUserCount === 0) {
      console.log('[bootstrapUserRoles] No legacy users — nothing to backfill.');
      return;
    }

    const usersWithRoles = await prisma.user.findMany({
      where: {
        role: { in: [Role.ADMIN, Role.STAFF, Role.CLIENT] },
        userRoles: { some: {} },
      },
      select: { id: true },
    });
    if (usersWithRoles.length >= legacyUserCount) {
      console.log(
        `[bootstrapUserRoles] All ${legacyUserCount} legacy users already have UserRole rows. Skipping.`
      );
      return;
    }

    console.log(
      `[bootstrapUserRoles] Backfilling UserRole rows for ${
        legacyUserCount - usersWithRoles.length
      } users with no role assignments yet…`
    );

    let created = 0;

    // ========================================================================
    // ADMIN users
    // ========================================================================
    const admins = await prisma.user.findMany({
      where: {
        role: Role.ADMIN,
        userRoles: { none: { role: Role.ADMIN } },
      },
      select: { id: true },
    });
    if (admins.length > 0) {
      const res = await prisma.userRole.createMany({
        data: admins.map((u) => ({ userId: u.id, role: Role.ADMIN })),
        skipDuplicates: true,
      });
      created += res.count;
    }

    // ========================================================================
    // STAFF users — one UserRole per StaffLocation (there's no isActive flag
    // on StaffLocation; deactivated staff have their rows deleted on removal).
    // ========================================================================
    const staff = await prisma.user.findMany({
      where: { role: Role.STAFF },
      select: {
        id: true,
        staffLocations: { select: { locationId: true } },
        userRoles: {
          where: { role: Role.PERFORMANCE_COACH },
          select: { locationId: true },
        },
      },
    });
    for (const s of staff) {
      const existingLocIds = new Set<string>(
        s.userRoles
          .map((ur: { locationId: string | null }) => ur.locationId)
          .filter((x): x is string => !!x)
      );
      const rows = s.staffLocations
        .filter((sl: { locationId: string }) => !existingLocIds.has(sl.locationId))
        .map((sl: { locationId: string }) => ({
          userId: s.id,
          role: Role.PERFORMANCE_COACH,
          locationId: sl.locationId,
        }));
      if (rows.length > 0) {
        const res = await prisma.userRole.createMany({ data: rows, skipDuplicates: true });
        created += res.count;
      }
    }

    // ========================================================================
    // CLIENT users — PARENT if they parent a Family, ATHLETE if self-athlete
    // ========================================================================
    const clients = await prisma.user.findMany({
      where: { role: Role.CLIENT },
      select: {
        id: true,
        family: { select: { id: true } },
        athleteProfile: { select: { id: true } },
        userRoles: {
          where: { role: { in: [Role.PARENT, Role.ATHLETE] } },
          select: { role: true },
        },
      },
    });

    for (const c of clients) {
      const hasParent = c.userRoles.some((ur) => ur.role === Role.PARENT);
      const hasAthlete = c.userRoles.some((ur) => ur.role === Role.ATHLETE);
      const rows: Array<{ userId: string; role: Role }> = [];

      if (c.family && !hasParent) {
        rows.push({ userId: c.id, role: Role.PARENT });
      }
      if (c.athleteProfile && !hasAthlete) {
        rows.push({ userId: c.id, role: Role.ATHLETE });
      }
      // Orphan CLIENT with neither family nor athlete → default to ATHLETE
      // so the user can at least log in and see their dashboard. Chad can
      // repair these manually later.
      if (rows.length === 0 && !hasParent && !hasAthlete) {
        rows.push({ userId: c.id, role: Role.ATHLETE });
      }

      if (rows.length > 0) {
        const res = await prisma.userRole.createMany({ data: rows, skipDuplicates: true });
        created += res.count;
      }
    }

    console.log(`[bootstrapUserRoles] Done. Created ${created} UserRole row(s).`);
  } catch (err) {
    // Never block startup on backfill errors.
    console.error('[bootstrapUserRoles] Backfill failed (non-fatal):', err);
  }
}
