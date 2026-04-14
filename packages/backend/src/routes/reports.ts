import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, requireAdmin } from '../middleware/auth';
import {
  MembershipStatus,
  BookingStatus,
  PaymentStatus,
} from '@prisma/client';

const router = Router();

// All report routes require admin
router.use(authenticate, requireAdmin);

// ============================================================
// REVENUE REPORTS
// ============================================================

/**
 * GET /api/reports/revenue
 * Revenue statistics with optional period and location filters.
 */
router.get('/revenue', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = (req.query.period as string) || '30d';
    const locationId = req.query.locationId as string | undefined;

    const periodDays = period === '7d' ? 7 : period === '90d' ? 90 : period === '1y' ? 365 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodDays);

    // Build where clause
    const paymentWhere: any = {
      status: PaymentStatus.SUCCEEDED,
      createdAt: { gte: startDate },
    };

    // Total lifetime revenue
    const totalRevenueResult = await prisma.payment.aggregate({
      _sum: { amountCents: true },
      where: { status: PaymentStatus.SUCCEEDED },
    });
    const totalRevenue = (totalRevenueResult._sum.amountCents || 0) / 100;

    // Period revenue
    const periodRevenueResult = await prisma.payment.aggregate({
      _sum: { amountCents: true },
      where: paymentWhere,
    });
    const periodRevenue = (periodRevenueResult._sum.amountCents || 0) / 100;

    // Active members count
    const activeMemberCount = await prisma.clientMembership.count({
      where: { status: MembershipStatus.ACTIVE },
    });
    const averagePerMember = activeMemberCount > 0 ? periodRevenue / activeMemberCount : 0;

    // Past due amount
    const pastDueResult = await prisma.clientMembership.findMany({
      where: { status: MembershipStatus.PAST_DUE },
      include: { plan: { select: { priceCents: true } } },
    });
    const pastDueAmount = pastDueResult.reduce((sum, m) => sum + m.plan.priceCents, 0) / 100;

    // Revenue by plan
    const membershipsWithPlan = await prisma.clientMembership.findMany({
      where: { status: { in: [MembershipStatus.ACTIVE, MembershipStatus.PAST_DUE] } },
      include: { plan: { select: { name: true, priceCents: true } } },
    });

    const planMap = new Map<string, { revenue: number; members: number }>();
    membershipsWithPlan.forEach((m) => {
      const existing = planMap.get(m.plan.name) || { revenue: 0, members: 0 };
      existing.revenue += m.plan.priceCents / 100;
      existing.members += 1;
      planMap.set(m.plan.name, existing);
    });
    const revenueByPlan = Array.from(planMap.entries()).map(([plan, data]) => ({
      plan,
      ...data,
    }));

    // Revenue by month (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const monthlyPayments = await prisma.payment.findMany({
      where: {
        status: PaymentStatus.SUCCEEDED,
        createdAt: { gte: sixMonthsAgo },
      },
      select: { amountCents: true, createdAt: true },
    });

    const monthMap = new Map<string, number>();
    monthlyPayments.forEach((p) => {
      const key = p.createdAt.toISOString().slice(0, 7); // YYYY-MM
      monthMap.set(key, (monthMap.get(key) || 0) + p.amountCents / 100);
    });
    const revenueByMonth = Array.from(monthMap.entries())
      .sort()
      .map(([month, revenue]) => ({ month, revenue }));

    res.json({
      success: true,
      data: {
        totalRevenue,
        periodRevenue,
        averagePerMember: Math.round(averagePerMember * 100) / 100,
        pastDueAmount,
        revenueByPlan,
        revenueByMonth,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================
// BOOKING REPORTS
// ============================================================

/**
 * GET /api/reports/bookings
 * Booking and session utilization statistics.
 */
router.get('/bookings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = (req.query.period as string) || '30d';
    const periodDays = period === '7d' ? 7 : period === '90d' ? 90 : period === '1y' ? 365 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodDays);

    // Total bookings
    const totalBookings = await prisma.booking.count({
      where: { status: BookingStatus.CONFIRMED },
    });

    // Period bookings
    const periodBookings = await prisma.booking.count({
      where: {
        status: BookingStatus.CONFIRMED,
        createdAt: { gte: startDate },
      },
    });

    // Sessions in period
    const sessionsInPeriod = await prisma.session.findMany({
      where: {
        startTime: { gte: startDate },
      },
      include: {
        _count: { select: { bookings: { where: { status: BookingStatus.CONFIRMED } } } },
      },
    });

    const totalCapacity = sessionsInPeriod.reduce((sum, s) => sum + s.maxCapacity, 0);
    const totalBooked = sessionsInPeriod.reduce((sum, s) => sum + s._count.bookings, 0);
    const utilizationRate = totalCapacity > 0 ? (totalBooked / totalCapacity) * 100 : 0;
    const averagePerSession =
      sessionsInPeriod.length > 0 ? totalBooked / sessionsInPeriod.length : 0;

    // Bookings by session type
    const bookingsByType = await prisma.booking.groupBy({
      by: ['status'],
      _count: true,
      where: { createdAt: { gte: startDate } },
    });

    // Bookings by day of week
    const recentBookings = await prisma.booking.findMany({
      where: {
        status: BookingStatus.CONFIRMED,
        createdAt: { gte: startDate },
      },
      include: {
        session: { select: { startTime: true, type: true } },
      },
    });

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayCount = new Map<string, number>();
    dayNames.forEach((d) => dayCount.set(d, 0));

    const hourCount = new Map<number, number>();
    const typeCount = new Map<string, number>();

    recentBookings.forEach((b) => {
      const day = dayNames[b.session.startTime.getDay()];
      dayCount.set(day, (dayCount.get(day) || 0) + 1);

      const hour = b.session.startTime.getHours();
      hourCount.set(hour, (hourCount.get(hour) || 0) + 1);

      typeCount.set(b.session.type, (typeCount.get(b.session.type) || 0) + 1);
    });

    res.json({
      success: true,
      data: {
        totalBookings,
        periodBookings,
        averagePerSession: Math.round(averagePerSession * 10) / 10,
        utilizationRate: Math.round(utilizationRate * 10) / 10,
        bookingsByType: Array.from(typeCount.entries()).map(([type, count]) => ({ type, count })),
        bookingsByDay: dayNames.map((day) => ({ day, count: dayCount.get(day) || 0 })),
        popularTimes: Array.from(hourCount.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([hour, count]) => ({ hour, count })),
      },
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================
// MEMBER REPORTS
// ============================================================

/**
 * GET /api/reports/members
 * Member demographics and growth statistics.
 */
router.get('/members', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const totalActive = await prisma.clientMembership.count({
      where: { status: MembershipStatus.ACTIVE },
    });

    const totalInactive = await prisma.clientMembership.count({
      where: { status: { in: [MembershipStatus.CANCELLED, MembershipStatus.EXPIRED] } },
    });

    // New this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const newThisMonth = await prisma.clientMembership.count({
      where: {
        status: MembershipStatus.ACTIVE,
        createdAt: { gte: startOfMonth },
      },
    });

    // Churn: cancelled in last 30 days / active at start of period
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const cancelledRecent = await prisma.clientMembership.count({
      where: {
        status: MembershipStatus.CANCELLED,
        updatedAt: { gte: thirtyDaysAgo },
      },
    });

    const activeAtStart = totalActive + cancelledRecent;
    const churnRate = activeAtStart > 0 ? (cancelledRecent / activeAtStart) * 100 : 0;

    // By age group
    const membersByAgeGroup = await prisma.clientProfile.groupBy({
      by: ['ageGroup'],
      _count: true,
    });

    // By plan
    const membersByPlan = await prisma.clientMembership.findMany({
      where: { status: MembershipStatus.ACTIVE },
      include: { plan: { select: { name: true } } },
    });

    const planCount = new Map<string, number>();
    membersByPlan.forEach((m) => {
      planCount.set(m.plan.name, (planCount.get(m.plan.name) || 0) + 1);
    });

    // By location
    const membersByLocation = await prisma.clientMembership.findMany({
      where: { status: MembershipStatus.ACTIVE },
      include: { location: { select: { name: true } } },
    });

    const locationCount = new Map<string, number>();
    membersByLocation.forEach((m) => {
      const locName = m.location?.name || 'Unassigned';
      locationCount.set(locName, (locationCount.get(locName) || 0) + 1);
    });

    res.json({
      success: true,
      data: {
        totalActive,
        totalInactive,
        newThisMonth,
        churnRate: Math.round(churnRate * 10) / 10,
        byAgeGroup: membersByAgeGroup.map((g) => ({
          ageGroup: g.ageGroup,
          count: g._count,
        })),
        byPlan: Array.from(planCount.entries()).map(([plan, count]) => ({ plan, count })),
        byLocation: Array.from(locationCount.entries()).map(([location, count]) => ({ location, count })),
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
