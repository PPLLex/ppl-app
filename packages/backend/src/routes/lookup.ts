/**
 * Lightweight lookup endpoints (#P14 / PREMIUM_AUDIT).
 *
 * Powers hover-preview popovers across the admin UI. Each endpoint
 * returns a small, fixed-shape payload optimized for popover rendering
 * (name, score, last activity, tag count). NO heavy joins — these
 * fire on every hover, latency matters.
 *
 *   GET /api/lookup/lead/:id    — admin/staff
 *   GET /api/lookup/user/:id    — admin/staff
 *
 * Returns 404 if the resource is missing OR the caller can't see it.
 * Always cached for 30 seconds via Cache-Control to absorb rapid
 * repeated hovers from the same user without hitting Postgres.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate, requireStaffOrAdmin } from '../middleware/auth';

const router = Router();

router.use(authenticate, requireStaffOrAdmin);

const param = (req: Request, key: string): string =>
  Array.isArray(req.params[key]) ? (req.params[key] as string[])[0] : (req.params[key] as string);

router.get('/lead/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const lead = await prisma.lead.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        stage: true,
        source: true,
        score: true,
        nextFollowUpAt: true,
        lastActivityAt: true,
        owner: { select: { id: true, fullName: true } },
        _count: { select: { activities: true, tags: true } },
      },
    });
    if (!lead) throw ApiError.notFound('Lead not found');

    res.set('Cache-Control', 'private, max-age=30');
    res.json({
      success: true,
      data: {
        kind: 'lead' as const,
        id: lead.id,
        name: `${lead.firstName} ${lead.lastName}`,
        email: lead.email,
        phone: lead.phone,
        stage: lead.stage,
        source: lead.source,
        score: lead.score,
        nextFollowUpAt: lead.nextFollowUpAt,
        lastActivityAt: lead.lastActivityAt,
        ownerName: lead.owner?.fullName ?? null,
        activityCount: lead._count.activities,
        tagCount: lead._count.tags,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/user/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        churnRiskScore: true,
        avatarUrl: true,
        homeLocation: { select: { id: true, name: true } },
        clientProfile: { select: { ageGroup: true } },
        clientMemberships: {
          where: { status: { in: ['ACTIVE', 'PAST_DUE', 'PAUSED'] } },
          select: {
            status: true,
            plan: { select: { name: true, priceCents: true, billingCycle: true } },
          },
          take: 1,
        },
        _count: { select: { bookings: true } },
      },
    });
    if (!user) throw ApiError.notFound('User not found');

    res.set('Cache-Control', 'private, max-age=30');
    res.json({
      success: true,
      data: {
        kind: 'user' as const,
        id: user.id,
        name: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isActive: user.isActive,
        churnRiskScore: user.churnRiskScore,
        avatarUrl: user.avatarUrl,
        homeLocationName: user.homeLocation?.name ?? null,
        ageGroup: user.clientProfile?.ageGroup ?? null,
        membership: user.clientMemberships[0]
          ? {
              status: user.clientMemberships[0].status,
              planName: user.clientMemberships[0].plan.name,
              priceCents: user.clientMemberships[0].plan.priceCents,
            }
          : null,
        bookingCount: user._count.bookings,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
