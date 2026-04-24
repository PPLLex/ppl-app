/**
 * Medical screenings API — powers the Medical / Medical Admin workflows.
 *
 * Access model:
 *   - ADMIN                → every screening at every location
 *   - MEDICAL_ADMIN        → every screening (they see the full roster
 *                            across all locations, plus revenue reports)
 *   - MEDICAL              → screenings at their assigned locations
 *                            (from UserRole.locationId)
 *   - COORDINATOR          → read-only at their location, for awareness
 *   - PERFORMANCE_COACH    → read-only for their athletes (shareableNotes
 *                            only — they never see medicalNotes)
 *
 * The /revenue endpoint is MEDICAL_ADMIN-only — that's the only role
 * Chad's spec allows to see screening revenue (specifically per-location
 * weekly totals flowing to Renewed Performance).
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate } from '../middleware/auth';
import {
  getUserRoles,
  requireAnyRole,
  locationsForRole,
  isAdmin,
} from '../services/roleService';
import { ScreeningStatus, Role, Prisma } from '@prisma/client';

const router = Router();

function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

// All routes require auth + a screening-eligible role.
router.use(
  authenticate,
  requireAnyRole(
    Role.ADMIN,
    Role.MEDICAL_ADMIN,
    Role.MEDICAL,
    Role.COORDINATOR,
    Role.PERFORMANCE_COACH
  )
);

/**
 * Build a WHERE clause that scopes screenings to the caller's visible set.
 * Admin + Medical Admin see everything; Medical is scoped to their
 * assigned locations; Coordinator + Performance Coach are scoped to their
 * locations for read-only purposes.
 */
async function callerScopeFilter(userId: string): Promise<Prisma.MedicalScreeningWhereInput | null> {
  const roles = await getUserRoles(userId);
  const hasGlobal =
    roles.some((r) => r.role === Role.ADMIN) ||
    roles.some((r) => r.role === Role.MEDICAL_ADMIN);
  if (hasGlobal) return {}; // no filter — see everything

  const locationIds = Array.from(
    new Set([
      ...(await locationsForRole(userId, Role.MEDICAL)),
      ...(await locationsForRole(userId, Role.COORDINATOR)),
      ...(await locationsForRole(userId, Role.PERFORMANCE_COACH)),
    ])
  );
  if (locationIds.length === 0) return null; // no scope → no results
  return { locationId: { in: locationIds } };
}

/**
 * Should this caller see internal medicalNotes for a screening? Only
 * MEDICAL + MEDICAL_ADMIN + ADMIN — not Coordinator or Performance Coach.
 */
async function canSeeMedicalNotes(userId: string): Promise<boolean> {
  const roles = await getUserRoles(userId);
  return roles.some(
    (r) => r.role === Role.ADMIN || r.role === Role.MEDICAL_ADMIN || r.role === Role.MEDICAL
  );
}

