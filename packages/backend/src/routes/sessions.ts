import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate, requireStaffOrAdmin } from '../middleware/auth';
import { createAuditLog } from '../services/auditService';
import { notifyAdminsOfScheduleChange } from '../services/notificationService';
import { Role, SessionType } from '@prisma/client';
import { randomUUID } from 'crypto';

const router = Router();

function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

/**
 * GET /api/sessions?locationId=&start=&end=&type=
 * List sessions for a location within a date range.
 * Public for authenticated users (clients see their location, admins see all).
 */
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { locationId, start, end, type } = req.query;
    const user = req.user!;

    // Clients can only see their home location
    let filterLocationId = locationId as string | undefined;
    if (user.role === Role.CLIENT) {
      filterLocationId = user.homeLocationId || undefined;
    }

    if (!filterLocationId) {
      throw ApiError.badRequest('Location ID is required');
    }

    const where: Record<string, unknown> = {
      locationId: filterLocationId,
      isActive: true,
    };

    if (start) {
      where.startTime = { ...(where.startTime as object || {}), gte: new Date(start as string) };
    }
    if (end) {
      where.endTime = { ...(where.endTime as object || {}), lte: new Date(end as string) };
    }
    if (type) {
      where.sessionType = type as SessionType;
    }

    const sessions = await prisma.session.findMany({
      where: where as any,
      include: {
        room: { select: { id: true, name: true } },
        coach: { select: { id: true, fullName: true } },
        _count: { select: { bookings: { where: { status: { in: ['CONFIRMED', 'COMPLETED'] } } } } },
      },
      orderBy: { startTime: 'asc' },
    });

    // Map to include spots remaining
    const data = sessions.map((s) => ({
      id: s.id,
      locationId: s.locationId,
      title: s.title,
      sessionType: s.sessionType,
      startTime: s.startTime.toISOString(),
      endTime: s.endTime.toISOString(),
      maxCapacity: s.maxCapacity,
      currentEnrolled: s._count.bookings,
      spotsRemaining: s.maxCapacity - s._count.bookings,
      registrationCutoffHours: s.registrationCutoffHours,
      cancellationCutoffHours: s.cancellationCutoffHours,
      room: s.room,
      coach: s.coach,
      recurringGroupId: s.recurringGroupId,
    }));

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/sessions/:id
 * Get a single session with booking details.
 */
