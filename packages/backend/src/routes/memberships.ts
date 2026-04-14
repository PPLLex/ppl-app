import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate, requireAdmin, requireStaffOrAdmin } from '../middleware/auth';
import { createAuditLog } from '../services/auditService';
import { notify } from '../services/notificationService';
import {
  createSubscription,
  cancelSubscription,
  createCardUpdateSession,
  retryPayment,
} from '../services/stripeService';
import {
  Role,
  MembershipStatus,
  NotificationType,
  NotificationChannel,
  CardChangeRequestStatus,
  Prisma,
} from '@prisma/client';
import { randomBytes } from 'crypto';

const router = Router();

function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

// ============================================================
// MEMBERSHIP PLANS (Public)
// ============================================================

/**
 * GET /api/memberships/plans
 * List all active membership plans. Public for registration flow.
 */
router.get('/plans', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // If admin (via optional auth), show all plans including inactive
    const showAll = req.query.all === 'true';
    const plans = await prisma.membershipPlan.findMany({
      where: showAll ? {} : { isActive: true },
      orderBy: [{ ageGroup: 'asc' }, { priceCents: 'desc' }],
    });

    res.json({ success: true, data: plans });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/memberships/plans/:id
 * Get a single plan by ID.
 */
router.get('/plans/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const planId = param(req, 'id');
    const plan = await prisma.membershipPlan.findUnique({ where: { id: planId } });
    if (!plan) throw ApiError.notFound('Plan not found');
    res.json({ success: true, data: plan });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/memberships/plans
 * Admin: create a new membership plan.
 */
router.post('/plans', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, slug, ageGroup, sessionsPerWeek, priceCents, billingCycle, description, isActive } = req.body;
    if (!name || priceCents === undefined) throw ApiError.badRequest('Name and price are required');

    const plan = await prisma.membershipPlan.create({
      data: {
        name,
        slug: slug || name.toLowerCase().replace(/\s+/g, '-'),
        ageGroup: ageGroup || 'college',
        sessionsPerWeek: sessionsPerWeek ?? null,
        priceCents: parseInt(priceCents),
        billingCycle: billingCycle || 'WEEKLY',
        description: description || null,
        isActive: isActive !== false,
      },
    });

    await createAuditLog({
      action: 'PLAN_CREATED',
      userId: req.user!.userId,
      resourceType: 'MembershipPlan',
      resourceId: plan.id,
      changes: { name, priceCents },
    });

    res.status(201).json({ success: true, data: plan });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/memberships/plans/:id
 * Admin: update a membership plan.
 */
router.put('/plans/:id', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const planId = param(req, 'id');
    const { name, slug, ageGroup, sessionsPerWeek, priceCents, billingCycle, description, isActive } = req.body;

    const existing = await prisma.membershipPlan.findUnique({ where: { id: planId } });
    if (!existing) throw ApiError.notFound('Plan not found');

    const plan = await prisma.membershipPlan.update({
      where: { id: planId },
      data: {
        ...(name !== undefined && { name }),
        ...(slug !== undefined && { slug }),
        ...(ageGroup !== undefined && { ageGroup }),
        ...(sessionsPerWeek !== undefined && { sessionsPerWeek }),
        ...(priceCents !== undefined && { priceCents: parseInt(priceCents) }),
        ...(billingCycle !== undefined && { billingCycle }),
        ...(description !== undefined && { description }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    await createAuditLog({
      action: 'PLAN_UPDATED',
      userId: req.user!.userId,
      resourceType: 'MembershipPlan',
      resourceId: plan.id,
      changes: req.body,
    });

    res.json({ success: true, data: plan });
  } catch (error) {
    next(error);
  }
});

// ============================================================
// CLIENT MEMBERSHIP (Authenticated)
// ============================================================

/**
 * GET /api/memberships/my
 * Client: get my current membership status, plan, credits.
 */
router.get('/my', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;

    const membership = await prisma.clientMembership.findFirst({
      where: {
        clientId: user.userId,
        status: { in: [MembershipStatus.ACTIVE, MembershipStatus.PAST_DUE] },
      },
      include: {
        plan: true,
        location: { select: { id: true, name: true } },
      },
      orderBy: { startedAt: 'desc' },
    });

    if (!membership) {
      return res.json({
        success: true,
        data: null,
        message: 'No active membership found',
      });
    }

    // Get current week's credits if limited plan
    let credits = null;
    if (membership.plan.sessionsPerWeek !== null) {
      const now = new Date();
      const weekStart = getWeekStart(now, membership.billingDay);

      credits = await prisma.weeklyCredit.findFirst({
        where: {
          clientId: user.userId,
          membershipId: membership.id,
          weekStartDate: weekStart,
        },
      });

      // Create credit record if doesn't exist
      if (!credits) {
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 7);

        credits = await prisma.weeklyCredit.create({
          data: {
            clientId: user.userId,
            membershipId: membership.id,
            creditsTotal: membership.plan.sessionsPerWeek,
            creditsUsed: 0,
            weekStartDate: weekStart,
            weekEndDate: weekEnd,
          },
        });
      }
    }

    // Get recent payments
    const recentPayments = await prisma.payment.findMany({
      where: { clientId: user.userId, membershipId: membership.id },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    res.json({
      success: true,
      data: {
        membership,
        credits: credits
          ? {
              total: credits.creditsTotal,
              used: credits.creditsUsed,
              remaining: credits.creditsTotal - credits.creditsUsed,
              weekStart: credits.weekStartDate,
              weekEnd: credits.weekEndDate,
            }
          : null,
        recentPayments,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/memberships/subscribe
 * Client: start a new membership. Returns Stripe client_secret for payment.
 */
router.post('/subscribe', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const { planId } = req.body;

    if (!planId) throw ApiError.badRequest('Plan ID is required');

    // Check if client already has an active membership
    const existingMembership = await prisma.clientMembership.findFirst({
      where: {
        clientId: user.userId,
        status: { in: [MembershipStatus.ACTIVE, MembershipStatus.PAST_DUE] },
      },
    });

    if (existingMembership) {
      throw ApiError.conflict(
        'You already have an active membership. Please contact an admin if you want to change your plan.'
      );
    }

    // Verify the plan exists
    const plan = await prisma.membershipPlan.findUnique({ where: { id: planId } });
    if (!plan || !plan.isActive) {
      throw ApiError.notFound('Membership plan not found or is no longer available');
    }

    // Get client's home location
    if (!user.homeLocationId) {
      throw ApiError.badRequest('You need a home location to subscribe. Please update your profile.');
    }

    // Create the Stripe subscription
    const result = await createSubscription({
      userId: user.userId,
      planId,
      locationId: user.homeLocationId,
    });

    await createAuditLog({
      userId: user.userId,
      locationId: user.homeLocationId,
      action: 'membership.subscribed',
      resourceType: 'membership',
      resourceId: result.subscriptionId,
      changes: {
        planId,
        planName: plan.name,
        priceCents: plan.priceCents,
        billingDay: result.billingDay,
      },
    });

    res.status(201).json({
      success: true,
      data: {
        subscriptionId: result.subscriptionId,
        clientSecret: result.clientSecret,
        billingDay: result.billingDay,
        billingAnchorDate: result.billingAnchorDate,
        plan,
      },
      message: `Complete payment to activate your ${plan.name} membership.`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/memberships/card-change-request
 * Client: request to update their payment card.
 * Admin must approve and send a secure link.
 */
router.post(
  '/card-change-request',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const { notes } = req.body;

      // Check for existing pending request
      const existing = await prisma.cardChangeRequest.findFirst({
        where: {
          clientId: user.userId,
          status: { in: [CardChangeRequestStatus.PENDING, CardChangeRequestStatus.LINK_SENT] },
        },
      });

      if (existing) {
        throw ApiError.conflict(
          'You already have a pending card change request. An admin will reach out shortly.'
        );
      }

      const request = await prisma.cardChangeRequest.create({
        data: {
          clientId: user.userId,
          notes: notes || null,
        },
      });

      // Notify all admins
      const admins = await prisma.user.findMany({
        where: { role: Role.ADMIN, isActive: true },
        select: { id: true },
      });

      const clientUser = await prisma.user.findUnique({
        where: { id: user.userId },
        select: { fullName: true, email: true },
      });

      for (const admin of admins) {
        await notify({
          userId: admin.id,
          type: NotificationType.MEMBERSHIP_STATUS_CHANGE,
          title: 'Card Change Request',
          body: `${clientUser?.fullName} (${clientUser?.email}) is requesting to update their payment card.${
            notes ? ` Note: ${notes}` : ''
          }`,
          channels: [NotificationChannel.EMAIL],
          metadata: { requestId: request.id, clientId: user.userId },
        });
      }

      await createAuditLog({
        userId: user.userId,
        action: 'membership.card_change_requested',
        resourceType: 'card_change_request',
        resourceId: request.id,
      });

      res.status(201).json({
        success: true,
        data: request,
        message: 'Your card change request has been submitted. An admin will send you a secure link to update your card.',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/memberships/cancel-request
 * Client: request to cancel membership (goes to admin for approval).
 */
router.post(
  '/cancel-request',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const { reason } = req.body;

      const membership = await prisma.clientMembership.findFirst({
        where: {
          clientId: user.userId,
          status: { in: [MembershipStatus.ACTIVE, MembershipStatus.PAST_DUE] },
        },
        include: { plan: true },
      });

      if (!membership) {
        throw ApiError.notFound('No active membership to cancel');
      }

      if (membership.cancelRequestedAt) {
        throw ApiError.conflict('You already have a pending cancellation request.');
      }

      // Mark the request
      await prisma.clientMembership.update({
        where: { id: membership.id },
        data: { cancelRequestedAt: new Date() },
      });

      // Notify admins
      const admins = await prisma.user.findMany({
        where: { role: Role.ADMIN, isActive: true },
        select: { id: true },
      });

      const clientUser = await prisma.user.findUnique({
        where: { id: user.userId },
        select: { fullName: true, email: true },
      });

      for (const admin of admins) {
        await notify({
          userId: admin.id,
          type: NotificationType.MEMBERSHIP_STATUS_CHANGE,
          title: 'Cancellation Request',
          body: `${clientUser?.fullName} (${clientUser?.email}) wants to cancel their ${membership.plan.name} membership.${
            reason ? ` Reason: ${reason}` : ''
          }`,
          channels: [NotificationChannel.EMAIL],
          metadata: { membershipId: membership.id, clientId: user.userId, reason },
        });
      }

      await createAuditLog({
        userId: user.userId,
        action: 'membership.cancel_requested',
        resourceType: 'membership',
        resourceId: membership.id,
        changes: { reason, planName: membership.plan.name },
      });

      res.json({
        success: true,
        message:
          'Your cancellation request has been submitted. An admin will review it and follow up with you.',
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================================
// ADMIN MEMBERSHIP MANAGEMENT
// ============================================================

/**
 * GET /api/memberships
 * Admin: list all memberships with filters.
 */
router.get('/', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, locationId, page = '1', limit = '50' } = req.query;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (locationId) where.locationId = locationId;

    const pageNum = parseInt(page as string) || 1;
    const limitNum = parseInt(limit as string) || 50;
    const skip = (pageNum - 1) * limitNum;

    const [memberships, total] = await Promise.all([
      prisma.clientMembership.findMany({
        where: where as any,
        include: {
          client: { select: { id: true, fullName: true, email: true, phone: true } },
          plan: true,
          location: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.clientMembership.count({ where: where as any }),
    ]);

    res.json({
      success: true,
      data: memberships,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/memberships/past-due
 * Admin: list all past-due memberships.
 */
router.get(
  '/past-due',
  authenticate,
  requireAdmin,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const pastDue = await prisma.clientMembership.findMany({
        where: { status: MembershipStatus.PAST_DUE },
        include: {
          client: { select: { id: true, fullName: true, email: true, phone: true } },
          plan: true,
          location: { select: { id: true, name: true } },
          payments: {
            where: { status: 'FAILED' },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { updatedAt: 'desc' },
      });

      res.json({ success: true, data: pastDue });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/memberships/cancel-requests
 * Admin: list all pending cancellation requests.
 */
router.get(
  '/cancel-requests',
  authenticate,
  requireAdmin,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const requests = await prisma.clientMembership.findMany({
        where: { cancelRequestedAt: { not: null }, status: MembershipStatus.ACTIVE },
        include: {
          client: { select: { id: true, fullName: true, email: true, phone: true } },
          plan: true,
          location: { select: { id: true, name: true } },
        },
        orderBy: { cancelRequestedAt: 'desc' },
      });

      res.json({ success: true, data: requests });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/memberships/:id/cancel
 * Admin: approve and execute a membership cancellation.
 */
router.post(
  '/:id/cancel',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const membershipId = param(req, 'id');
      const admin = req.user!;

      await cancelSubscription(membershipId);

      // Notify the client
      const membership = await prisma.clientMembership.findUnique({
        where: { id: membershipId },
        include: { plan: true },
      });

      if (membership) {
        await notify({
          userId: membership.clientId,
          type: NotificationType.MEMBERSHIP_STATUS_CHANGE,
          title: 'Membership Cancelled',
          body: `Your ${membership.plan.name} membership has been cancelled. You'll retain access until the end of your current billing period.`,
          channels: [NotificationChannel.EMAIL, NotificationChannel.SMS],
          metadata: { membershipId },
        });
      }

      await createAuditLog({
        userId: admin.userId,
        action: 'membership.cancelled_by_admin',
        resourceType: 'membership',
        resourceId: membershipId,
        changes: {
          clientId: membership?.clientId,
          planName: membership?.plan.name,
        },
      });

      res.json({
        success: true,
        message: 'Membership has been cancelled. Client will retain access until the end of their billing period.',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/memberships/:id/retry-payment
 * Admin: manually retry a failed payment.
 */
router.post(
  '/:id/retry-payment',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const membershipId = param(req, 'id');
      const success = await retryPayment(membershipId);

      if (success) {
        res.json({ success: true, message: 'Payment retry succeeded.' });
      } else {
        res.json({ success: false, message: 'Payment retry failed or no open invoice found.' });
      }
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/memberships/card-change-requests
 * Admin: list all card change requests.
 */
router.get(
  '/card-change-requests',
  authenticate,
  requireAdmin,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const requests = await prisma.cardChangeRequest.findMany({
        where: { status: { in: [CardChangeRequestStatus.PENDING, CardChangeRequestStatus.LINK_SENT] } },
        include: {
          client: { select: { id: true, fullName: true, email: true, phone: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({ success: true, data: requests });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/memberships/card-change-requests/:id/send-link
 * Admin: send a secure Stripe Billing Portal link to the client.
 */
router.post(
  '/card-change-requests/:id/send-link',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requestId = param(req, 'id');
      const admin = req.user!;

      const request = await prisma.cardChangeRequest.findUnique({
        where: { id: requestId },
        include: { client: { select: { id: true, fullName: true, email: true } } },
      });

      if (!request) throw ApiError.notFound('Card change request not found');

      // Generate secure link via Stripe Billing Portal
      const portalUrl = await createCardUpdateSession(request.clientId);

      // Generate a secure token for tracking
      const token = randomBytes(32).toString('hex');
      const expiry = new Date();
      expiry.setHours(expiry.getHours() + 24);

      await prisma.cardChangeRequest.update({
        where: { id: requestId },
        data: {
          status: CardChangeRequestStatus.LINK_SENT,
          adminId: admin.userId,
          secureLinkToken: token,
          secureLinkExpiry: expiry,
        },
      });

      // Notify client with the portal link
      await notify({
        userId: request.clientId,
        type: NotificationType.MEMBERSHIP_STATUS_CHANGE,
        title: 'Update Your Payment Card',
        body: `Here's your secure link to update your payment card: ${portalUrl}\n\nThis link expires in 24 hours.`,
        channels: [NotificationChannel.EMAIL, NotificationChannel.SMS],
        metadata: { requestId, portalUrl },
      });

      await createAuditLog({
        userId: admin.userId,
        action: 'membership.card_update_link_sent',
        resourceType: 'card_change_request',
        resourceId: requestId,
        changes: { clientId: request.clientId, clientEmail: request.client.email },
      });

      res.json({
        success: true,
        message: `Secure card update link sent to ${request.client.email}.`,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/memberships/stats
 * Admin: get billing statistics.
 */
router.get(
  '/stats',
  authenticate,
  requireAdmin,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [activeCount, pastDueCount, cancelledCount, totalRevenue, cancelRequests, cardRequests] =
        await Promise.all([
          prisma.clientMembership.count({ where: { status: MembershipStatus.ACTIVE } }),
          prisma.clientMembership.count({ where: { status: MembershipStatus.PAST_DUE } }),
          prisma.clientMembership.count({ where: { status: MembershipStatus.CANCELLED } }),
          prisma.payment.aggregate({
            where: { status: 'SUCCEEDED' },
            _sum: { amountCents: true },
          }),
          prisma.clientMembership.count({
            where: { cancelRequestedAt: { not: null }, status: MembershipStatus.ACTIVE },
          }),
          prisma.cardChangeRequest.count({
            where: { status: { in: [CardChangeRequestStatus.PENDING, CardChangeRequestStatus.LINK_SENT] } },
          }),
        ]);

      // Revenue by plan
      const revenueByPlan = await prisma.payment.groupBy({
        by: ['membershipId'],
        where: { status: 'SUCCEEDED', membershipId: { not: null } },
        _sum: { amountCents: true },
        _count: true,
      });

      res.json({
        success: true,
        data: {
          activeMemberships: activeCount,
          pastDueMemberships: pastDueCount,
          cancelledMemberships: cancelledCount,
          totalRevenueCents: totalRevenue._sum.amountCents || 0,
          pendingCancelRequests: cancelRequests,
          pendingCardChangeRequests: cardRequests,
          revenueByPlan,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================================
// ADMIN PLAN MANAGEMENT
// ============================================================

/**
 * POST /api/memberships/plans
 * Admin: create a new membership plan.
 */
router.post(
  '/plans',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, slug, ageGroup, sessionsPerWeek, priceCents, description } = req.body;

      if (!name || !slug || !ageGroup || priceCents === undefined) {
        throw ApiError.badRequest('Name, slug, ageGroup, and priceCents are required');
      }

      const plan = await prisma.membershipPlan.create({
        data: {
          name,
          slug,
          ageGroup,
          sessionsPerWeek: sessionsPerWeek ?? null,
          priceCents,
          description: description || null,
        },
      });

      res.status(201).json({ success: true, data: plan });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/memberships/plans/:id
 * Admin: update a membership plan.
 */
router.put(
  '/plans/:id',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const planId = param(req, 'id');
      const updates = req.body;

      const plan = await prisma.membershipPlan.update({
        where: { id: planId },
        data: updates,
      });

      res.json({ success: true, data: plan });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================================
// Helper
// ============================================================

function getWeekStart(date: Date, billingDay: string): Date {
  const d = new Date(date);
  const dayMap: Record<string, number> = { MONDAY: 1, THURSDAY: 4 };
  const targetDay = dayMap[billingDay] || 1;
  const currentDay = d.getDay();

  let diff = currentDay - targetDay;
  if (diff < 0) diff += 7;

  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default router;