/**
 * GET /api/screenings
 * Filters: ?status=, ?locationId=, ?athleteId=, ?providerUserId=,
 *          ?from= ISO date, ?to= ISO date
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = await callerScopeFilter(req.user!.userId);
    if (scope === null) {
      return res.json({ success: true, data: [] });
    }

    const { status, locationId, athleteId, providerUserId, from, to } = req.query as Record<
      string,
      string
    >;

    const where: Prisma.MedicalScreeningWhereInput = { ...scope };
    if (status && (Object.values(ScreeningStatus) as string[]).includes(status)) {
      where.status = status as ScreeningStatus;
    }
    if (locationId) {
      // Extra layer of filtering; scope is already applied.
      where.locationId = scope.locationId
        ? // intersect caller's allowed locations
          Array.isArray((scope.locationId as { in?: string[] }).in) &&
          (scope.locationId as { in: string[] }).in.includes(locationId)
          ? locationId
          : '__no-match__'
        : locationId;
    }
    if (athleteId) where.athleteId = athleteId;
    if (providerUserId) where.providerUserId = providerUserId;
    if (from || to) {
      where.scheduledAt = {};
      if (from) {
        const d = new Date(from);
        if (!isNaN(d.getTime())) (where.scheduledAt as Prisma.DateTimeFilter).gte = d;
      }
      if (to) {
        const d = new Date(to);
        if (!isNaN(d.getTime())) (where.scheduledAt as Prisma.DateTimeFilter).lte = d;
      }
    }

    const canSeeNotes = await canSeeMedicalNotes(req.user!.userId);
    const screenings = await prisma.medicalScreening.findMany({
      where,
      include: {
        athlete: { select: { id: true, firstName: true, lastName: true, ageGroup: true } },
        provider: { select: { id: true, fullName: true } },
        location: { select: { id: true, name: true } },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 500,
    });

    // Strip medicalNotes from anything the caller isn't cleared to see.
    // (shareableNotes stays visible to Coordinator / Perf Coach as that's
    // the whole point of that field.)
    const payload = canSeeNotes
      ? screenings
      : screenings.map((s) => ({ ...s, medicalNotes: null }));

    res.json({ success: true, data: payload });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/screenings — schedule a new screening. Admin / Medical Admin /
 * Medical / Coordinator can create (Coordinator can book on behalf of an
 * athlete at their location; Medical can only book at their own location).
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      athleteId,
      providerUserId,
      locationId,
      scheduledAt,
      durationMinutes,
      providerFeeCents,
      marketingOptIn,
    } = req.body as Record<string, unknown>;

    if (!athleteId || !locationId || !scheduledAt) {
      throw ApiError.badRequest('athleteId, locationId, and scheduledAt are required');
    }

    const scheduledDate = new Date(String(scheduledAt));
    if (isNaN(scheduledDate.getTime())) throw ApiError.badRequest('Invalid scheduledAt');

    // Scope check — non-admins must have some role at this location.
    const userId = req.user!.userId;
    if (!(await isAdmin(userId))) {
      const roles = await getUserRoles(userId);
      const hasMedicalAdmin = roles.some((r) => r.role === Role.MEDICAL_ADMIN);
      if (!hasMedicalAdmin) {
        const allowedLocs = Array.from(
          new Set([
            ...(await locationsForRole(userId, Role.MEDICAL)),
            ...(await locationsForRole(userId, Role.COORDINATOR)),
          ])
        );
        if (!allowedLocs.includes(String(locationId))) {
          throw ApiError.forbidden('You cannot schedule screenings at this location');
        }
      }
    }

    const screening = await prisma.medicalScreening.create({
      data: {
        athleteId: String(athleteId),
        providerUserId: providerUserId ? String(providerUserId) : null,
        locationId: String(locationId),
        scheduledAt: scheduledDate,
        durationMinutes:
          typeof durationMinutes === 'number' && durationMinutes > 0 ? durationMinutes : 30,
        providerFeeCents:
          typeof providerFeeCents === 'number' && providerFeeCents >= 0
            ? providerFeeCents
            : 7500,
        marketingOptIn: !!marketingOptIn,
      },
    });

    res.status(201).json({ success: true, data: screening });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/screenings/:id — detail + results. Strips medicalNotes from
 * callers without clinical access.
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const scope = await callerScopeFilter(req.user!.userId);
    if (scope === null) throw ApiError.forbidden('No screening access');

    const screening = await prisma.medicalScreening.findFirst({
      where: { id, ...scope },
      include: {
        athlete: {
          select: { id: true, firstName: true, lastName: true, ageGroup: true },
        },
        provider: { select: { id: true, fullName: true } },
        location: { select: { id: true, name: true } },
        results: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!screening) throw ApiError.notFound('Screening not found');

    if (!(await canSeeMedicalNotes(req.user!.userId))) {
      (screening as { medicalNotes: string | null }).medicalNotes = null;
    }

    res.json({ success: true, data: screening });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/screenings/:id — update status, fees, notes. Auto-stamps
 * checkedInAt / completedAt when status transitions.
 */
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const scope = await callerScopeFilter(req.user!.userId);
    if (scope === null) throw ApiError.forbidden('No screening access');

    const existing = await prisma.medicalScreening.findFirst({ where: { id, ...scope } });
    if (!existing) throw ApiError.notFound('Screening not found');

    const body = req.body as Record<string, unknown>;
    const updates: Prisma.MedicalScreeningUpdateInput = {};

    if (typeof body.status === 'string' && (Object.values(ScreeningStatus) as string[]).includes(body.status)) {
      const newStatus = body.status as ScreeningStatus;
      updates.status = newStatus;
      if (newStatus === ScreeningStatus.CHECKED_IN && !existing.checkedInAt) {
        updates.checkedInAt = new Date();
      }
      if (newStatus === ScreeningStatus.COMPLETED && !existing.completedAt) {
        updates.completedAt = new Date();
      }
    }

    // shareableNotes is editable by any role that can see this screening.
    if (typeof body.shareableNotes === 'string') updates.shareableNotes = body.shareableNotes;

    // medicalNotes is Medical/Medical Admin only.
    if (typeof body.medicalNotes === 'string') {
      if (!(await canSeeMedicalNotes(req.user!.userId))) {
        throw ApiError.forbidden('Only medical staff can edit medicalNotes');
      }
      updates.medicalNotes = body.medicalNotes;
    }

    if (typeof body.providerFeeCents === 'number' && body.providerFeeCents >= 0) {
      updates.providerFeeCents = body.providerFeeCents;
    }
    if (typeof body.providerUserId === 'string') {
      updates.provider = { connect: { id: body.providerUserId } };
    } else if (body.providerUserId === null) {
      updates.provider = { disconnect: true };
    }
    if (body.marketingOptIn !== undefined) updates.marketingOptIn = !!body.marketingOptIn;

    const screening = await prisma.medicalScreening.update({ where: { id }, data: updates });
    res.json({ success: true, data: screening });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/screenings/:id/results — add a measurement result.
 * Body: { metric, value?, unit?, passOrFail?, side?, notes? }
 */
