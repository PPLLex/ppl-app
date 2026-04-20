import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate, requireStaffOrAdmin } from '../middleware/auth';
import { Role, MembershipStatus } from '@prisma/client';

const router = Router();

router.use(authenticate, requireStaffOrAdmin);

/**
 * GET /api/revenue/dashboard
 * Admin only: full revenue overview across all locations.
 * Returns:
 *   - totalRevenue (all locations combined)
 *   - totalPPLRevenue (excludes partner school/external revenue)
 *   - revenueByLocation (each location's breakdown)
 *   - youthRevenueByLocation (youth-specific revenue per location)
 *   - membershipCounts by status
 *   - pendingFines from attendance violations
 */
router.get('/dashboard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    if (user.role !== Role.ADMIN) throw ApiError.forbidden('Admin access required');

    // Get all active memberships across all locations
    const memberships = await prisma.clientMembership.findMany({
      where: {
        status: { in: [MembershipStatus.ACTIVE, MembershipStatus.PAST_DUE] },
      },
      include: {
        plan: { select: { name: true, priceCents: true, billingCycle: true, ageGroup: true, sessionsPerWeek: true } },
        location: { select: { id: true, name: true } },
      },
    });

    // All locations
    const locations = await prisma.location.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });

    // Calculate totals
    const activeMemberships = memberships.filter((m) => m.status === MembershipStatus.ACTIVE);
    const pastDueMemberships = memberships.filter((m) => m.status === MembershipStatus.PAST_DUE);

    // Estimate weekly billing → annualize
    function estimateWeeklyRevenueCents(mems: typeof activeMemberships): number {
      return mems.reduce((sum, m) => {
        if (m.plan.billingCycle === 'WEEKLY') return sum + m.plan.priceCents;
        if (m.plan.billingCycle === 'MONTHLY') return sum + Math.round(m.plan.priceCents / 4.33);
        return sum + m.plan.priceCents; // fallback: treat as weekly
      }, 0);
    }

    const totalWeeklyRevenueCents = estimateWeeklyRevenueCents(activeMemberships);
    const totalMonthlyRevenueCents = Math.round(totalWeeklyRevenueCents * 4.33);

    // PPL Revenue = all internal memberships (not partner school)
    const pplMemberships = activeMemberships.filter((m) => m.plan.ageGroup !== 'partner_school');
    const pplWeeklyRevenueCents = estimateWeeklyRevenueCents(pplMemberships);
    const pplMonthlyRevenueCents = Math.round(pplWeeklyRevenueCents * 4.33);

    // Revenue by location
    const revenueByLocation = locations.map((loc) => {
      const locActive = activeMemberships.filter((m) => m.locationId === loc.id);
      const locPastDue = pastDueMemberships.filter((m) => m.locationId === loc.id);
      const weeklyRev = estimateWeeklyRevenueCents(locActive);
      return {
        locationId: loc.id,
        locationName: loc.name,
        activeMemberCount: locActive.length,
        pastDueCount: locPastDue.length,
        weeklyRevenueCents: weeklyRev,
        monthlyRevenueCents: Math.round(weeklyRev * 4.33),
        pastDueAmountCents: locPastDue.reduce((s, m) => s + m.plan.priceCents, 0),
      };
    });

    // Youth revenue by location
    const youthRevenueByLocation = locations.map((loc) => {
      const youthMembers = activeMemberships.filter(
        (m) => m.locationId === loc.id && m.plan.ageGroup === 'youth'
      );
      const weeklyRev = estimateWeeklyRevenueCents(youthMembers);
      return {
        locationId: loc.id,
        locationName: loc.name,
        youthMemberCount: youthMembers.length,
        weeklyRevenueCents: weeklyRev,
        monthlyRevenueCents: Math.round(weeklyRev * 4.33),
      };
    });

    // Pending fines (attendance violations)
    const pendingFines = await prisma.attendanceViolation.aggregate({
      where: { status: 'PENDING' },
      _sum: { amountCents: true },
      _count: true,
    });

    // Past due amount
    const pastDueAmountCents = pastDueMemberships.reduce((sum, m) => sum + m.plan.priceCents, 0);

    res.json({
      success: true,
      data: {
        totals: {
          totalWeeklyRevenueCents,
          totalMonthlyRevenueCents,
          pplWeeklyRevenueCents,
          pplMonthlyRevenueCents,
          activeMemberCount: activeMemberships.length,
          pastDueCount: pastDueMemberships.length,
          pastDueAmountCents,
          pendingFinesCount: pendingFines._count,
          pendingFinesCents: pendingFines._sum.amountCents || 0,
        },
        revenueByLocation,
        youthRevenueByLocation,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/revenue/weekly-report
 * Admin only: generates the weekly revenue report data (same as email content).
 * The actual email sending is handled by the cron/scheduled task.
 */
router.get('/weekly-report', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    if (user.role !== Role.ADMIN) throw ApiError.forbidden('Admin access required');

    // Same data as dashboard but structured for the weekly email
    const data = await generateWeeklyReportData();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/**
 * Generates the weekly report data used by both the API and the scheduled email.
 * Exported so the cron service can use it directly.
 */
export async function generateWeeklyReportData() {
  const memberships = await prisma.clientMembership.findMany({
    include: {
      plan: { select: { name: true, priceCents: true, billingCycle: true, ageGroup: true } },
      location: { select: { id: true, name: true } },
      client: { select: { id: true, fullName: true } },
    },
  });

  const locations = await prisma.location.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });

  const active = memberships.filter((m) => m.status === MembershipStatus.ACTIVE);
  const pastDue = memberships.filter((m) => m.status === MembershipStatus.PAST_DUE);
  const suspended = memberships.filter((m) => m.status === MembershipStatus.SUSPENDED);

  // New signups this week
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const newSignups = active.filter((m) => m.startedAt && m.startedAt >= oneWeekAgo);

  // Cancellations this week
  const recentCancellations = memberships.filter(
    (m) => m.status === MembershipStatus.CANCELLED && m.cancelledAt && m.cancelledAt >= oneWeekAgo
  );

  function weeklyRev(mems: typeof active): number {
    return mems.reduce((sum, m) => {
      if (m.plan.billingCycle === 'WEEKLY') return sum + m.plan.priceCents;
      if (m.plan.billingCycle === 'MONTHLY') return sum + Math.round(m.plan.priceCents / 4.33);
      return sum + m.plan.priceCents;
    }, 0);
  }

  const locationBreakdown = locations.map((loc) => {
    const locActive = active.filter((m) => m.locationId === loc.id);
    const locPastDue = pastDue.filter((m) => m.locationId === loc.id);
    const locYouth = locActive.filter((m) => m.plan.ageGroup === 'youth');
    return {
      name: loc.name,
      activeMemberCount: locActive.length,
      pastDueCount: locPastDue.length,
      weeklyRevenueCents: weeklyRev(locActive),
      youthMemberCount: locYouth.length,
      youthWeeklyRevenueCents: weeklyRev(locYouth),
    };
  });

  // Pending violations
  const pendingViolations = await prisma.attendanceViolation.findMany({
    where: { status: 'PENDING' },
    include: {
      client: { select: { fullName: true } },
    },
  });

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      totalActiveMemberCount: active.length,
      totalPastDueCount: pastDue.length,
      totalSuspendedCount: suspended.length,
      totalWeeklyRevenueCents: weeklyRev(active),
      pplWeeklyRevenueCents: weeklyRev(active.filter((m) => m.plan.ageGroup !== 'partner_school')),
    },
    locationBreakdown,
    weeklyActivity: {
      newSignups: newSignups.map((m) => ({ name: m.client.fullName, plan: m.plan.name, location: m.location.name })),
      cancellations: recentCancellations.map((m) => ({ name: m.client.fullName, plan: m.plan.name, location: m.location.name })),
    },
    pastDueMembers: pastDue.map((m) => ({
      name: m.client.fullName,
      plan: m.plan.name,
      location: m.location.name,
      amountCents: m.plan.priceCents,
    })),
    pendingViolations: pendingViolations.map((v) => ({
      athlete: v.client.fullName,
      type: v.type,
      amountCents: v.amountCents,
    })),
  };
}

export default router;
