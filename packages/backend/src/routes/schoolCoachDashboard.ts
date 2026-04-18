import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticateCoach } from './schoolCoachAuth';

const router = Router();

// All routes require coach authentication
router.use(authenticateCoach);

function getCoach(req: Request) {
  return (req as any).coach as { schoolCoachId: string; schoolTeamId: string; email: string };
}

// ============================================================
// TEAM ROSTER
// ============================================================

/**
 * GET /api/coach-dashboard/roster
 * Get all athletes on this coach's team with summary stats.
 */
router.get('/roster', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { schoolTeamId, schoolCoachId } = getCoach(req);

    // Get coach permissions
    const coach = await prisma.schoolCoach.findUnique({ where: { id: schoolCoachId } });
    if (!coach) throw new ApiError(404, 'Coach not found');

    const athletes = await prisma.athleteProfile.findMany({
      where: { schoolTeamId },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            isActive: true,
          },
        },
      },
      orderBy: { lastName: 'asc' },
    });

    // For each athlete, get counts and latest data
    const rosterWithStats = await Promise.all(
      athletes.map(async (athlete) => {
        const userId = athlete.userId;

        const [noteCount, latestNote, activeGoals, activeProgram, latestMetric] = await Promise.all([
          prisma.coachNote.count({ where: { athleteId: userId } }),
          prisma.coachNote.findFirst({
            where: { athleteId: userId },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true, trainingCategory: true, rawContent: true },
          }),
          prisma.goal.count({ where: { athleteId: userId, status: 'ACTIVE' } }),
          prisma.program.findFirst({
            where: { athleteId: userId, status: 'ACTIVE' },
            select: { id: true, title: true },
          }),
          coach.canViewMetrics
            ? prisma.athleteMetric.findFirst({
                where: { athleteId: userId },
                orderBy: { createdAt: 'desc' },
                select: { metricType: true, value: true, unit: true, createdAt: true },
              })
            : null,
        ]);

        return {
          id: athlete.id,
          userId: athlete.userId,
          firstName: athlete.firstName,
          lastName: athlete.lastName,
          email: athlete.user.email,
          phone: athlete.user.phone,
          isActive: athlete.user.isActive,
          dateOfBirth: athlete.dateOfBirth,
          ageGroup: athlete.ageGroup,
          stats: {
            noteCount,
            lastNoteDate: latestNote?.createdAt || null,
            lastNoteCategory: latestNote?.trainingCategory || null,
            activeGoals,
            activeProgram: activeProgram?.title || null,
            latestMetric: latestMetric
              ? { type: latestMetric.metricType, value: latestMetric.value, unit: latestMetric.unit, date: latestMetric.createdAt }
              : null,
          },
        };
      })
    );

    res.json({ data: rosterWithStats });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// NOTES
// ============================================================

/**
 * GET /api/coach-dashboard/athletes/:athleteId/notes
 * Get all notes for an athlete.
 */
