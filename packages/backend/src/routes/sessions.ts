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

export default router;
