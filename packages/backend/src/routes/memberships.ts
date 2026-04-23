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
  getOrCreateStripePrice,
  stripe,
} from '../services/stripeService';
import { config } from '../config';
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
 * GET /api/memberships/config-health
 * Admin-only: report whether the critical billing integrations are configured
 * in the currently-running server. Reveals presence + basic shape ONLY — never
 * the secret values themselves. Use this to confirm Stripe/SMTP/Twilio env
 * vars landed on the server after a deploy.
 */
router.get(
  '/config-health',
  authenticate,
  requireAdmin,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const k = config.stripe.secretKey;
      const w = config.stripe.webhookSecret;
      const stripeMode = !k
        ? 'missing'
        : k.startsWith('sk_live')
        ? 'live'
        : k.startsWith('sk_test')
        ? 'test'
        : 'unknown';

      let stripeConnectionOk: boolean | null = null;
      let stripeConnectionError: string | null = null;
      if (k) {
        try {
          await stripe.accounts.retrieve();
          stripeConnectionOk = true;
        } catch (err: any) {
          stripeConnectionOk = false;
          stripeConnectionError = err?.message || 'unknown error';
        }
      }

      // We store the Stripe Price against the plan via Stripe metadata
      // (ppl_plan_id), not a column on MembershipPlan. Query Stripe to find
      // how many active plans are already wired. If Stripe can't connect,
      // we report "unknown" rather than fail the whole health check.
      const plansList = await prisma.membershipPlan.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
      });

      let plansMissingStripe: number | null = null;
      if (stripeConnectionOk) {
        try {
          let missing = 0;
          for (const p of plansList) {
            const found = await stripe.prices.search({
              query: `metadata["ppl_plan_id"]:"${p.id}" active:"true"`,
            });
            if (found.data.length === 0) missing++;
          }
          plansMissingStripe = missing;
        } catch {
          plansMissingStripe = null;
        }
      }

      res.json({
        success: true,
        data: {
          nodeEnv: config.nodeEnv,
          stripe: {
            mode: stripeMode,
            webhookSecretSet: !!w && w !== 'whsec_placeholder',
            connectionOk: stripeConnectionOk,
            connectionError: stripeConnectionError,
          },
          smtp: {
            hostSet: !!config.smtp.host,
            userSet: !!config.smtp.user,
            passSet: !!config.smtp.pass,
            fromSet: !!config.smtp.from,
          },
          twilio: {
            accountSidSet: !!config.twilio.accountSid,
            authTokenSet: !!config.twilio.authToken,
            phoneNumberSet: !!config.twilio.phoneNumber,
          },
          plans: {
            active: plansList.length,
            activeMissingStripePrice: plansMissingStripe,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/memberships/sync-stripe-prices
 * Admin-only: for every active plan without a stripePriceId, create (or find)
 * the matching Stripe product + weekly recurring price and write the price ID
 * back to the database. Safe to re-run — skips plans that already have a price
 * ID, and Stripe-side we search by metadata before creating to avoid duplicates.
 */
router.post(
  '/sync-stripe-prices',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!config.stripe.secretKey) {
        throw ApiError.badRequest(
          'STRIPE_SECRET_KEY is not set on the backend. Add it to the Railway/Render env before syncing.'
        );
      }

      const syncPlans = await prisma.membershipPlan.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
      });

      const syncResults: Array<{
        plan: string;
        action: 'existed' | 'created' | 'updated' | 'failed';
        stripePriceId?: string;
        error?: string;
      }> = [];

      for (const plan of syncPlans) {
        try {
          // Look up any existing active Stripe price for this plan.
          const existing = await stripe.prices.search({
            query: `metadata["ppl_plan_id"]:"${plan.id}" active:"true"`,
          });

          if (existing.data.length > 0) {
            const current = existing.data[0];
            const expectedInterval: 'week' | 'month' =
              plan.billingCycle === 'monthly' ? 'month' : 'week';

            // Stripe prices are IMMUTABLE — the amount and recurring interval
            // can't be edited on an existing price. If either has drifted from
            // what the plan says today, archive the old price and create a new
            // one. This is what lets Chad change a price in seed.ts + redeploy
            // and have Stripe stay in sync without manual cleanup.
            const priceMatches =
              current.unit_amount === plan.priceCents &&
              current.recurring?.interval === expectedInterval;

            if (priceMatches) {
              syncResults.push({
                plan: plan.name,
                action: 'existed',
                stripePriceId: current.id,
              });
              continue;
            }

            // Archive stale price, then fall through to create a fresh one.
            await stripe.prices.update(current.id, { active: false });
            const newPriceId = await getOrCreateStripePrice(plan.id);
            syncResults.push({
              plan: plan.name,
              action: 'updated',
              stripePriceId: newPriceId,
            });
            continue;
          }

          const priceId = await getOrCreateStripePrice(plan.id);
          syncResults.push({
            plan: plan.name,
            action: 'created',
            stripePriceId: priceId,
          });
        } catch (err: any) {
          syncResults.push({
            plan: plan.name,
            action: 'failed',
            error: err?.message || 'unknown error',
          });
        }
      }

      await createAuditLog({
        action: 'STRIPE_PRICES_SYNCED',
        userId: req.user!.userId,
        resourceType: 'MembershipPlan',
        resourceId: 'all',
        changes: {
          summary: syncResults
            .map(
              (r) =>
                `${r.plan}: ${r.action}${r.stripePriceId ? ` (${r.stripePriceId})` : ''}${r.error ? ` — ${r.error}` : ''}`
            )
            .join('; '),
        },
      });

      const createdCount = syncResults.filter((r) => r.action === 'created').length;
      const updatedCount = syncResults.filter((r) => r.action === 'updated').length;
      const failedCount = syncResults.filter((r) => r.action === 'failed').length;
      const existedCount = syncResults.filter((r) => r.action === 'existed').length;

      res.json({
        success: failedCount === 0,
        data: syncResults,
        message:
          failedCount > 0
            ? `Synced: ${createdCount} created, ${updatedCount} price-updated, ${existedCount} already current, ${failedCount} failed. See data for details.`
            : `All ${syncPlans.length} active plans synced (${createdCount} new, ${updatedCount} updated, ${existedCount} already current).`,
      });
    } catch (error) {
      next(error);
    }
  }
);

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

    // Get the client's home location fresh from the database — NOT from the
    // JWT. The JWT is minted at registration step 2 when homeLocationId is
    // still null (step 4 is where they pick a location). Trusting the JWT
    // here caused every new-user subscription to 400 with "you need a home
    // location". See audit issue #1.
    const clientUser = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { homeLocationId: true },
    });
    const homeLocationId = clientUser?.homeLocationId;
    if (!homeLocationId) {
      throw ApiError.badRequest('Please pick a training location before subscribing.');
    }

    // Gate: onboarding fee must be paid / waived / not-applicable before we
    // let them subscribe. Prevents a failed-onboarding user from becoming an
    // active member. See audit issue #8.
    const athleteProfile = await prisma.athleteProfile.findUnique({
      where: { userId: user.userId },
      include: { onboardingRecord: true },
    });
    // Cast to string — the locally-cached Prisma types in /sessions can be
    // stale against the live schema. Railway regenerates on every deploy so
    // production sees the full enum (REQUIRED, PROCESSING, PAID, WAIVED,
    // NOT_APPLICABLE). This comparison is safe at runtime.
    const feeStatus = athleteProfile?.onboardingRecord?.feeStatus as
      | string
      | undefined;
    if (feeStatus === 'REQUIRED' || feeStatus === 'PROCESSING') {
      throw ApiError.badRequest(
        'Please complete your one-time onboarding fee before starting a membership.'
      );
    }

    // Create the Stripe subscription
    const result = await createSubscription({
      userId: user.userId,
      planId,
      locationId: homeLocationId,
    });

    await createAuditLog({
      userId: user.userId,
      locationId: homeLocationId,
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

      // Block cancellation for PAST_DUE members — must resolve payment first
      if (membership.status === MembershipStatus.PAST_DUE) {
        throw ApiError.forbidden(
          'You cannot cancel while your payment is past due. Please update your payment method first. If you need help, use the "Message Us" button to reach our team.'
        );
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
 * Admin: list all past-due memberships with failure details.
 * Includes consecutive failures count and how many training weeks it's been going on.
 */
router.get(
  '/past-due',
  authenticate,
  requireAdmin,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { getFailedPaymentsDashboard } = await import('../services/paymentRetryService');
      const pastDue = await getFailedPaymentsDashboard();
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