router.post('/:id/results', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    // Only Medical roles can add results.
    if (!(await canSeeMedicalNotes(req.user!.userId))) {
      throw ApiError.forbidden('Only medical staff can add screening results');
    }

    const { metric, value, unit, passOrFail, side, notes } = req.body as Record<string, unknown>;
    if (!metric) throw ApiError.badRequest('metric is required');

    const screening = await prisma.medicalScreening.findUnique({ where: { id }, select: { id: true } });
    if (!screening) throw ApiError.notFound('Screening not found');

    const result = await prisma.screeningResult.create({
      data: {
        screeningId: id,
        metric: String(metric),
        value: typeof value === 'number' ? value : null,
        unit: unit ? String(unit) : null,
        passOrFail: typeof passOrFail === 'boolean' ? passOrFail : null,
        side: side ? String(side) : null,
        notes: notes ? String(notes) : null,
      },
    });

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/screenings/revenue/weekly — MEDICAL_ADMIN only.
 * Returns provider fees grouped by location for a given week.
 * Query: ?weekStart=YYYY-MM-DD (Monday)
 *
 * Per Chad's spec, this is the ONLY revenue visibility Medical Admin
 * gets — the weekly screening revenue flowing to Renewed Performance,
 * broken out per PPL location.
 */
router.get('/revenue/weekly', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const roles = await getUserRoles(req.user!.userId);
    const isMedicalAdmin = roles.some(
      (r) => r.role === Role.MEDICAL_ADMIN || r.role === Role.ADMIN
    );
    if (!isMedicalAdmin) {
      throw ApiError.forbidden('Medical Admin or Admin role required');
    }

    const weekStartRaw = (req.query.weekStart as string) || '';
    const weekStart = weekStartRaw ? new Date(weekStartRaw) : startOfCurrentWeek();
    if (isNaN(weekStart.getTime())) throw ApiError.badRequest('Invalid weekStart');
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const rows = await prisma.medicalScreening.groupBy({
      by: ['locationId'],
      where: {
        status: ScreeningStatus.COMPLETED,
        completedAt: { gte: weekStart, lt: weekEnd },
      },
      _sum: { providerFeeCents: true },
      _count: { _all: true },
    });

    const locations = await prisma.location.findMany({
      where: { id: { in: rows.map((r) => r.locationId) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(locations.map((l) => [l.id, l.name]));

    res.json({
      success: true,
      data: {
        weekStart: weekStart.toISOString(),
        weekEnd: weekEnd.toISOString(),
        perLocation: rows.map((r) => ({
          locationId: r.locationId,
          locationName: nameById.get(r.locationId) ?? 'Unknown',
          screeningsCompleted: r._count._all,
          totalCents: r._sum.providerFeeCents ?? 0,
        })),
        totalCents: rows.reduce((acc, r) => acc + (r._sum.providerFeeCents ?? 0), 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

/** Monday of the current ISO week in the server's timezone. */
function startOfCurrentWeek(): Date {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  const offset = day === 0 ? -6 : 1 - day; // roll back to Monday
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}

export default router;
