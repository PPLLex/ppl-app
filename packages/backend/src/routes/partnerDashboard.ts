/**
 * Partner school dashboard endpoint — backs the /partner/[slug] page that
 * Partnership Coaches and their athletes land on. Returns the school team
 * with its roster plus basic stats.
 *
 * Access rules (enforced inside the handler):
 *   - ADMIN              → any school
 *   - PARTNERSHIP_COACH  → only schools they're assigned to via UserRole.schoolTeamId
 *   - ATHLETE            → only the school their AthleteProfile is on
 *   - Everyone else      → 403
 *
 * The dashboard variant (HighSchool vs TravelTeam vs College) is selected
 * client-side from the `type` field on the returned school team.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { ApiError } from '../utils/apiError';
import { prisma } from '../utils/prisma';
import { Role } from '@prisma/client';
import { hasRoleForSchool, isAdmin } from '../services/roleService';

const router = Router();

function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

/**
 * GET /api/partner-dashboard/:slug
 * Returns the full dashboard payload for a partner school, gated by the
 * caller's role.
 */
router.get(
  '/:slug',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const slug = param(req, 'slug');
      const userId = req.user!.userId;

      const schoolTeam = await prisma.schoolTeam.findUnique({
        where: { slug },
        include: {
          primaryLocation: { select: { id: true, name: true } },
        },
      });
      if (!schoolTeam) {
        throw ApiError.notFound('Partner school not found');
      }

      // Access gate
      const userIsAdmin = await isAdmin(userId);
      const userIsPartnerCoach = await hasRoleForSchool(
        userId,
        Role.PARTNERSHIP_COACH,
        schoolTeam.id
      );

      // Check if the caller is an athlete on this school's roster. We
      // intentionally don't gate on UserRole(ATHLETE) here — the presence
      // of an AthleteProfile tagged with this schoolTeamId is the source
      // of truth, and it works for both migrated and unmigrated users
      // during the April 2026 role-model transition window.
      let userIsAthleteOnRoster = false;
      if (!userIsAdmin && !userIsPartnerCoach) {
        const athleteOnRoster = await prisma.athleteProfile.findFirst({
          where: { userId, schoolTeamId: schoolTeam.id },
          select: { id: true },
        });
        userIsAthleteOnRoster = athleteOnRoster !== null;
      }

      if (!userIsAdmin && !userIsPartnerCoach && !userIsAthleteOnRoster) {
        throw ApiError.forbidden('You do not have access to this partner school');
      }

      // Roster — list of athletes on this school. Partnership Coach +
      // Admin see everyone; individual athletes see themselves only.
      const rosterWhere = userIsAthleteOnRoster && !userIsAdmin && !userIsPartnerCoach
        ? { schoolTeamId: schoolTeam.id, userId }
        : { schoolTeamId: schoolTeam.id };

      const roster = await prisma.athleteProfile.findMany({
        where: rosterWhere,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          ageGroup: true,
          dateOfBirth: true,
          user: {
            select: { id: true, email: true, phone: true },
          },
        },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      });

      // Booking counts per athlete — how many sessions have they booked at PPL?
      // Useful for "who's actually training vs just on the roster" intelligence.
      const bookingsCount = await prisma.booking.groupBy({
        by: ['clientId'],
        where: {
          clientId: { in: roster.map((r) => r.user.id) },
          status: { in: ['CONFIRMED', 'COMPLETED'] },
        },
        _count: { _all: true },
      });
      const countByClient = new Map<string, number>(
        bookingsCount.map((b) => [b.clientId, b._count._all])
      );

      res.json({
        success: true,
        data: {
          schoolTeam: {
            id: schoolTeam.id,
            name: schoolTeam.name,
            slug: schoolTeam.slug,
            type: schoolTeam.type, // HIGH_SCHOOL | TRAVEL_TEAM | COLLEGE
            brandLogoUrl: schoolTeam.brandLogoUrl,
            brandColors: schoolTeam.brandColors,
            coachName: schoolTeam.coachName,
            primaryLocation: schoolTeam.primaryLocation,
          },
          roster: roster.map((a) => ({
            id: a.id,
            firstName: a.firstName,
            lastName: a.lastName,
            ageGroup: a.ageGroup,
            dateOfBirth: a.dateOfBirth,
            userId: a.user.id,
            email: a.user.email,
            phone: a.user.phone,
            sessionsAtPpl: countByClient.get(a.user.id) ?? 0,
          })),
          viewerRole: userIsAdmin
            ? 'ADMIN'
            : userIsPartnerCoach
            ? 'PARTNERSHIP_COACH'
            : 'ATHLETE',
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
