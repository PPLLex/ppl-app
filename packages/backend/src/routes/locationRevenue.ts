import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate, requireStaffOrAdmin } from '../middleware/auth';
import { Role, LocationRole, MembershipStatus } from '@prisma/client';

const router = Router();

// All revenue routes require at least STAFF role
router.use(authenticate, requireStaffOrAdmin);

/**
 * Helper: check if the requesting user has OWNER or COORDINATOR role at a location.
 * ADMIN bypasses this check entirely.
 */
async function assertRevenueAccess(userId: string, role: Role, locationId: string): Promise<LocationRole | 'ADMIN'> {
  if (role === Role.ADMIN) return 'ADMIN';

  const assignment = await prisma.staffLocation.findUnique({
    where: { staffId_locationId: { staffId: userId, locationId } },
  });

  if (!assignment) {
    throw ApiError.forbidden('You are not assigned to this location');
  }
  // Only COACH-only assignments are blocked from revenue; coordinators/owners/trainers can view
  const revenueRoles: LocationRole[] = [LocationRole.OWNER, LocationRole.PITCHING_COORDINATOR, LocationRole.YOUTH_COORDINATOR];
  const hasRevenueAccess = assignment.roles.some((r) => revenueRoles.includes(r));
  if (!hasRevenueAccess) {
    throw ApiError.forbidden('Coaches do not have access to revenue data');
  }

  // Return the highest-privilege role
  return assignment.roles.includes(LocationRole.OWNER) ? LocationRole.OWNER : assignment.roles[0];
}

/**
 * GET /api/locations/:locationId/revenue
 * Revenue summary for a specific location.
 * Accessible by: ADMIN (any location), OWNER/COORDINATOR (their location only)
 *
 * Returns: active member count, total monthly revenue, membership breakdown,
 *          recent signups, cancellations, past-due members.
 */
