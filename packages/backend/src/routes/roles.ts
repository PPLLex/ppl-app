/**
 * Role-related endpoints — thin wrappers around roleService helpers.
 *
 * These are the backend-of-truth for the admin invite UI (Commit 3): the
 * frontend calls /me/roles to show a user what they currently hold, and
 * /me/invitable-roles to populate the invite dropdown with only the roles
 * the caller is actually permitted to invite.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getUserRoles,
  invitableRoles,
  locationsForRole,
  partnerSchoolsForCoach,
} from '../services/roleService';
import { Role } from '@prisma/client';

const router = Router();

/**
 * GET /api/roles/me
 * Returns all UserRole rows for the authenticated user, plus convenience
 * flags the frontend uses for dashboard variant selection.
 */
router.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const rows = await getUserRoles(userId);
    const coachLocations = await locationsForRole(userId, Role.PERFORMANCE_COACH);
    const coordinatorLocations = await locationsForRole(userId, Role.COORDINATOR);
    const partnerSchools = await partnerSchoolsForCoach(userId);

    res.json({
      success: true,
      data: {
        roles: rows,
        flags: {
          isAdmin: rows.some((r) => r.role === Role.ADMIN),
          isCoordinator: rows.some((r) => r.role === Role.COORDINATOR),
          isPerformanceCoach: rows.some((r) => r.role === Role.PERFORMANCE_COACH),
          isMedicalAdmin: rows.some((r) => r.role === Role.MEDICAL_ADMIN),
          isMedical: rows.some((r) => r.role === Role.MEDICAL),
          isContentMarketingAdmin: rows.some((r) => r.role === Role.CONTENT_MARKETING_ADMIN),
          isContentMarketing: rows.some((r) => r.role === Role.CONTENT_MARKETING),
          isPartnershipCoach: rows.some((r) => r.role === Role.PARTNERSHIP_COACH),
          isParent: rows.some((r) => r.role === Role.PARENT),
          isAthlete: rows.some((r) => r.role === Role.ATHLETE),
        },
        coachLocations,
        coordinatorLocations,
        partnerSchools,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/roles/invitable
 * Returns the list of roles the authenticated user is allowed to invite.
 * Used by the admin invite UI to populate the role dropdown so users never
 * see options they can't actually execute.
 */
router.get(
  '/invitable',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const roles = await invitableRoles(req.user!.userId);
      res.json({ success: true, data: roles });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