router.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');

    const session = await prisma.session.findUnique({
      where: { id },
      include: {
        room: { select: { id: true, name: true } },
        coach: { select: { id: true, fullName: true } },
        bookings: {
          where: { status: { in: ['CONFIRMED', 'COMPLETED'] } },
          include: {
            client: { select: { id: true, fullName: true, phone: true } },
          },
        },
      },
    });

    if (!session) throw ApiError.notFound('Session not found');

    // Clients can only see limited info about other bookings
    const isStaffOrAdmin = req.user!.role === Role.ADMIN || req.user!.role === Role.STAFF;

    res.json({
      success: true,
      data: {
        ...session,
        startTime: session.startTime.toISOString(),
        endTime: session.endTime.toISOString(),
        spotsRemaining: session.maxCapacity - session.bookings.length,
        bookings: isStaffOrAdmin
          ? session.bookings
          : session.bookings.map((b) => ({
              id: b.id,
              status: b.status,
              client: { fullName: b.client.fullName },
            })),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/sessions
 * Staff or Admin: create a new session (single or recurring).
 * If staff creates it, all admins get notified.
 */
router.post('/', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      locationId,
      roomId,
      title,
      sessionType,
      startTime,
      endTime,
      maxCapacity,
      registrationCutoffHours,
      cancellationCutoffHours,
      recurringRule,
      recurringCount,
    } = req.body;

    const user = req.user!;

    if (!locationId || !title || !sessionType || !startTime || !endTime) {
      throw ApiError.badRequest('Location, title, session type, start time, and end time are required');
    }

    // Validate session type
    const validTypes = Object.values(SessionType);
    if (!validTypes.includes(sessionType)) {
      throw ApiError.badRequest(`Invalid session type. Must be one of: ${validTypes.join(', ')}`);
    }

    // Staff can only create sessions at their assigned locations
    if (user.role === Role.STAFF) {
      const staffLoc = await prisma.staffLocation.findUnique({
        where: { staffId_locationId: { staffId: user.userId, locationId } },
      });
      if (!staffLoc) {
        throw ApiError.forbidden('You can only create sessions at your assigned locations');
      }
    }

    const sessionsToCreate = [];
    const recurringGroupId = recurringRule ? randomUUID() : null;
    const start = new Date(startTime);
    const end = new Date(endTime);
    const count = recurringCount || 1;

    // Generate recurring sessions (weekly by default)
    for (let i = 0; i < count; i++) {
      const sessionStart = new Date(start);
      const sessionEnd = new Date(end);
      sessionStart.setDate(sessionStart.getDate() + i * 7);
      sessionEnd.setDate(sessionEnd.getDate() + i * 7);

      sessionsToCreate.push({
        locationId,
        roomId: roomId || null,
        coachId: user.userId,
        title,
        sessionType: sessionType as SessionType,
        startTime: sessionStart,
        endTime: sessionEnd,
        maxCapacity: maxCapacity || 8,
        registrationCutoffHours: registrationCutoffHours ?? 2,
        cancellationCutoffHours: cancellationCutoffHours ?? 1,
        recurringRule: recurringRule || null,
        recurringGroupId,
      });
    }

    const created = await prisma.session.createMany({ data: sessionsToCreate });

    // Audit log
    await createAuditLog({
      userId: user.userId,
      locationId,
      action: 'session.created',
      resourceType: 'session',
      changes: {
        title,
        sessionType,
        startTime,
        endTime,
        count: sessionsToCreate.length,
        recurringGroupId,
      },
    });

    // Notify admins if a staff member made the change
    if (user.role === Role.STAFF) {
      const staffUser = await prisma.user.findUnique({ where: { id: user.userId }, select: { fullName: true } });
      await notifyAdminsOfScheduleChange(
        user.userId,
        staffUser?.fullName || 'Staff',
        'created',
        title,
        `${sessionsToCreate.length} session(s) starting ${start.toLocaleDateString()} at ${start.toLocaleTimeString()}`
      );
    }

    res.status(201).json({
      success: true,
      data: { count: created.count, recurringGroupId },
      message: `${created.count} session(s) created successfully`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/sessions/:id
 * Staff or Admin: update a session.
 */
router.put('/:id', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const user = req.user!;

    const existing = await prisma.session.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound('Session not found');

    // Staff can only edit sessions at their assigned locations
    if (user.role === Role.STAFF) {
      const staffLoc = await prisma.staffLocation.findUnique({
        where: { staffId_locationId: { staffId: user.userId, locationId: existing.locationId } },
      });
      if (!staffLoc) throw ApiError.forbidden('You can only edit sessions at your assigned locations');
    }

    const {
      title,
      roomId,
      sessionType,
      startTime,
      endTime,
      maxCapacity,
      registrationCutoffHours,
      cancellationCutoffHours,
      isActive,
    } = req.body;

    const session = await prisma.session.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(roomId !== undefined && { roomId }),
        ...(sessionType !== undefined && { sessionType }),
        ...(startTime !== undefined && { startTime: new Date(startTime) }),
        ...(endTime !== undefined && { endTime: new Date(endTime) }),
        ...(maxCapacity !== undefined && { maxCapacity }),
        ...(registrationCutoffHours !== undefined && { registrationCutoffHours }),
        ...(cancellationCutoffHours !== undefined && { cancellationCutoffHours }),
        ...(isActive !== undefined && { isActive }),
      },
      include: {
        room: { select: { id: true, name: true } },
        coach: { select: { id: true, fullName: true } },
      },
    });

    // Build change description
    const changes: Record<string, unknown> = {};
    if (title !== undefined && title !== existing.title) changes.title = { from: existing.title, to: title };
    if (startTime !== undefined) changes.startTime = { from: existing.startTime, to: startTime };
    if (endTime !== undefined) changes.endTime = { from: existing.endTime, to: endTime };
    if (maxCapacity !== undefined && maxCapacity !== existing.maxCapacity) changes.maxCapacity = { from: existing.maxCapacity, to: maxCapacity };
    if (isActive !== undefined && isActive !== existing.isActive) changes.isActive = { from: existing.isActive, to: isActive };

    await createAuditLog({
      userId: user.userId,
      locationId: existing.locationId,
      action: 'session.updated',
      resourceType: 'session',
      resourceId: id,
      changes,
    });

    // Notify admins if staff made the change
    if (user.role === Role.STAFF && Object.keys(changes).length > 0) {
      const staffUser = await prisma.user.findUnique({ where: { id: user.userId }, select: { fullName: true } });
      const changeDescriptions = Object.entries(changes)
        .map(([key, val]) => `${key}: ${JSON.stringify(val)}`)
        .join(', ');
      await notifyAdminsOfScheduleChange(
        user.userId,
        staffUser?.fullName || 'Staff',
        'updated',
        session.title,
        changeDescriptions
      );
    }

    res.json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/sessions/:id
 * Staff or Admin: soft-delete a session (set isActive = false).
 */
router.delete('/:id', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const user = req.user!;

    const existing = await prisma.session.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound('Session not found');

    // Staff location check
    if (user.role === Role.STAFF) {
      const staffLoc = await prisma.staffLocation.findUnique({
        where: { staffId_locationId: { staffId: user.userId, locationId: existing.locationId } },
      });
      if (!staffLoc) throw ApiError.forbidden('You can only delete sessions at your assigned locations');
    }

    // Soft delete
    await prisma.session.update({
      where: { id },
      data: { isActive: false },
    });

    // Cancel all confirmed bookings for this session and note reason
    const cancelledBookings = await prisma.booking.updateMany({
      where: { sessionId: id, status: 'CONFIRMED' },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancellationReason: 'Session cancelled by staff/admin',
      },
    });

    await createAuditLog({
      userId: user.userId,
      locationId: existing.locationId,
      action: 'session.deleted',
      resourceType: 'session',
      resourceId: id,
      changes: { title: existing.title, cancelledBookings: cancelledBookings.count },
    });

    if (user.role === Role.STAFF) {
      const staffUser = await prisma.user.findUnique({ where: { id: user.userId }, select: { fullName: true } });
      await notifyAdminsOfScheduleChange(
        user.userId,
        staffUser?.fullName || 'Staff',
        'deleted',
        existing.title,
        `Session on ${existing.startTime.toLocaleDateString()} cancelled. ${cancelledBookings.count} booking(s) affected.`
      );
    }

    res.json({
      success: true,
      message: `Session cancelled. ${cancelledBookings.count} booking(s) were automatically cancelled.`,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================
// SCHEDULE TEMPLATES  (Admin only)
// ============================================================

/**
 * GET /api/sessions/templates?locationId=
 * Admin: list schedule templates for a location.
 */
router.get('/templates', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { locationId } = req.query;
    if (!locationId) throw ApiError.badRequest('locationId is required');

    const templates = await prisma.scheduleTemplate.findMany({
      where: { locationId: locationId as string },
      include: {
        room: { select: { id: true, name: true } },
        coach: { select: { id: true, fullName: true } },
      },
      orderBy: [{ dayOfWeek: 'asc' }, { startHour: 'asc' }, { startMinute: 'asc' }],
    });

    res.json({ data: templates });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/sessions/templates
 * Admin: create a schedule template (e.g. "Every Tuesday 3pm College Pitching").
 */
router.post('/templates', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    if (user.role !== Role.ADMIN) throw ApiError.forbidden('Only admins can manage schedule templates');

    const {
      locationId, roomId, coachId, title, sessionType,
      dayOfWeek, startHour, startMinute, durationMinutes,
      maxCapacity, registrationCutoffHours, cancellationCutoffHours,
    } = req.body;

    if (!locationId || !title || !sessionType || dayOfWeek === undefined || startHour === undefined) {
      throw ApiError.badRequest('locationId, title, sessionType, dayOfWeek, and startHour are required');
    }
    if (dayOfWeek < 0 || dayOfWeek > 6) throw ApiError.badRequest('dayOfWeek must be 0-6 (Sunday-Saturday)');
    if (startHour < 0 || startHour > 23) throw ApiError.badRequest('startHour must be 0-23');

    const template = await prisma.scheduleTemplate.create({
      data: {
        locationId,
        roomId: roomId || null,
        coachId: coachId || null,
        title,
        sessionType: sessionType as SessionType,
        dayOfWeek,
        startHour,
        startMinute: startMinute ?? 0,
        durationMinutes: durationMinutes ?? 60,
        maxCapacity: maxCapacity ?? 8,
        registrationCutoffHours: registrationCutoffHours ?? 2,
        cancellationCutoffHours: cancellationCutoffHours ?? 1,
      },
      include: {
        room: { select: { id: true, name: true } },
        coach: { select: { id: true, fullName: true } },
      },
    });

    await createAuditLog({
      userId: user.userId,
      locationId,
      action: 'schedule_template.created',
      resourceType: 'schedule_template',
      resourceId: template.id,
      changes: { title, sessionType, dayOfWeek, startHour },
    });

    res.status(201).json({ data: template });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/sessions/templates/:id
 * Admin: update a schedule template.
 */
router.put('/templates/:id', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    if (user.role !== Role.ADMIN) throw ApiError.forbidden('Only admins can manage schedule templates');

    const id = param(req, 'id');
    const existing = await prisma.scheduleTemplate.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound('Schedule template not found');

    const {
      roomId, coachId, title, sessionType, dayOfWeek,
      startHour, startMinute, durationMinutes, maxCapacity,
      registrationCutoffHours, cancellationCutoffHours, isActive,
    } = req.body;

    const template = await prisma.scheduleTemplate.update({
      where: { id },
      data: {
        ...(roomId !== undefined && { roomId }),
        ...(coachId !== undefined && { coachId }),
        ...(title !== undefined && { title }),
        ...(sessionType !== undefined && { sessionType }),
        ...(dayOfWeek !== undefined && { dayOfWeek }),
        ...(startHour !== undefined && { startHour }),
        ...(startMinute !== undefined && { startMinute }),
        ...(durationMinutes !== undefined && { durationMinutes }),
        ...(maxCapacity !== undefined && { maxCapacity }),
        ...(registrationCutoffHours !== undefined && { registrationCutoffHours }),
        ...(cancellationCutoffHours !== undefined && { cancellationCutoffHours }),
        ...(isActive !== undefined && { isActive }),
      },
      include: {
        room: { select: { id: true, name: true } },
        coach: { select: { id: true, fullName: true } },
      },
    });

    res.json({ data: template });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/sessions/templates/:id
 * Admin: deactivate a schedule template (soft delete).
 */
router.delete('/templates/:id', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    if (user.role !== Role.ADMIN) throw ApiError.forbidden('Only admins can manage schedule templates');

    const id = param(req, 'id');
    await prisma.scheduleTemplate.update({ where: { id }, data: { isActive: false } });
    res.json({ message: 'Template deactivated' });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/sessions/templates/generate
 * Admin: generate sessions from all active templates for the next N weeks.
 * Used by the cron job (see cronService) and can be triggered manually.
 */
router.post('/templates/generate', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    if (user.role !== Role.ADMIN) throw ApiError.forbidden('Only admins can generate sessions from templates');

    const { locationId, weeksAhead = 2 } = req.body;
    if (!locationId) throw ApiError.badRequest('locationId is required');

    const templates = await prisma.scheduleTemplate.findMany({
      where: { locationId, isActive: true },
    });

    if (templates.length === 0) {
      return res.json({ data: { created: 0 }, message: 'No active templates found' });
    }

    const sessionsToCreate: Array<Record<string, unknown>> = [];
    const now = new Date();

    for (let weekOffset = 0; weekOffset < weeksAhead; weekOffset++) {
      for (const tmpl of templates) {
        // Calculate the target date for this template in this week
        const targetDate = new Date(now);
        const currentDay = targetDate.getDay(); // 0=Sun
        const diff = tmpl.dayOfWeek - currentDay + weekOffset * 7;
        targetDate.setDate(targetDate.getDate() + diff);
        targetDate.setHours(tmpl.startHour, tmpl.startMinute, 0, 0);

        // Skip dates in the past
        if (targetDate <= now) continue;

        const endDate = new Date(targetDate);
        endDate.setMinutes(endDate.getMinutes() + tmpl.durationMinutes);

        // Check if a session already exists for this template/time (avoid duplicates)
        const existingSession = await prisma.session.findFirst({
          where: {
            locationId: tmpl.locationId,
            title: tmpl.title,
            sessionType: tmpl.sessionType as SessionType,
            startTime: targetDate,
          },
        });

        if (!existingSession) {
          sessionsToCreate.push({
            locationId: tmpl.locationId,
            roomId: tmpl.roomId,
            coachId: tmpl.coachId,
            title: tmpl.title,
            sessionType: tmpl.sessionType,
            startTime: targetDate,
            endTime: endDate,
            maxCapacity: tmpl.maxCapacity,
            registrationCutoffHours: tmpl.registrationCutoffHours,
            cancellationCutoffHours: tmpl.cancellationCutoffHours,
          });
        }
      }
    }

    let created = 0;
    if (sessionsToCreate.length > 0) {
      const result = await prisma.session.createMany({ data: sessionsToCreate as any });
      created = result.count;
    }

    await createAuditLog({
      userId: user.userId,
      locationId,
      action: 'sessions.generated_from_templates',
      resourceType: 'session',
      changes: { templatesUsed: templates.length, weeksAhead, sessionsCreated: created },
    });

    res.json({
      data: { created, templatesUsed: templates.length, weeksAhead },
      message: `${created} session(s) generated from ${templates.length} template(s)`,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================
// WAITLIST
// ============================================================

/**
 * POST /api/sessions/:id/waitlist
 * Client: join the waitlist for a full session.
 */
router.post('/:id/waitlist', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = param(req, 'id');
    const user = req.user!;

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        _count: { select: { bookings: { where: { status: { in: ['CONFIRMED', 'COMPLETED'] } } } } },
      },
    });

    if (!session || !session.isActive) throw ApiError.notFound('Session not found');

    // Must be full to join waitlist
    if (session._count.bookings < session.maxCapacity) {
      throw ApiError.badRequest('Session has open spots — book directly instead of joining the waitlist');
    }

    // Can't already be booked
    const existingBooking = await prisma.booking.findUnique({
      where: { clientId_sessionId: { clientId: user.userId, sessionId } },
    });
    if (existingBooking && existingBooking.status === 'CONFIRMED') {
      throw ApiError.conflict('You are already booked for this session');
    }

    // Can't already be on waitlist
    const existingWaitlist = await prisma.waitlist.findUnique({
      where: { clientId_sessionId: { clientId: user.userId, sessionId } },
    });
    if (existingWaitlist) {
      throw ApiError.conflict('You are already on the waitlist for this session');
    }

    // Get next position
    const lastInLine = await prisma.waitlist.findFirst({
      where: { sessionId },
      orderBy: { position: 'desc' },
    });
    const position = (lastInLine?.position ?? 0) + 1;

    const entry = await prisma.waitlist.create({
      data: { clientId: user.userId, sessionId, position },
    });

    res.status(201).json({
      data: entry,
      message: `You're #${position} on the waitlist`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/sessions/:id/waitlist
 * Client: remove yourself from the waitlist.
 */
router.delete('/:id/waitlist', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = param(req, 'id');
    const user = req.user!;

    const entry = await prisma.waitlist.findUnique({
      where: { clientId_sessionId: { clientId: user.userId, sessionId } },
    });
    if (!entry) throw ApiError.notFound('You are not on the waitlist for this session');

    await prisma.waitlist.delete({ where: { id: entry.id } });

    // Reorder remaining entries
    const remaining = await prisma.waitlist.findMany({
      where: { sessionId },
      orderBy: { position: 'asc' },
    });
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].position !== i + 1) {
        await prisma.waitlist.update({
          where: { id: remaining[i].id },
          data: { position: i + 1 },
        });
      }
    }

    res.json({ message: 'Removed from waitlist' });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/sessions/:id/waitlist
 * Staff/Admin: see the waitlist for a session.
 */
router.get('/:id/waitlist', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = param(req, 'id');

    const waitlist = await prisma.waitlist.findMany({
      where: { sessionId },
      include: {
        client: { select: { id: true, fullName: true, email: true, phone: true } },
      },
      orderBy: { position: 'asc' },
    });

    res.json({ data: waitlist });
  } catch (error) {
    next(error);
  }
});

export default router;
