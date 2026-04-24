/**
 * Role & permissions service — source of truth for who can do what.
 *
 * Reads from the UserRole junction table (added in the Apr 2026 role-expansion
 * migration). The legacy User.role column is NOT consulted here — call sites
 * that still rely on it use middleware/auth.ts's `requireRole` helpers, which
 * remain in place for backward compat. New feature code should use the
 * helpers in this file.
 *
 * Key concepts:
 *   - A user can hold MULTIPLE roles (e.g. Performance Coach who also does
 *     Content & Marketing). Every role lives in its own UserRole row.
 *   - Global roles (ADMIN, CONTENT_MARKETING_ADMIN, MEDICAL_ADMIN, PARENT,
 *     ATHLETE) have locationId=null and schoolTeamId=null.
 *   - Location-scoped roles have locationId set.
 *   - Partnership Coach has schoolTeamId set (locationId=null).
 *
 * The invite matrix (`canInvite`) encodes Chad's rules verbatim:
 *   - ADMIN → everyone
 *   - COORDINATOR → everyone at their location
 *   - PERFORMANCE_COACH → Performance Coach, Content & Marketing, Outside
 *     Coach, Parent, Athlete (at their location)
 *   - MEDICAL_ADMIN → Medical, Parent, Athlete
 *   - CONTENT_MARKETING_ADMIN → Content & Marketing (at any location)
 *   - PARTNERSHIP_COACH → only their partner-school athletes
 *   - Everyone else: cannot invite
 */

import { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';

// ============================================================================
// ROLE CATEGORIES — groups of roles that commonly share permissions
// ============================================================================

/** Roles that have access across all PPL locations with no location filter. */
export const GLOBAL_ROLES: readonly Role[] = [
  Role.ADMIN,
  Role.CONTENT_MARKETING_ADMIN,
  Role.MEDICAL_ADMIN,
  Role.PARENT,
  Role.ATHLETE,
] as const;

/** Roles that are scoped to one or more Locations via UserRole.locationId. */
export const LOCATION_SCOPED_ROLES: readonly Role[] = [
  Role.COORDINATOR,
  Role.PERFORMANCE_COACH,
  Role.CONTENT_MARKETING,
  Role.MEDICAL,
] as const;

/** Roles that operate on behalf of PPL as staff (excludes PARENT, ATHLETE, OUTSIDE_COACH). */
export const STAFF_ROLES: readonly Role[] = [
  Role.ADMIN,
  Role.COORDINATOR,
  Role.PERFORMANCE_COACH,
  Role.CONTENT_MARKETING_ADMIN,
  Role.CONTENT_MARKETING,
  Role.MEDICAL_ADMIN,
  Role.MEDICAL,
  Role.PARTNERSHIP_COACH,
] as const;

// ============================================================================
// USER ROLE LOOKUP
// ============================================================================

export type UserRoleRow = {
  role: Role;
  locationId: string | null;
  schoolTeamId: string | null;
};

/**
 * Fetch all UserRole rows for a user. Returns [] if none (user has no
 * explicit assignments yet — caller should fall back to legacy User.role
 * logic during the transition period).
 *
 * NOTE: during the migration window, some users only have the legacy
 * User.role column set and no UserRole rows. The data-migration script
 * in `scripts/migrate-user-roles.ts` backfills them, but this helper
 * should treat an empty result as "not yet migrated", not "no access".
 */
export async function getUserRoles(userId: string): Promise<UserRoleRow[]> {
  return prisma.userRole.findMany({
    where: { userId },
    select: { role: true, locationId: true, schoolTeamId: true },
  });
}

/** Does the user hold the given role at any scope? */
export async function hasRole(userId: string, role: Role): Promise<boolean> {
  const row = await prisma.userRole.findFirst({
    where: { userId, role },
    select: { id: true },
  });
  return row !== null;
}

/** Does the user hold the given role at the given location? */
export async function hasRoleAtLocation(
  userId: string,
  role: Role,
  locationId: string
): Promise<boolean> {
  const row = await prisma.userRole.findFirst({
    where: { userId, role, locationId },
    select: { id: true },
  });
  return row !== null;
}

/** Does the user hold Partnership Coach role for the given school? */
export async function hasRoleForSchool(
  userId: string,
  role: Role,
  schoolTeamId: string
): Promise<boolean> {
  const row = await prisma.userRole.findFirst({
    where: { userId, role, schoolTeamId },
    select: { id: true },
  });
  return row !== null;
}

/** Is the user a global ADMIN? (shortcut — most common check) */
export async function isAdmin(userId: string): Promise<boolean> {
  return hasRole(userId, Role.ADMIN);
}

/** All locationIds where the user holds the given role. */
export async function locationsForRole(userId: string, role: Role): Promise<string[]> {
  const rows = await prisma.userRole.findMany({
    where: { userId, role, NOT: { locationId: null } },
    select: { locationId: true },
  });
  return rows.map((r) => r.locationId!).filter((v): v is string => v !== null);
}

/** All schoolTeamIds where the user is a Partnership Coach. */
export async function partnerSchoolsForCoach(userId: string): Promise<string[]> {
  const rows = await prisma.userRole.findMany({
    where: { userId, role: Role.PARTNERSHIP_COACH, NOT: { schoolTeamId: null } },
    select: { schoolTeamId: true },
  });
  return rows.map((r) => r.schoolTeamId!).filter((v): v is string => v !== null);
}

// ============================================================================
// INVITE PERMISSION MATRIX — Chad's spec
// ============================================================================

/**
 * Scope qualifier for an invite. If the inviter is location-scoped
 * (Coordinator, Performance Coach), the targetLocationId must match one of
 * their locations. If targetRole is PARTNERSHIP_COACH, targetSchoolTeamId
 * must be provided and (for Partnership Coach inviters) match.
 */
export type InviteScope = {
  targetLocationId?: string;
  targetSchoolTeamId?: string;
};

/**
 * Who can invite whom — returns `true` if `inviterUserId` is allowed to
 * invite a user with `targetRole` into `scope`.
 *
 * Matrix (from Chad's spec, April 2026):
 *   ADMIN                    → any role, any scope
 *   COORDINATOR              → any role at their location (including MEDICAL/MEDICAL_ADMIN)
 *   PERFORMANCE_COACH        → PERFORMANCE_COACH, CONTENT_MARKETING, OUTSIDE_COACH,
 *                              PARENT, ATHLETE (at their location only)
 *   MEDICAL_ADMIN            → MEDICAL, PARENT, ATHLETE (global — they're a single-user role)
 *   CONTENT_MARKETING_ADMIN  → CONTENT_MARKETING (at any location)
 *   PARTNERSHIP_COACH        → ATHLETE (within their partner school only)
 *   Everyone else            → cannot invite (return false)
 */
export async function canInvite(
  inviterUserId: string,
  targetRole: Role,
  scope: InviteScope = {}
): Promise<boolean> {
  const inviterRoles = await getUserRoles(inviterUserId);

  // Fast path — global ADMIN can invite anyone.
  if (inviterRoles.some((r) => r.role === Role.ADMIN)) {
    return true;
  }

  // COORDINATOR → everyone at their location.
  const coordinatorLocations = inviterRoles
    .filter((r) => r.role === Role.COORDINATOR && r.locationId !== null)
    .map((r) => r.locationId!);
  if (coordinatorLocations.length > 0) {
    // Global roles (PARENT, ATHLETE) — Coordinator can invite them.
    if (targetRole === Role.PARENT || targetRole === Role.ATHLETE) return true;
    // Location-scoped roles — must be at the coordinator's location.
    if (
      LOCATION_SCOPED_ROLES.includes(targetRole) &&
      scope.targetLocationId &&
      coordinatorLocations.includes(scope.targetLocationId)
    ) {
      return true;
    }
    // MEDICAL_ADMIN — Chad said Coordinator can invite Medical Admin if it's
    // for their location (but Medical Admin is typically a singleton global
    // role, so this is rare). Allow at the coordinator's location anyway.
    if (targetRole === Role.MEDICAL_ADMIN && coordinatorLocations.length > 0) {
      return true;
    }
  }

  // PERFORMANCE_COACH → PERFORMANCE_COACH, CONTENT_MARKETING, OUTSIDE_COACH,
  // PARENT, ATHLETE (at their location only).
  const coachLocations = inviterRoles
    .filter((r) => r.role === Role.PERFORMANCE_COACH && r.locationId !== null)
    .map((r) => r.locationId!);
  if (coachLocations.length > 0) {
    const allowed: Role[] = [
      Role.PERFORMANCE_COACH,
      Role.CONTENT_MARKETING,
      Role.OUTSIDE_COACH,
      Role.PARENT,
      Role.ATHLETE,
    ];
    if (allowed.includes(targetRole)) {
      // Global roles don't need location match.
      if (targetRole === Role.PARENT || targetRole === Role.ATHLETE || targetRole === Role.OUTSIDE_COACH) {
        return true;
      }
      // Location-scoped roles must be at a location the inviter serves.
      if (scope.targetLocationId && coachLocations.includes(scope.targetLocationId)) {
        return true;
      }
    }
  }

  // MEDICAL_ADMIN → MEDICAL, PARENT, ATHLETE.
  if (inviterRoles.some((r) => r.role === Role.MEDICAL_ADMIN)) {
    if (targetRole === Role.MEDICAL || targetRole === Role.PARENT || targetRole === Role.ATHLETE) {
      return true;
    }
  }

  // CONTENT_MARKETING_ADMIN → CONTENT_MARKETING (at any location).
  if (inviterRoles.some((r) => r.role === Role.CONTENT_MARKETING_ADMIN)) {
    if (targetRole === Role.CONTENT_MARKETING) {
      return true;
    }
  }

  // PARTNERSHIP_COACH → ATHLETE within their partner school only.
  const coachSchools = inviterRoles
    .filter((r) => r.role === Role.PARTNERSHIP_COACH && r.schoolTeamId !== null)
    .map((r) => r.schoolTeamId!);
  if (
    coachSchools.length > 0 &&
    targetRole === Role.ATHLETE &&
    scope.targetSchoolTeamId &&
    coachSchools.includes(scope.targetSchoolTeamId)
  ) {
    return true;
  }

  return false;
}

/**
 * Return the list of roles the given inviter is allowed to invite. Used by
 * the admin invite UI dropdown (Commit 3) so we only show them the options
 * they can actually execute.
 */
export async function invitableRoles(inviterUserId: string): Promise<Role[]> {
  const inviterRoles = await getUserRoles(inviterUserId);

  if (inviterRoles.some((r) => r.role === Role.ADMIN)) {
    // Everyone except legacy values (STAFF/CLIENT).
    return [
      Role.ADMIN,
      Role.COORDINATOR,
      Role.PERFORMANCE_COACH,
      Role.CONTENT_MARKETING_ADMIN,
      Role.CONTENT_MARKETING,
      Role.MEDICAL_ADMIN,
      Role.MEDICAL,
      Role.PARTNERSHIP_COACH,
      Role.OUTSIDE_COACH,
      Role.PARENT,
      Role.ATHLETE,
    ];
  }
  if (inviterRoles.some((r) => r.role === Role.COORDINATOR)) {
    return [
      Role.COORDINATOR,
      Role.PERFORMANCE_COACH,
      Role.CONTENT_MARKETING,
      Role.MEDICAL_ADMIN,
      Role.MEDICAL,
      Role.OUTSIDE_COACH,
      Role.PARENT,
      Role.ATHLETE,
    ];
  }
  if (inviterRoles.some((r) => r.role === Role.PERFORMANCE_COACH)) {
    return [
      Role.PERFORMANCE_COACH,
      Role.CONTENT_MARKETING,
      Role.OUTSIDE_COACH,
      Role.PARENT,
      Role.ATHLETE,
    ];
  }
  if (inviterRoles.some((r) => r.role === Role.MEDICAL_ADMIN)) {
    return [Role.MEDICAL, Role.PARENT, Role.ATHLETE];
  }
  if (inviterRoles.some((r) => r.role === Role.CONTENT_MARKETING_ADMIN)) {
    return [Role.CONTENT_MARKETING];
  }
  if (inviterRoles.some((r) => r.role === Role.PARTNERSHIP_COACH)) {
    return [Role.ATHLETE];
  }
  return [];
}

// ============================================================================
// EXPRESS MIDDLEWARE FACTORIES
// ============================================================================

/**
 * Middleware — require the authenticated user to hold at least one of the
 * given roles (at any scope). Use when a feature is gated by role membership
 * but scope-checking happens inside the handler.
 *
 * Example:
 *   router.get('/screenings', authenticate, requireAnyRole(Role.MEDICAL, Role.MEDICAL_ADMIN), handler);
 */
export function requireAnyRole(...roles: Role[]) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        return next(ApiError.unauthorized());
      }
      const userRoles = await getUserRoles(req.user.userId);
      const has = userRoles.some((r) => roles.includes(r.role));
      if (!has) {
        return next(ApiError.forbidden('You do not have permission to perform this action'));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Middleware — require a role at a SPECIFIC location, where the locationId
 * is pulled from the request (body, query, or route params). The `locator`
 * function receives the request and returns the locationId to check.
 *
 * Example (coordinator-only update of a location's schedule):
 *   router.put(
 *     '/locations/:id/schedule',
 *     authenticate,
 *     requireRoleAtLocation([Role.ADMIN, Role.COORDINATOR], (req) => req.params.id),
 *     handler
 *   );
 *
 * ADMIN is automatically allowed through — they have global access.
 */
export function requireRoleAtLocation(
  roles: Role[],
  locator: (req: Request) => string | undefined
) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        return next(ApiError.unauthorized());
      }

      // ADMIN always allowed.
      if (await isAdmin(req.user.userId)) {
        return next();
      }

      const locationId = locator(req);
      if (!locationId) {
        return next(ApiError.badRequest('Missing location context on request'));
      }

      const rows = await prisma.userRole.findMany({
        where: { userId: req.user.userId, role: { in: roles }, locationId },
        select: { id: true },
      });
      if (rows.length === 0) {
        return next(ApiError.forbidden('You do not have access to this location'));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
