import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate, requireStaffOrAdmin } from '../middleware/auth';
import { Role, GoalType, GoalStatus } from '@prisma/client';

const router = Router();

function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

/**
 * POST /api/goals
 * Create a goal for an athlete (coach-set or self-set)
 */
router.post('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const { athleteId, type, title, description, targetDate } = req.body;

    if (!title) throw ApiError.badRequest('Goal title is required');
    if (!type || !Object.values(GoalType).includes(type)) {
      throw ApiError.badRequest('Goal type must be SHORT_TERM or LONG_TERM');
    }

    // Determine the athlete: if CLIENT, it's self-set. If STAFF/ADMIN, they must specify.
    let resolvedAthleteId: string;
    let coachId: string | null = null;

    if (user.role === Role.CLIENT) {
      resolvedAthleteId = user.userId;
    } else {
      if (!athleteId) throw ApiError.badRequest('Athlete ID is required when creating goals as a coach');
      resolvedAthleteId = athleteId;
      coachId = user.userId;

      // Location-scope IDOR defense: STAFF can only write goals for
      // athletes at locations they're assigned to. ADMIN bypasses.
      if (user.role === Role.STAFF) {
        const athlete = await prisma.user.findUnique({
          where: { id: resolvedAthleteId },
          select: { role: true, homeLocationId: true },
        });
        if (!athlete || athlete.role !== Role.CLIENT) {
          throw ApiError.notFound('Athlete not found');
        }
        if (athlete.homeLocationId) {
          const assignment = await prisma.staffLocation.findUnique({
            where: {
              staffId_locationId: { staffId: user.userId, locationId: athlete.homeLocationId },
            },
          });
          if (!assignment) {
            throw ApiError.forbidden(
              'You can only create goals for athletes at locations you are assigned to.'
            );
          }
        }
      }
    }

    // Cap inputs to prevent abuse.
    if (title && title.length > 200) throw ApiError.badRequest('Title too long (max 200 chars)');
    if (description && description.length > 2000) throw ApiError.badRequest('Description too long (max 2000 chars)');

    const goal = await prisma.goal.create({
      data: {
        athleteId: resolvedAthleteId,
        coachId,
        type,
        title: title.trim(),
        description: description?.trim() || null,
        targetDate: targetDate ? new Date(targetDate) : null,
      },
      include: {
        athlete: { select: { id: true, fullName: true } },
        coach: { select: { id: true, fullName: true } },
      },
    });

    res.status(201).json({ data: goal });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/goals/my
 * Self-managed athlete view of their own goals. Uses req.user.userId
 * as the athleteId so the athlete dashboard widget doesn't need to know
 * its own ID.
 */
router.get('/my', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const { status, type } = req.query;
    const where: Record<string, unknown> = { athleteId: user.userId };
    if (status) where.status = status as string;
    if (type) where.type = type as string;

    const goals = await prisma.goal.findMany({
      where,
      include: {
        coach: { select: { id: true, fullName: true } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });

    res.json({ data: goals });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/goals/athlete/:athleteId
 * Get all goals for an athlete
 */
router.get('/athlete/:athleteId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const athleteId = param(req, 'athleteId');

    if (user.role === Role.CLIENT && user.userId !== athleteId) {
      throw ApiError.forbidden('You can only view your own goals');
    }

    const { status, type } = req.query;
    const where: Record<string, unknown> = { athleteId };
    if (status) where.status = status as string;
    if (type) where.type = type as string;

    const goals = await prisma.goal.findMany({
      where,
      include: {
        coach: { select: { id: true, fullName: true } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });

    res.json({ data: goals });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/goals/:goalId
 * Update a goal (progress, status, details)
 */
router.put('/:goalId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const goalId = param(req, 'goalId');
    const { title, description, targetDate, progress, status } = req.body;

    const existing = await prisma.goal.findUnique({ where: { id: goalId } });
    if (!existing) throw ApiError.notFound('Goal not found');

    // Clients can only update their own goals
    if (user.role === Role.CLIENT && existing.athleteId !== user.userId) {
      throw ApiError.forbidden('You can only update your own goals');
    }

    const updateData: Record<string, unknown> = {};
    if (title !== undefined) updateData.title = title.trim();
    if (description !== undefined) updateData.description = description?.trim() || null;
    if (targetDate !== undefined) updateData.targetDate = targetDate ? new Date(targetDate) : null;
    if (progress !== undefined) updateData.progress = Math.min(100, Math.max(0, progress));
    if (status && Object.values(GoalStatus).includes(status)) {
      updateData.status = status;
      if (status === 'COMPLETED') updateData.completedAt = new Date();
    }

    const goal = await prisma.goal.update({
      where: { id: goalId },
      data: updateData,
      include: {
        athlete: { select: { id: true, fullName: true } },
        coach: { select: { id: true, fullName: true } },
      },
    });

    res.json({ data: goal });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/goals/:goalId
 * Delete a goal (admin/coach or the athlete who owns it)
 */
router.delete('/:goalId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const goalId = param(req, 'goalId');

    const existing = await prisma.goal.findUnique({ where: { id: goalId } });
    if (!existing) throw ApiError.notFound('Goal not found');

    if (user.role === Role.CLIENT && existing.athleteId !== user.userId) {
      throw ApiError.forbidden('You can only delete your own goals');
    }

    await prisma.goal.delete({ where: { id: goalId } });
    res.json({ message: 'Goal deleted' });
  } catch (err) {
    next(err);
  }
});

export default router;