router.get('/:locationId/revenue', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = Array.isArray(req.params.locationId) ? req.params.locationId[0] : req.params.locationId;
    const user = req.user!;

    // Check access
    const accessLevel = await assertRevenueAccess(user.userId, user.role, locationId);

    // Verify location exists
    const location = await prisma.location.findUnique({
      where: { id: locationId },
      select: { id: true, name: true },
    });
    if (!location) throw ApiError.notFound('Location not found');

    // Get all memberships at this location
    const memberships = await prisma.clientMembership.findMany({
      where: { locationId },
      include: {
        plan: { select: { name: true, priceCents: true, billingCycle: true, sessionsPerWeek: true } },
        client: { select: { id: true, fullName: true, email: true } },
      },
    });

    // Categorize by status
    const active = memberships.filter((m) => m.status === MembershipStatus.ACTIVE);
    const pastDue = memberships.filter((m) => m.status === MembershipStatus.PAST_DUE);
    const suspended = memberships.filter((m) => m.status === MembershipStatus.SUSPENDED);
    const cancelled = memberships.filter((m) => m.status === MembershipStatus.CANCELLED);

    // Calculate revenue
    const activeRevenueCents = active.reduce((sum, m) => sum + m.plan.priceCents, 0);
    const weeklyRevenueCents = active
      .filter((m) => m.plan.billingCycle === 'WEEKLY')
      .reduce((sum, m) => sum + m.plan.priceCents, 0);
    const monthlyRevenueCents = active
      .filter((m) => m.plan.billingCycle === 'MONTHLY')
      .reduce((sum, m) => sum + m.plan.priceCents, 0);

    // Estimated monthly: weekly * 4.33 + monthly
    const estimatedMonthlyRevenueCents = Math.round(weeklyRevenueCents * 4.33) + monthlyRevenueCents;

    // Recent signups (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentSignups = active.filter((m) => m.startedAt && m.startedAt >= thirtyDaysAgo);

    // Recent cancellations (last 30 days)
    const recentCancellations = cancelled.filter((m) => m.cancelledAt && m.cancelledAt >= thirtyDaysAgo);

    // Plan breakdown
    const planBreakdown: Record<string, { count: number; revenueCents: number }> = {};
    for (const m of active) {
      const name = m.plan.name;
      if (!planBreakdown[name]) planBreakdown[name] = { count: 0, revenueCents: 0 };
      planBreakdown[name].count++;
      planBreakdown[name].revenueCents += m.plan.priceCents;
    }

    res.json({
      success: true,
      data: {
        location,
        accessLevel,
        summary: {
          activeMemberCount: active.length,
          pastDueCount: pastDue.length,
          suspendedCount: suspended.length,
          cancelledCount: cancelled.length,
          totalMemberships: memberships.length,
        },
        revenue: {
          activeRevenueCents,
          weeklyRevenueCents,
          monthlyRevenueCents,
          estimatedMonthlyRevenueCents,
        },
        planBreakdown: Object.entries(planBreakdown).map(([name, data]) => ({
          planName: name,
          ...data,
        })),
        recentActivity: {
          newSignupsLast30Days: recentSignups.length,
          cancellationsLast30Days: recentCancellations.length,
        },
        // Full member list for OWNER/ADMIN; summary only for COORDINATOR
        members: accessLevel === LocationRole.OWNER || accessLevel === 'ADMIN'
          ? {
              active: active.map((m) => ({
                clientId: m.client.id,
                clientName: m.client.fullName,
                clientEmail: m.client.email,
                planName: m.plan.name,
                priceCents: m.plan.priceCents,
                billingCycle: m.plan.billingCycle,
                status: m.status,
                startedAt: m.startedAt,
              })),
              pastDue: pastDue.map((m) => ({
                clientId: m.client.id,
                clientName: m.client.fullName,
                clientEmail: m.client.email,
                planName: m.plan.name,
                priceCents: m.plan.priceCents,
                status: m.status,
              })),
            }
          : undefined,  // Coordinators see counts but not individual member details
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/locations/:locationId/my-role
 * Returns the requesting user's role at this specific location.
 */
router.get('/:locationId/my-role', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = Array.isArray(req.params.locationId) ? req.params.locationId[0] : req.params.locationId;
    const user = req.user!;

    if (user.role === Role.ADMIN) {
      return res.json({ success: true, data: { locationRole: 'ADMIN', globalRole: user.role } });
    }

    const assignment = await prisma.staffLocation.findUnique({
      where: { staffId_locationId: { staffId: user.userId, locationId } },
      select: { roles: true },
    });

    if (!assignment) {
      return res.json({ success: true, data: { locationRole: null, roles: [], globalRole: user.role } });
    }

    // Return the primary role for backward compat + full roles array
    const primaryRole = assignment.roles.includes(LocationRole.OWNER) ? LocationRole.OWNER : assignment.roles[0];
    res.json({ success: true, data: { locationRole: primaryRole, roles: assignment.roles, globalRole: user.role } });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/locations/my-assignments
 * Returns all location assignments for the requesting staff member.
 */
router.get('/my-assignments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;

    if (user.role === Role.ADMIN) {
      // Admins see all locations
      const allLocations = await prisma.location.findMany({
        where: { isActive: true },
        select: { id: true, name: true, address: true },
        orderBy: { name: 'asc' },
      });
      return res.json({
        success: true,
        data: allLocations.map((loc) => ({ ...loc, locationRole: 'ADMIN' as const })),
      });
    }

    const assignments = await prisma.staffLocation.findMany({
      where: { staffId: user.userId },
      include: {
        location: { select: { id: true, name: true, address: true } },
      },
    });

    res.json({
      success: true,
      data: assignments.map((a) => ({
        ...a.location,
        locationRole: a.roles.includes(LocationRole.OWNER) ? LocationRole.OWNER : a.roles[0],
        roles: a.roles,
      })),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
