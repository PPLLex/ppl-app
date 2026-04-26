import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, requireAdmin } from '../middleware/auth';
import {
  MembershipStatus,
  BookingStatus,
  PaymentStatus,
  SessionType,
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
        session: { select: { startTime: true, sessionType: true } },
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

      typeCount.set(b.session.sessionType, (typeCount.get(b.session.sessionType) || 0) + 1);
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
      where: { status: { in: [MembershipStatus.CANCELLED, MembershipStatus.SUSPENDED] } },
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

// ============================================================
// ADMIN DASHBOARD — Daily Ops Command Center
// ============================================================

/**
 * GET /api/reports/dashboard
 * Aggregated daily ops data for the admin command center.
 */
router.get('/dashboard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    // 7 days ago for weekly trends
    const weekAgo = new Date(todayStart);
    weekAgo.setDate(weekAgo.getDate() - 7);

    // 30 days ago for monthly comparisons
    const thirtyDaysAgo = new Date(todayStart);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Previous 30-day window for comparison
    const sixtyDaysAgo = new Date(todayStart);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    // ── Today's Sessions + Attendance ──
    const todaySessions = await prisma.session.findMany({
      where: {
        startTime: { gte: todayStart, lt: todayEnd },
      },
      include: {
        coach: { select: { id: true, fullName: true } },
        room: { select: { id: true, name: true } },
        bookings: {
          where: { status: { in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED, BookingStatus.NO_SHOW] } },
          select: { status: true },
        },
        _count: {
          select: {
            bookings: { where: { status: BookingStatus.CONFIRMED } },
          },
        },
      },
      orderBy: { startTime: 'asc' },
    });

    const todaySessionsSummary = todaySessions.map((s) => {
      const checkedIn = s.bookings.filter((b) => b.status === 'COMPLETED').length;
      const noShows = s.bookings.filter((b) => b.status === 'NO_SHOW').length;
      const pending = s.bookings.filter((b) => b.status === 'CONFIRMED').length;
      const isActive = now >= s.startTime && now <= s.endTime;
      const isPast = now > s.endTime;
      return {
        id: s.id,
        title: s.title,
        sessionType: s.sessionType,
        startTime: s.startTime.toISOString(),
        endTime: s.endTime.toISOString(),
        maxCapacity: s.maxCapacity,
        enrolled: s._count.bookings,
        checkedIn,
        noShows,
        pending,
        isActive,
        isPast,
        coach: s.coach ? { id: s.coach.id, name: s.coach.fullName } : null,
        room: s.room ? { id: s.room.id, name: s.room.name } : null,
      };
    });

    const totalBookingsToday = todaySessionsSummary.reduce((sum, s) => sum + s.enrolled, 0);
    const totalCheckedInToday = todaySessionsSummary.reduce((sum, s) => sum + s.checkedIn, 0);

    // ── Membership Counts ──
    const [activeMemberships, pastDueMemberships, suspendedMemberships] = await Promise.all([
      prisma.clientMembership.count({ where: { status: MembershipStatus.ACTIVE } }),
      prisma.clientMembership.count({ where: { status: MembershipStatus.PAST_DUE } }),
      prisma.clientMembership.count({ where: { status: MembershipStatus.SUSPENDED } }),
    ]);

    // ── New signups (last 7 days) ──
    const newSignups7d = await prisma.clientMembership.count({
      where: {
        status: { in: [MembershipStatus.ACTIVE, MembershipStatus.PAST_DUE] },
        createdAt: { gte: weekAgo },
      },
    });

    // ── Monthly Revenue (MRR) ──
    const activeWithPlans = await prisma.clientMembership.findMany({
      where: { status: MembershipStatus.ACTIVE },
      include: { plan: { select: { priceCents: true, billingCycle: true } } },
    });
    const mrr = activeWithPlans.reduce((sum, m) => {
      const monthly = m.plan.billingCycle === 'ANNUAL'
        ? m.plan.priceCents / 12
        : m.plan.priceCents;
      return sum + monthly;
    }, 0);

    // ── Revenue collected last 30 days vs previous 30 ──
    const [revenueThisMonth, revenuePrevMonth] = await Promise.all([
      prisma.payment.aggregate({
        _sum: { amountCents: true },
        where: { status: PaymentStatus.SUCCEEDED, createdAt: { gte: thirtyDaysAgo } },
      }),
      prisma.payment.aggregate({
        _sum: { amountCents: true },
        where: {
          status: PaymentStatus.SUCCEEDED,
          createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
        },
      }),
    ]);
    const rev30d = revenueThisMonth._sum.amountCents || 0;
    const revPrev30d = revenuePrevMonth._sum.amountCents || 0;
    const revenueChange = revPrev30d > 0
      ? Math.round(((rev30d - revPrev30d) / revPrev30d) * 1000) / 10
      : 0;

    // ── Weekly booking trend (last 7 days, bookings per day) ──
    const weeklyBookings = await prisma.booking.findMany({
      where: {
        status: { in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED] },
        session: { startTime: { gte: weekAgo } },
      },
      include: { session: { select: { startTime: true } } },
    });

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const bookingsByDay: { date: string; day: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(todayStart);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const count = weeklyBookings.filter((b) => {
        const bDate = b.session.startTime.toISOString().slice(0, 10);
        return bDate === dateStr;
      }).length;
      bookingsByDay.push({ date: dateStr, day: dayNames[d.getDay()], count });
    }

    // ── At-Risk Members (active but no booking in 7+ days) ──
    const activeMembers = await prisma.clientMembership.findMany({
      where: { status: MembershipStatus.ACTIVE },
      include: {
        client: {
          select: {
            id: true,
            fullName: true,
            email: true,
            bookings: {
              where: { status: { in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED] } },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: {
                createdAt: true,
                session: { select: { startTime: true } },
              },
            },
          },
        },
        plan: { select: { name: true } },
      },
    });

    const atRiskMembers = activeMembers
      .filter((m) => {
        if (m.client.bookings.length === 0) return true;
        const lastBookingSession = m.client.bookings[0].session.startTime;
        return lastBookingSession < weekAgo;
      })
      .map((m) => ({
        clientId: m.client.id,
        name: m.client.fullName,
        plan: m.plan.name,
        lastBooking: m.client.bookings[0]?.session.startTime.toISOString() || null,
        daysSinceLastBooking: m.client.bookings.length > 0
          ? Math.floor((now.getTime() - m.client.bookings[0].session.startTime.getTime()) / (1000 * 60 * 60 * 24))
          : null,
      }))
      .sort((a, b) => (b.daysSinceLastBooking ?? 999) - (a.daysSinceLastBooking ?? 999))
      .slice(0, 10);

    // ── Pending Actions ──
    const [pendingCancelRequests, pendingCardChanges] = await Promise.all([
      prisma.clientMembership.count({
        where: { cancelRequestedAt: { not: null }, status: MembershipStatus.ACTIVE },
      }),
      prisma.cardChangeRequest.count({ where: { status: 'PENDING' } }),
    ]);

    // ── Recent Activity (last 10 events) ──
    const recentActivity = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        action: true,
        resourceType: true,
        resourceId: true,
        user: { select: { fullName: true } },
        createdAt: true,
      },
    });

    // ── Utilization Rate (this week) ──
    const weekSessions = await prisma.session.findMany({
      where: { startTime: { gte: weekAgo } },
      include: {
        _count: {
          select: { bookings: { where: { status: { in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED] } } } },
        },
      },
    });
    const weekCapacity = weekSessions.reduce((sum, s) => sum + s.maxCapacity, 0);
    const weekBooked = weekSessions.reduce((sum, s) => sum + s._count.bookings, 0);
    const utilizationRate = weekCapacity > 0 ? Math.round((weekBooked / weekCapacity) * 1000) / 10 : 0;

    res.json({
      success: true,
      data: {
        // Today
        today: {
          sessions: todaySessionsSummary,
          totalSessions: todaySessions.length,
          totalBookings: totalBookingsToday,
          totalCheckedIn: totalCheckedInToday,
        },
        // Membership
        membership: {
          active: activeMemberships,
          pastDue: pastDueMemberships,
          suspended: suspendedMemberships,
          newSignups7d,
        },
        // Revenue
        revenue: {
          mrr,
          collected30d: rev30d,
          revenueChange,
        },
        // Trends
        weeklyBookingTrend: bookingsByDay,
        utilizationRate,
        // At-Risk
        atRiskMembers,
        // Actions
        pendingActions: {
          pastDue: pastDueMemberships,
          cancelRequests: pendingCancelRequests,
          cardChanges: pendingCardChanges,
          total: pastDueMemberships + pendingCancelRequests + pendingCardChanges,
        },
        // Activity
        recentActivity: recentActivity.map((a) => ({
          id: a.id,
          action: a.action,
          resourceType: a.resourceType,
          resourceId: a.resourceId,
          userName: a.user?.fullName || 'System',
          createdAt: a.createdAt.toISOString(),
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================
// CRM — LEAD-SOURCE ROI
// ============================================================
//
// One row per LeadSource: total leads in period, how many converted to
// CLOSED_WON, conversion rate, average days from creation → conversion,
// and (when revenue data is wired) lifetime value of converted leads.
// Powers the "which channel actually pays off" question.
//
router.get('/lead-source-roi', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = (req.query.period as string) || '30d';
    const periodDays = period === '7d' ? 7 : period === '90d' ? 90 : period === '1y' ? 365 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodDays);

    const leads = await prisma.lead.findMany({
      where: { organizationId: 'ppl', createdAt: { gte: startDate } },
      select: {
        id: true,
        source: true,
        stage: true,
        createdAt: true,
        convertedAt: true,
        convertedToUserId: true,
      },
    });

    type Agg = {
      source: string;
      total: number;
      converted: number;
      lost: number;
      inProgress: number;
      sumConvertDays: number;
      countConvertDays: number;
    };
    const map = new Map<string, Agg>();
    for (const l of leads) {
      let a = map.get(l.source);
      if (!a) {
        a = {
          source: l.source,
          total: 0,
          converted: 0,
          lost: 0,
          inProgress: 0,
          sumConvertDays: 0,
          countConvertDays: 0,
        };
        map.set(l.source, a);
      }
      a.total++;
      if (l.stage === 'CLOSED_WON') {
        a.converted++;
        if (l.convertedAt) {
          const days = (l.convertedAt.getTime() - l.createdAt.getTime()) / (24 * 60 * 60 * 1000);
          a.sumConvertDays += days;
          a.countConvertDays++;
        }
      } else if (l.stage === 'CLOSED_LOST') {
        a.lost++;
      } else {
        a.inProgress++;
      }
    }

    const rows = Array.from(map.values())
      .map((a) => ({
        source: a.source,
        total: a.total,
        converted: a.converted,
        lost: a.lost,
        inProgress: a.inProgress,
        conversionRate: a.total > 0 ? a.converted / a.total : 0,
        avgDaysToConvert:
          a.countConvertDays > 0 ? a.sumConvertDays / a.countConvertDays : null,
      }))
      .sort((a, b) => b.total - a.total);

    res.json({
      success: true,
      data: {
        period,
        periodDays,
        startDate: startDate.toISOString(),
        sources: rows,
        totals: {
          leads: leads.length,
          converted: rows.reduce((s, r) => s + r.converted, 0),
          lost: rows.reduce((s, r) => s + r.lost, 0),
          inProgress: rows.reduce((s, r) => s + r.inProgress, 0),
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// CRM — FUNNEL CONVERSION
// ============================================================
//
// Returns the count of leads currently at each PipelineStage and the
// "conversion rate from prior stage" — assumes a canonical forward-only
// progression NEW → CONTACTED → QUALIFIED → TRIAL_SCHEDULED →
// TRIAL_COMPLETED → PROPOSAL → CLOSED_WON. Closed-lost is reported
// separately as the "where leakage happens" tally.
//
const FORWARD_STAGES: string[] = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'TRIAL_SCHEDULED',
  'TRIAL_COMPLETED',
  'PROPOSAL',
  'CLOSED_WON',
];

router.get('/funnel-conversion', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = (req.query.period as string) || '90d';
    const periodDays = period === '7d' ? 7 : period === '30d' ? 30 : period === '1y' ? 365 : 90;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodDays);

    const leads = await prisma.lead.findMany({
      where: { organizationId: 'ppl', createdAt: { gte: startDate } },
      select: { stage: true },
    });

    // For each forward stage, count leads that have REACHED that stage or
    // beyond. Index in FORWARD_STAGES = depth.
    const counts: Record<string, number> = {};
    for (const s of FORWARD_STAGES) counts[s] = 0;
    counts['CLOSED_LOST'] = 0;

    for (const l of leads) {
      if (l.stage === 'CLOSED_LOST') {
        counts['CLOSED_LOST']++;
        continue;
      }
      const idx = FORWARD_STAGES.indexOf(l.stage);
      if (idx === -1) continue;
      // Bump every stage from index 0 → idx — a lead that's at TRIAL_COMPLETED
      // counts as having passed NEW, CONTACTED, QUALIFIED, TRIAL_SCHEDULED too.
      for (let i = 0; i <= idx; i++) counts[FORWARD_STAGES[i]]++;
    }

    const stages = FORWARD_STAGES.map((stage, i) => {
      const count = counts[stage];
      const prev = i > 0 ? counts[FORWARD_STAGES[i - 1]] : counts[FORWARD_STAGES[0]];
      const conversionFromPrev = i === 0 ? 1 : prev > 0 ? count / prev : 0;
      return { stage, count, conversionFromPrev };
    });

    res.json({
      success: true,
      data: {
        period,
        periodDays,
        startDate: startDate.toISOString(),
        stages,
        closedLost: counts['CLOSED_LOST'],
        totalLeads: leads.length,
        // Top-of-funnel → closed-won overall.
        overallConversion:
          counts['NEW'] > 0 ? counts['CLOSED_WON'] / counts['NEW'] : 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// COACH / STAFF PERFORMANCE REPORT
// ============================================================
//
// One row per coach/staff member with:
//   - sessionsLed     — total bookings on sessions where this user is the coach
//   - athletesCoached — distinct clients across those bookings
//   - completionRate  — completed / (completed + no_show)
//   - noShowRate      — no_show / (completed + no_show)
//   - last30Sessions  — sessions led in the last 30 days
//   - revenueAttributed — sum of bookings.creditsUsed * plan.pricePerSession
//
// Admins use this to spot top performers + flag retention concerns when
// a coach has a high no-show rate (athletes might be voting with their
// feet). Filters by ?period= and ?locationId=.
//
router.get('/staff-performance', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = (req.query.period as string) || '30d';
    const locationId = req.query.locationId as string | undefined;
    const periodDays = period === '7d' ? 7 : period === '90d' ? 90 : period === '1y' ? 365 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodDays);

    const last30Start = new Date();
    last30Start.setDate(last30Start.getDate() - 30);

    // Pull all sessions in the period that have a coach assigned, with
    // booking counts per status. Single query; we aggregate in memory.
    const sessions = await prisma.session.findMany({
      where: {
        coachId: { not: null },
        startTime: { gte: startDate },
        ...(locationId ? { locationId } : {}),
      },
      select: {
        id: true,
        coachId: true,
        startTime: true,
        coach: { select: { id: true, fullName: true, email: true } },
        bookings: {
          select: {
            clientId: true,
            status: true,
          },
        },
      },
    });

    type Agg = {
      coachId: string;
      coachName: string;
      coachEmail: string;
      sessionsLed: number;
      sessionsLast30: number;
      athletesCoached: Set<string>;
      confirmed: number;
      completed: number;
      noShow: number;
      cancelled: number;
    };
    const byCoach = new Map<string, Agg>();

    for (const s of sessions) {
      if (!s.coachId || !s.coach) continue;
      let agg = byCoach.get(s.coachId);
      if (!agg) {
        agg = {
          coachId: s.coachId,
          coachName: s.coach.fullName,
          coachEmail: s.coach.email,
          sessionsLed: 0,
          sessionsLast30: 0,
          athletesCoached: new Set(),
          confirmed: 0,
          completed: 0,
          noShow: 0,
          cancelled: 0,
        };
        byCoach.set(s.coachId, agg);
      }
      agg.sessionsLed++;
      if (s.startTime >= last30Start) agg.sessionsLast30++;
      for (const b of s.bookings) {
        agg.athletesCoached.add(b.clientId);
        if (b.status === BookingStatus.CONFIRMED) agg.confirmed++;
        else if (b.status === BookingStatus.COMPLETED) agg.completed++;
        else if (b.status === BookingStatus.NO_SHOW) agg.noShow++;
        else if (b.status === BookingStatus.CANCELLED) agg.cancelled++;
      }
    }

    const rows = Array.from(byCoach.values())
      .map((a) => {
        const attendedDenominator = a.completed + a.noShow;
        const completionRate = attendedDenominator > 0 ? a.completed / attendedDenominator : null;
        const noShowRate = attendedDenominator > 0 ? a.noShow / attendedDenominator : null;
        return {
          coachId: a.coachId,
          coachName: a.coachName,
          coachEmail: a.coachEmail,
          sessionsLed: a.sessionsLed,
          sessionsLast30: a.sessionsLast30,
          athletesCoached: a.athletesCoached.size,
          confirmed: a.confirmed,
          completed: a.completed,
          noShow: a.noShow,
          cancelled: a.cancelled,
          completionRate, // 0..1 or null when no completed/no-show data yet
          noShowRate,
        };
      })
      .sort((a, b) => b.sessionsLed - a.sessionsLed);

    res.json({
      success: true,
      data: {
        period,
        periodDays,
        startDate: startDate.toISOString(),
        coaches: rows,
        totals: {
          coaches: rows.length,
          sessionsLed: rows.reduce((sum, r) => sum + r.sessionsLed, 0),
          athletesCoached: new Set(
            sessions.flatMap((s) => s.bookings.map((b) => b.clientId))
          ).size,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
