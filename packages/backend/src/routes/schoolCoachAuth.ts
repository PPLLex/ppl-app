import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { config } from '../config';

const router = Router();

// ============================================================
// COACH JWT
// ============================================================

interface CoachJwtPayload {
  schoolCoachId: string;
  email: string;
  schoolTeamId: string;
  type: 'school_coach'; // Distinguish from regular user tokens
}

function generateCoachToken(payload: CoachJwtPayload): string {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  } as jwt.SignOptions);
}

/**
 * Middleware to authenticate a school coach via JWT.
 */
export const authenticateCoach = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw ApiError.unauthorized('No token provided');
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, config.jwt.secret) as CoachJwtPayload;

    if (decoded.type !== 'school_coach') {
      throw ApiError.unauthorized('Invalid token type');
    }

    (req as any).coach = decoded;
    next();
  } catch (error) {
    if (error instanceof ApiError) {
      next(error);
    } else {
      next(ApiError.unauthorized('Invalid or expired token'));
    }
  }
};

// ============================================================
// AUTH ROUTES
// ============================================================

/**
 * POST /api/coach-auth/login
 * School coach login with email + password.
 */
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new ApiError(400, 'Email and password are required');
    }

    const coach = await prisma.schoolCoach.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        schoolTeam: { select: { id: true, name: true, brandLogoUrl: true, brandColors: true, slug: true } },
      },
    });

    if (!coach) throw new ApiError(401, 'Invalid email or password');
    if (!coach.isActive) throw new ApiError(403, 'Account is deactivated. Contact PPL for assistance.');
    if (!coach.canViewDashboard) throw new ApiError(403, 'Dashboard access is not enabled for your account.');

    const validPassword = await bcrypt.compare(password, coach.passwordHash);
    if (!validPassword) throw new ApiError(401, 'Invalid email or password');

    // Update last login
    await prisma.schoolCoach.update({
      where: { id: coach.id },
      data: { lastLoginAt: new Date() },
    });

    const token = generateCoachToken({
      schoolCoachId: coach.id,
      email: coach.email,
      schoolTeamId: coach.schoolTeamId,
      type: 'school_coach',
    });

    res.json({
      data: {
        token,
        coach: {
          id: coach.id,
          email: coach.email,
          fullName: coach.fullName,
          role: coach.role,
          title: coach.title,
          permissions: {
            canTakeNotes: coach.canTakeNotes,
            canViewPrograms: coach.canViewPrograms,
            canViewGoals: coach.canViewGoals,
            canViewMetrics: coach.canViewMetrics,
            canMessageAthletes: coach.canMessageAthletes,
          },
          schoolTeam: coach.schoolTeam,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});
/**
 * GET /api/coach-auth/me
 * Get current coach profile.
 */
router.get('/me', authenticateCoach, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { schoolCoachId } = (req as any).coach;

    const coach = await prisma.schoolCoach.findUnique({
      where: { id: schoolCoachId },
      include: {
        schoolTeam: {
          select: { id: true, name: true, slug: true, brandLogoUrl: true, brandColors: true },
        },
      },
    });

    if (!coach) throw new ApiError(404, 'Coach not found');

    res.json({
      data: {
        id: coach.id,
        email: coach.email,
        fullName: coach.fullName,
        role: coach.role,
        title: coach.title,
        phone: coach.phone,
        permissions: {
          canTakeNotes: coach.canTakeNotes,
          canViewPrograms: coach.canViewPrograms,
          canViewGoals: coach.canViewGoals,
          canViewMetrics: coach.canViewMetrics,
          canMessageAthletes: coach.canMessageAthletes,
        },
        schoolTeam: coach.schoolTeam,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/coach-auth/change-password
 * Coach changes their own password.
 */
router.put('/change-password', authenticateCoach, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { schoolCoachId } = (req as any).coach;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      throw new ApiError(400, 'Current and new password are required');
    }
    if (newPassword.length < 8) {
      throw new ApiError(400, 'New password must be at least 8 characters');
    }

    const coach = await prisma.schoolCoach.findUnique({ where: { id: schoolCoachId } });
    if (!coach) throw new ApiError(404, 'Coach not found');

    const validPassword = await bcrypt.compare(currentPassword, coach.passwordHash);
    if (!validPassword) throw new ApiError(401, 'Current password is incorrect');

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.schoolCoach.update({
      where: { id: schoolCoachId },
      data: { passwordHash },
    });

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/coach-auth/push-subscription
 * Save push notification subscription for this coach.
 */
router.put('/push-subscription', authenticateCoach, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { schoolCoachId } = (req as any).coach;
    const { subscription } = req.body;

    await prisma.schoolCoach.update({
      where: { id: schoolCoachId },
      data: { pushSubscription: subscription },
    });

    res.json({ message: 'Push subscription saved' });
  } catch (err) {
    next(err);
  }
});

export default router;