router.get('/athletes/:athleteId/notes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { schoolTeamId, schoolCoachId } = getCoach(req);
    const athleteId = req.params.athleteId;

    // Verify athlete is on this coach's team
    const athlete = await prisma.athleteProfile.findFirst({
      where: { userId: athleteId, schoolTeamId },
    });
    if (!athlete) throw new ApiError(404, 'Athlete not found on your team');

    const notes = await prisma.coachNote.findMany({
      where: { athleteId, isVisible: true },
      orderBy: { createdAt: 'desc' },
      include: {
        coach: { select: { fullName: true } },
        schoolCoach: { select: { fullName: true } },
      },
    });

    res.json({
      data: notes.map((n) => ({
        id: n.id,
        category: n.trainingCategory,
        content: n.cleanedContent || n.rawContent,
        rawContent: n.rawContent,
        sessionDate: n.sessionDate,
        coachName: n.schoolCoach?.fullName || n.coach?.fullName || 'PPL Staff',
        isSchoolCoachNote: n.schoolCoachId === schoolCoachId,
        createdAt: n.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/coach-dashboard/athletes/:athleteId/notes
 * School coach creates a note for an athlete.
 */
router.post('/athletes/:athleteId/notes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { schoolTeamId, schoolCoachId } = getCoach(req);
    const athleteId = req.params.athleteId;

    // Verify permissions
    const coach = await prisma.schoolCoach.findUnique({ where: { id: schoolCoachId } });
    if (!coach?.canTakeNotes) throw new ApiError(403, 'You do not have permission to take notes');

    // Verify athlete is on this coach's team
    const athlete = await prisma.athleteProfile.findFirst({
      where: { userId: athleteId, schoolTeamId },
    });
    if (!athlete) throw new ApiError(404, 'Athlete not found on your team');

    const { content, category, sessionDate } = req.body;
    if (!content?.trim()) throw new ApiError(400, 'Note content is required');

    const note = await prisma.coachNote.create({
      data: {
        athleteId,
        schoolCoachId,
        trainingCategory: category || 'GENERAL',
        rawContent: content.trim(),
        sessionDate: sessionDate ? new Date(sessionDate) : new Date(),
      },
    });

    res.status(201).json({ data: note });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GOALS
// ============================================================

/**
 * GET /api/coach-dashboard/athletes/:athleteId/goals
 * Get goals for an athlete.
 */
router.get('/athletes/:athleteId/goals', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { schoolTeamId, schoolCoachId } = getCoach(req);
    const athleteId = req.params.athleteId;

    const coach = await prisma.schoolCoach.findUnique({ where: { id: schoolCoachId } });
    if (!coach?.canViewGoals) throw new ApiError(403, 'You do not have permission to view goals');

    const athlete = await prisma.athleteProfile.findFirst({
      where: { userId: athleteId, schoolTeamId },
    });
    if (!athlete) throw new ApiError(404, 'Athlete not found on your team');

    const goals = await prisma.goal.findMany({
      where: { athleteId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: {
        coach: { select: { fullName: true } },
      },
    });

    res.json({ data: goals });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PROGRAMS
// ============================================================

/**
 * GET /api/coach-dashboard/athletes/:athleteId/programs
 * Get programs for an athlete.
 */
router.get('/athletes/:athleteId/programs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { schoolTeamId, schoolCoachId } = getCoach(req);
    const athleteId = req.params.athleteId;

    const coach = await prisma.schoolCoach.findUnique({ where: { id: schoolCoachId } });
    if (!coach?.canViewPrograms) throw new ApiError(403, 'You do not have permission to view programs');

    const athlete = await prisma.athleteProfile.findFirst({
      where: { userId: athleteId, schoolTeamId },
    });
    if (!athlete) throw new ApiError(404, 'Athlete not found on your team');

    const programs = await prisma.program.findMany({
      where: { athleteId },
      orderBy: { createdAt: 'desc' },
      include: {
        coach: { select: { fullName: true } },
        weeks: {
          orderBy: { weekNum: 'asc' },
          include: {
            days: {
              orderBy: { dayNum: 'asc' },
              include: {
                exercises: {
                  orderBy: { sortOrder: 'asc' },
                  include: { exercise: true },
                },
              },
            },
          },
        },
      },
    });

    res.json({ data: programs });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// METRICS
// ============================================================

/**
 * GET /api/coach-dashboard/athletes/:athleteId/metrics
 * Get performance metrics for an athlete.
 */
router.get('/athletes/:athleteId/metrics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { schoolTeamId, schoolCoachId } = getCoach(req);
    const athleteId = req.params.athleteId;

    const coach = await prisma.schoolCoach.findUnique({ where: { id: schoolCoachId } });
    if (!coach?.canViewMetrics) throw new ApiError(403, 'You do not have permission to view metrics');

    const athlete = await prisma.athleteProfile.findFirst({
      where: { userId: athleteId, schoolTeamId },
    });
    if (!athlete) throw new ApiError(404, 'Athlete not found on your team');

    const metrics = await prisma.athleteMetric.findMany({
      where: { athleteId },
      orderBy: { sessionDate: 'desc' },
      take: 100,
      include: {
        schoolCoach: { select: { fullName: true } },
        staffCoach: { select: { fullName: true } },
      },
    });

    res.json({
      data: metrics.map((m) => ({
        id: m.id,
        type: m.metricType,
        value: m.value,
        unit: m.unit,
        customLabel: m.customLabel,
        sessionDate: m.sessionDate,
        notes: m.notes,
        loggedBy: m.schoolCoach?.fullName || m.staffCoach?.fullName || 'PPL Staff',
        createdAt: m.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/coach-dashboard/athletes/:athleteId/metrics
 * Log a new metric for an athlete.
 */
router.post('/athletes/:athleteId/metrics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { schoolTeamId, schoolCoachId } = getCoach(req);
    const athleteId = req.params.athleteId;

    const coach = await prisma.schoolCoach.findUnique({ where: { id: schoolCoachId } });
    if (!coach?.canViewMetrics) throw new ApiError(403, 'You do not have permission to log metrics');

    const athlete = await prisma.athleteProfile.findFirst({
      where: { userId: athleteId, schoolTeamId },
    });
    if (!athlete) throw new ApiError(404, 'Athlete not found on your team');

    const { metricType, value, unit, customLabel, sessionDate, notes } = req.body;

    if (!metricType || value === undefined || value === null) {
      throw new ApiError(400, 'Metric type and value are required');
    }

    const metric = await prisma.athleteMetric.create({
      data: {
        athleteId,
        schoolCoachId,
        metricType,
        value: parseFloat(value),
        unit: unit || null,
        customLabel: customLabel || null,
        sessionDate: sessionDate ? new Date(sessionDate) : new Date(),
        notes: notes || null,
      },
    });

    res.status(201).json({ data: metric });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// TEAM SUMMARY (for weekly digest)
// ============================================================

/**
 * GET /api/coach-dashboard/summary
 * Get a summary of the team's recent activity.
 */
router.get('/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { schoolTeamId } = getCoach(req);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const athletes = await prisma.athleteProfile.findMany({
      where: { schoolTeamId },
      select: { userId: true },
    });
    const athleteIds = athletes.map((a) => a.userId);

    const [recentNotes, recentMetrics, activeGoals, activePrograms] = await Promise.all([
      prisma.coachNote.count({
        where: { athleteId: { in: athleteIds }, createdAt: { gte: weekAgo } },
      }),
      prisma.athleteMetric.count({
        where: { athleteId: { in: athleteIds }, createdAt: { gte: weekAgo } },
      }),
      prisma.goal.count({
        where: { athleteId: { in: athleteIds }, status: 'ACTIVE' },
      }),
      prisma.program.count({
        where: { athleteId: { in: athleteIds }, status: 'ACTIVE' },
      }),
    ]);

    // Athletes with no notes in the past week
    const athletesWithRecentNotes = await prisma.coachNote.findMany({
      where: { athleteId: { in: athleteIds }, createdAt: { gte: weekAgo } },
      distinct: ['athleteId'],
      select: { athleteId: true },
    });
    const athletesNeedingAttention = athleteIds.length - athletesWithRecentNotes.length;

    res.json({
      data: {
        totalAthletes: athleteIds.length,
        recentNotes,
        recentMetrics,
        activeGoals,
        activePrograms,
        athletesNeedingAttention,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
