import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate, requireStaffOrAdmin } from '../middleware/auth';
import { Role, ProgramStatus } from '@prisma/client';

const router = Router();

function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

// ============================================================
// PROGRAMS â coach creates training programs for athletes
// ============================================================

/**
 * POST /api/programs
 * Staff/Admin: create a new training program for an athlete
 */
router.post('/', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const coachId = req.user!.userId;
    const coachRole = req.user!.role;
    const { athleteId, title, description, startDate, endDate } = req.body;

    if (!athleteId) throw ApiError.badRequest('Athlete ID is required');
    if (!title) throw ApiError.badRequest('Program title is required');
    if (title.length > 200) throw ApiError.badRequest('Title too long (max 200 chars)');
    if (description && description.length > 2000) throw ApiError.badRequest('Description too long (max 2000 chars)');

    // Verify athlete exists
    const athlete = await prisma.user.findUnique({
      where: { id: athleteId },
      select: { id: true, role: true, homeLocationId: true },
    });
    if (!athlete || athlete.role !== Role.CLIENT) {
      throw ApiError.notFound('Athlete not found');
    }

    // Location-scope IDOR defense: STAFF can only create programs for
    // athletes at locations they're assigned to. ADMIN bypasses.
    if (coachRole === Role.STAFF && athlete.homeLocationId) {
      const assignment = await prisma.staffLocation.findUnique({
        where: {
          staffId_locationId: { staffId: coachId, locationId: athlete.homeLocationId },
        },
      });
      if (!assignment) {
        throw ApiError.forbidden(
          'You can only create programs for athletes at locations you are assigned to.'
        );
      }
    }

    const program = await prisma.program.create({
      data: {
        coachId,
        athleteId,
        title: title.trim(),
        description: description?.trim() || null,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
      },
      include: {
        coach: { select: { id: true, fullName: true } },
        athlete: { select: { id: true, fullName: true } },
      },
    });

    res.status(201).json({ data: program });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/programs/athlete/:athleteId
 * Get all programs for an athlete
 */
/**
 * GET /api/programs/my
 * Self-managed athlete view of their own programs. Equivalent to
 * /athlete/:athleteId with athleteId=me, but ergonomic for the athlete
 * dashboard widgets. Optional ?status filter.
 */
router.get('/my', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const { status } = req.query;
    const where: Record<string, unknown> = { athleteId: user.userId };
    if (status) where.status = status as string;

    const programs = await prisma.program.findMany({
      where,
      include: {
        coach: { select: { id: true, fullName: true } },
        weeks: {
          orderBy: { weekNum: 'asc' },
          include: {
            days: {
              orderBy: { dayNum: 'asc' },
              include: {
                exercises: {
                  orderBy: { sortOrder: 'asc' },
                  include: {
                    exercise: { select: { id: true, name: true, category: true, equipment: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ data: programs });
  } catch (err) {
    next(err);
  }
});

router.get('/athlete/:athleteId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const athleteId = param(req, 'athleteId');

    if (user.role === Role.CLIENT && user.userId !== athleteId) {
      throw ApiError.forbidden('You can only view your own programs');
    }

    const { status } = req.query;
    const where: Record<string, unknown> = { athleteId };
    if (status) where.status = status as string;

    const programs = await prisma.program.findMany({
      where,
      include: {
        coach: { select: { id: true, fullName: true } },
        weeks: {
          orderBy: { weekNum: 'asc' },
          include: {
            days: {
              orderBy: { dayNum: 'asc' },
              include: {
                exercises: {
                  orderBy: { sortOrder: 'asc' },
                  include: {
                    exercise: { select: { id: true, name: true, category: true, equipment: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ data: programs });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/programs/:programId
 * Get full program detail with weeks/days/exercises
 */
router.get('/:programId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const programId = param(req, 'programId');

    const program = await prisma.program.findUnique({
      where: { id: programId },
      include: {
        coach: { select: { id: true, fullName: true } },
        athlete: { select: { id: true, fullName: true } },
        weeks: {
          orderBy: { weekNum: 'asc' },
          include: {
            days: {
              orderBy: { dayNum: 'asc' },
              include: {
                exercises: {
                  orderBy: { sortOrder: 'asc' },
                  include: {
                    exercise: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!program) throw ApiError.notFound('Program not found');

    // Clients can only see their own programs
    if (user.role === Role.CLIENT && program.athleteId !== user.userId) {
      throw ApiError.forbidden('You can only view your own programs');
    }

    res.json({ data: program });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/programs/:programId
 * Update program metadata (title, description, status, dates)
 */
router.put('/:programId', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const programId = param(req, 'programId');
    const { title, description, status, startDate, endDate } = req.body;

    const existing = await prisma.program.findUnique({ where: { id: programId } });
    if (!existing) throw ApiError.notFound('Program not found');

    const updateData: Record<string, unknown> = {};
    if (title !== undefined) updateData.title = title.trim();
    if (description !== undefined) updateData.description = description?.trim() || null;
    if (status && Object.values(ProgramStatus).includes(status)) updateData.status = status;
    if (startDate !== undefined) updateData.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null;

    const program = await prisma.program.update({
      where: { id: programId },
      data: updateData,
      include: {
        coach: { select: { id: true, fullName: true } },
        athlete: { select: { id: true, fullName: true } },
      },
    });

    res.json({ data: program });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PROGRAM WEEKS
// ============================================================

/**
 * POST /api/programs/:programId/weeks
 * Add a week to a program
 */
router.post('/:programId/weeks', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const programId = param(req, 'programId');
    const { weekNum, title } = req.body;

    const program = await prisma.program.findUnique({ where: { id: programId } });
    if (!program) throw ApiError.notFound('Program not found');

    // Auto-determine week number if not provided
    let resolvedWeekNum = weekNum;
    if (!resolvedWeekNum) {
      const lastWeek = await prisma.programWeek.findFirst({
        where: { programId },
        orderBy: { weekNum: 'desc' },
      });
      resolvedWeekNum = (lastWeek?.weekNum || 0) + 1;
    }

    const week = await prisma.programWeek.create({
      data: {
        programId,
        weekNum: resolvedWeekNum,
        title: title?.trim() || null,
      },
    });

    res.status(201).json({ data: week });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PROGRAM DAYS
// ============================================================

/**
 * POST /api/programs/weeks/:weekId/days
 * Add a day to a week
 */
router.post('/weeks/:weekId/days', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const weekId = param(req, 'weekId');
    const { dayNum, title, notes } = req.body;

    const week = await prisma.programWeek.findUnique({ where: { id: weekId } });
    if (!week) throw ApiError.notFound('Week not found');

    if (!dayNum || dayNum < 1 || dayNum > 7) {
      throw ApiError.badRequest('Day number must be between 1 and 7');
    }

    const day = await prisma.programDay.create({
      data: {
        weekId,
        dayNum,
        title: title?.trim() || null,
        notes: notes?.trim() || null,
      },
    });

    res.status(201).json({ data: day });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PROGRAM EXERCISES
// ============================================================

/**
 * POST /api/programs/days/:dayId/exercises
 * Add an exercise to a day. Mobile-friendly: uses exerciseId (from library) or customName.
 */
router.post('/days/:dayId/exercises', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dayId = param(req, 'dayId');
    const { exerciseId, customName, sets, reps, intensity, restSeconds, tempo, notes, sortOrder } = req.body;

    const day = await prisma.programDay.findUnique({ where: { id: dayId } });
    if (!day) throw ApiError.notFound('Day not found');

    if (!exerciseId && !customName) {
      throw ApiError.badRequest('Either exerciseId or customName is required');
    }

    // Auto sort order
    let resolvedSort = sortOrder;
    if (resolvedSort === undefined) {
      const last = await prisma.programExercise.findFirst({
        where: { dayId },
        orderBy: { sortOrder: 'desc' },
      });
      resolvedSort = (last?.sortOrder || 0) + 1;
    }

    const exercise = await prisma.programExercise.create({
      data: {
        dayId,
        exerciseId: exerciseId || null,
        customName: customName?.trim() || null,
        sets: sets || null,
        reps: reps?.toString() || null,
        intensity: intensity?.trim() || null,
        restSeconds: restSeconds || null,
        tempo: tempo?.trim() || null,
        notes: notes?.trim() || null,
        sortOrder: resolvedSort,
      },
      include: {
        exercise: { select: { id: true, name: true, category: true } },
      },
    });

    res.status(201).json({ data: exercise });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/programs/exercises/:exerciseId
 * Update a program exercise
 */
router.put('/exercises/:exerciseId', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const exerciseId = param(req, 'exerciseId');
    const { sets, reps, intensity, restSeconds, tempo, notes, sortOrder } = req.body;

    const existing = await prisma.programExercise.findUnique({ where: { id: exerciseId } });
    if (!existing) throw ApiError.notFound('Exercise not found');

    const updateData: Record<string, unknown> = {};
    if (sets !== undefined) updateData.sets = sets;
    if (reps !== undefined) updateData.reps = reps?.toString() || null;
    if (intensity !== undefined) updateData.intensity = intensity?.trim() || null;
    if (restSeconds !== undefined) updateData.restSeconds = restSeconds;
    if (tempo !== undefined) updateData.tempo = tempo?.trim() || null;
    if (notes !== undefined) updateData.notes = notes?.trim() || null;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;

    const updated = await prisma.programExercise.update({
      where: { id: exerciseId },
      data: updateData,
      include: {
        exercise: { select: { id: true, name: true, category: true } },
      },
    });

    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/programs/exercises/:exerciseId
 * Remove an exercise from a day
 */
router.delete('/exercises/:exerciseId', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const exerciseId = param(req, 'exerciseId');

    await prisma.programExercise.delete({ where: { id: exerciseId } });
    res.json({ message: 'Exercise removed' });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// EXERCISE LIBRARY
// ============================================================

/**
 * GET /api/programs/exercises/library
 * Get all exercises from the library (for dropdown selection)
 */
router.get('/exercises/library', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { category } = req.query;
    const where: Record<string, unknown> = { isActive: true };
    if (category) where.category = category as string;

    const exercises = await prisma.exercise.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });

    res.json({ data: exercises });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/programs/exercises/library
 * Admin/Staff: add an exercise to the library
 */
router.post('/exercises/library', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, category, equipment, description, videoUrl } = req.body;

    if (!name) throw ApiError.badRequest('Exercise name is required');
    if (!category) throw ApiError.badRequest('Exercise category is required');

    const validCategories = ['throwing', 'arm_care', 'strength', 'mobility', 'conditioning', 'plyometrics', 'hitting', 'fielding'];
    if (!validCategories.includes(category)) {
      throw ApiError.badRequest(`Category must be one of: ${validCategories.join(', ')}`);
    }

    const exercise = await prisma.exercise.create({
      data: {
        name: name.trim(),
        category,
        equipment: equipment?.trim() || null,
        description: description?.trim() || null,
        videoUrl: videoUrl?.trim() || null,
      },
    });

    res.status(201).json({ data: exercise });
  } catch (err) {
    next(err);
  }
});

export default router;
