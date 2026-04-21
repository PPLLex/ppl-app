import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate, requireStaffOrAdmin } from '../middleware/auth';
import { notify } from '../services/notificationService';
import { NotificationType, NotificationChannel } from '@prisma/client';

const router = Router();

function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

// ============================================================
// CLIENT (ATHLETE / PARENT) ENDPOINTS
// ============================================================

/**
 * GET /api/outside-coaches/my
 * Get all outside coaches linked to the current user's athlete profile.
 */
router.get('/my', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;

    const athleteProfile = await prisma.athleteProfile.findUnique({
      where: { userId: user.userId },
      select: { id: true },
    });

    if (!athleteProfile) {
      return res.json({ success: true, data: [] });
    }

    const coaches = await prisma.outsideCoachLink.findMany({
      where: { athleteId: athleteProfile.id, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: coaches });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/outside-coaches
 * Add an outside coach to the athlete's profile.
 * Athlete or parent can add coaches.
 */
router.post('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const { coachName, coachEmail, coachPhone, organization, coachRole, athleteId } = req.body;

    if (!coachName || !coachEmail) {
      throw ApiError.badRequest('Coach name and email are required');
    }

    // Determine which athlete profile to link to
    let targetAthleteId: string;

    if (athleteId) {
      // Parent adding a coach for their child
      const athlete = await prisma.athleteProfile.findUnique({
        where: { id: athleteId },
        include: { family: { select: { parentUserId: true } } },
      });

      if (!athlete) throw ApiError.notFound('Athlete not found');

      // Verify the requester is the athlete themselves or their parent
      if (athlete.userId !== user.userId && athlete.family?.parentUserId !== user.userId) {
        throw ApiError.forbidden('You can only add coaches for your own athletes');
      }

      targetAthleteId = athleteId;
    } else {
      // Athlete adding a coach for themselves
      const profile = await prisma.athleteProfile.findUnique({
        where: { userId: user.userId },
      });

      if (!profile) throw ApiError.notFound('No athlete profile found');
      targetAthleteId = profile.id;
    }

    // Check if this coach is already linked
    const existing = await prisma.outsideCoachLink.findUnique({
      where: {
        athleteId_coachEmail: {
          athleteId: targetAthleteId,
          coachEmail: coachEmail.toLowerCase(),
        },
      },
    });

    if (existing) {
      if (existing.isActive) {
        throw ApiError.conflict('This coach is already linked to this athlete');
      }
      // Reactivate if previously removed
      const reactivated = await prisma.outsideCoachLink.update({
        where: { id: existing.id },
        data: { isActive: true, coachName, coachPhone, organization, coachRole },
      });
      return res.json({ success: true, data: reactivated });
    }

    const link = await prisma.outsideCoachLink.create({
      data: {
        athleteId: targetAthleteId,
        coachName,
        coachEmail: coachEmail.toLowerCase(),
        coachPhone,
        organization,
        coachRole,
      },
    });

    // TODO: Send invitation email to the outside coach with instructions
    // to create an account and access the athlete's performance data.

    res.status(201).json({ success: true, data: link });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/outside-coaches/:id
 * Remove an outside coach link (soft delete).
 */
router.delete('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const linkId = param(req, 'id');

    const link = await prisma.outsideCoachLink.findUnique({
      where: { id: linkId },
      include: {
        athlete: {
          select: {
            userId: true,
            family: { select: { parentUserId: true } },
          },
        },
      },
    });

    if (!link) throw ApiError.notFound('Coach link not found');

    // Verify the requester owns this athlete
    if (link.athlete.userId !== user.userId && link.athlete.family?.parentUserId !== user.userId) {
      throw ApiError.forbidden('You can only manage coaches for your own athletes');
    }

    await prisma.outsideCoachLink.update({
      where: { id: linkId },
      data: { isActive: false },
    });

    res.json({ success: true, message: 'Outside coach removed' });
  } catch (error) {
    next(error);
  }
});

// ============================================================
// OUTSIDE COACH VIEW ENDPOINTS
// ============================================================

/**
 * GET /api/outside-coaches/athletes
 * Outside coach: view all athletes linked to the logged-in coach's email.
 * Returns athlete names, metrics, and basic info.
 */
router.get('/athletes', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;

    // Find the user's email to match against coach links
    const currentUser = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { email: true },
    });

    if (!currentUser) throw ApiError.notFound('User not found');

    const links = await prisma.outsideCoachLink.findMany({
      where: {
        coachEmail: currentUser.email.toLowerCase(),
        isActive: true,
      },
      include: {
        athlete: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            ageGroup: true,
            dateOfBirth: true,
            userId: true,
          },
        },
      },
    });

    res.json({
      success: true,
      data: links.map(l => ({
        linkId: l.id,
        organization: l.organization,
        coachRole: l.coachRole,
        athlete: l.athlete,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/outside-coaches/athletes/:athleteId/reports
 * Outside coach: view an athlete's assessment reports and metrics.
 * Read-only access — verified by coach link.
 */
router.get(
  '/athletes/:athleteId/reports',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const athleteId = param(req, 'athleteId');

      // Verify the coach has a link to this athlete
      const currentUser = await prisma.user.findUnique({
        where: { id: user.userId },
        select: { email: true },
      });

      if (!currentUser) throw ApiError.notFound('User not found');

      const link = await prisma.outsideCoachLink.findFirst({
        where: {
          athleteId,
          coachEmail: currentUser.email.toLowerCase(),
          isActive: true,
        },
      });

      if (!link) {
        throw ApiError.forbidden('You do not have access to this athlete\'s data');
      }

      // Fetch the athlete's profile with related data
      const athlete = await prisma.athleteProfile.findUnique({
        where: { id: athleteId },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
            },
          },
        },
      });

      if (!athlete) throw ApiError.notFound('Athlete not found');

      // Fetch coach notes for this athlete (read-only)
      const coachNotes = await prisma.coachNote.findMany({
        where: {
          athleteId: athlete.userId,
          isVisible: true,
        },
        include: {
          coach: { select: { fullName: true } },
          booking: {
            select: {
              session: {
                select: { startTime: true, sessionTypeName: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      res.json({
        success: true,
        data: {
          athlete: {
            id: athlete.id,
            firstName: athlete.firstName,
            lastName: athlete.lastName,
            ageGroup: athlete.ageGroup,
          },
          coachNotes: coachNotes.map(n => ({
            id: n.id,
            coachName: n.coach?.fullName || 'Coach',
            sessionDate: n.booking?.session?.startTime || n.sessionDate,
            sessionType: n.booking?.session?.sessionTypeName || n.trainingCategory,
            content: n.cleanedContent || n.rawContent,
            createdAt: n.createdAt,
          })),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================================
// ADMIN ENDPOINTS
// ============================================================

/**
 * GET /api/outside-coaches/all
 * Admin: list all outside coach links across all athletes.
 */
router.get('/all', authenticate, requireStaffOrAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const links = await prisma.outsideCoachLink.findMany({
      where: { isActive: true },
      include: {
        athlete: {
          select: {
            firstName: true,
            lastName: true,
            ageGroup: true,
            user: { select: { fullName: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: links });
  } catch (error) {
    next(error);
  }
});

export default router;
