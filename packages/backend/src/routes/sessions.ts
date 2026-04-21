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

    // Age-group filtering: clients only see sessions matching their membership age group
    if (user.role === Role.CLIENT && !type) {
      const membership = await prisma.clientMembership.findFirst({
        where: { clientId: user.userId, status: 'ACTIVE', locationId: filterLocationId },
        include: { plan: true },
      });
      if (membership) {
        const ageGroupToSessionType: Record<string, SessionType> = {
          college: SessionType.COLLEGE_PITCHING,
          ms_hs: SessionType.MS_HS_PITCHING,
          youth: SessionType.YOUTH_PITCHING,
        };
        const mapped = ageGroupToSessionType[membership.plan.ageGroup];
        if (mapped) {
          where.sessionType = mapped;
        }
      }
    } else if (type) {
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
 * GET /api/sessions/today
 * Staff/Admin: get all sessions for today at the user's location, with roster and check-in status.
 * Designed for the front-desk check-in tablet.
 */
router.get('/today', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const locationId = (req.query.locationId as string) || user.homeLocationId;

    if (!locationId) {
      throw ApiError.badRequest('Location ID is required');
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const sessions = await prisma.session.findMany({
      where: {
        locationId,
        isActive: true,
        startTime: { gte: todayStart, lte: todayEnd },
      },
      include: {
        room: { select: { id: true, name: true } },
        coach: { select: { id: true, fullName: true } },
        bookings: {
          where: { status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW'] } },
          include: {
            client: {
              select: {
                id: true,
                fullName: true,
                email: true,
                phone: true,
                clientProfile: { select: { ageGroup: true } },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        _count: {
          select: {
            bookings: { where: { status: { in: ['CONFIRMED', 'COMPLETED'] } } },
          },
        },
      },
      orderBy: { startTime: 'asc' },
    });

    const data = sessions.map((s) => {
      const now = new Date();
      const isActive = now >= s.startTime && now <= s.endTime;
      const isPast = now > s.endTime;
      const checkedIn = s.bookings.filter((b) => b.status === 'COMPLETED').length;
      const noShows = s.bookings.filter((b) => b.status === 'NO_SHOW').length;
      const pending = s.bookings.filter((b) => b.status === 'CONFIRMED').length;

      return {
        id: s.id,
        title: s.title,
        sessionType: s.sessionType,
        startTime: s.startTime.toISOString(),
        endTime: s.endTime.toISOString(),
        maxCapacity: s.maxCapacity,
        room: s.room,
        coach: s.coach,
        isActive,
        isPast,
        stats: { checkedIn, noShows, pending, total: s.bookings.length },
        roster: s.bookings.map((b) => ({
          bookingId: b.id,
          clientId: b.client.id,
          clientName: b.client.fullName,
          phone: b.client.phone,
          status: b.status,
        })),
      };
    });

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
      // Legacy fields (still supported)
      recurringRule,
      recurringCount,
      // New recurring fields
      isRecurring,
      recurringDays,     // number[] — days of week (0=Sun, 1=Mon, ..., 6=Sat)
      recurringEndDate,  // ISO date string — last date to generate sessions
      startDate,         // ISO date string — date for one-time or start of recurring
      time,              // "HH:MM" — session start time
      durationMinutes,   // number — session length in minutes
    } = req.body;

    const user = req.user!;

    // Support both old format (startTime/endTime) and new format (startDate + time + durationMinutes)
    const useNewFormat = startDate && time && durationMinutes;

    if (!useNewFormat && (!startTime || !endTime)) {
      throw ApiError.badRequest('Either startDate+time+durationMinutes or startTime+endTime are required');
    }
    if (!locationId || !sessionType) {
      throw ApiError.badRequest('Location and session type are required');
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

    // Auto-set title based on session type if not provided
    const sessionTitle = title || sessionType.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

    const sessionsToCreate: Array<Record<string, unknown>> = [];
    const recurringGroupId = (isRecurring || recurringRule) ? randomUUID() : null;

    if (useNewFormat) {
      // NEW FORMAT: date + time + duration + optional recurring
      const [hours, minutes] = time.split(':').map(Number);
      const duration = durationMinutes || 60;

      if (isRecurring && recurringDays && recurringDays.length > 0 && recurringEndDate) {
        // RECURRING: generate sessions for each selected day of week until end date
        const endDateLimit = new Date(recurringEndDate);
        endDateLimit.setHours(23, 59, 59, 999);
        const currentDate = new Date(startDate);
        currentDate.setHours(0, 0, 0, 0);

        // Cap at 365 days to prevent accidental huge generation
        const maxEndDate = new Date(currentDate);
        maxEndDate.setFullYear(maxEndDate.getFullYear() + 1);
        const effectiveEnd = endDateLimit < maxEndDate ? endDateLimit : maxEndDate;

        while (currentDate <= effectiveEnd) {
          const dayOfWeek = currentDate.getDay();
          if (recurringDays.includes(dayOfWeek)) {
            const sessionStart = new Date(currentDate);
            sessionStart.setHours(hours, minutes, 0, 0);
            const sessionEnd = new Date(sessionStart);
            sessionEnd.setMinutes(sessionEnd.getMinutes() + duration);

            // Only create future sessions
            if (sessionStart > new Date()) {
              sessionsToCreate.push({
                locationId,
                roomId: roomId || null,
                coachId: user.userId,
                title: sessionTitle,
                sessionType: sessionType as SessionType,
                startTime: sessionStart,
                endTime: sessionEnd,
                maxCapacity: maxCapacity || 8,
                registrationCutoffHours: registrationCutoffHours ?? 2,
                cancellationCutoffHours: cancellationCutoffHours ?? 1,
                recurringRule: `days:${recurringDays.join(',')}|until:${recurringEndDate}`,
                recurringGroupId,
              });
            }
          }
          currentDate.setDate(currentDate.getDate() + 1);
        }

        if (sessionsToCreate.length === 0) {
          throw ApiError.badRequest('No sessions would be created — check your date range and selected days');
        }
      } else {
        // ONE-TIME: single session on the selected date
        const sessionStart = new Date(startDate);
        sessionStart.setHours(hours, minutes, 0, 0);
        const sessionEnd = new Date(sessionStart);
        sessionEnd.setMinutes(sessionEnd.getMinutes() + duration);

        sessionsToCreate.push({
          locationId,
          roomId: roomId || null,
          coachId: user.userId,
          title: sessionTitle,
          sessionType: sessionType as SessionType,
          startTime: sessionStart,
          endTime: sessionEnd,
          maxCapacity: maxCapacity || 8,
          registrationCutoffHours: registrationCutoffHours ?? 2,
          cancellationCutoffHours: cancellationCutoffHours ?? 1,
          recurringRule: null,
          recurringGroupId: null,
        });
      }
    } else {
      // LEGACY FORMAT: startTime/endTime with optional recurringCount
      const start = new Date(startTime);
      const end = new Date(endTime);
      const count = recurringCount || 1;
      for (let i = 0; i < count; i++) {
        const sessionStart = new Date(start);
        const sessionEnd = new Date(end);
        sessionStart.setDate(sessionStart.getDate() + i * 7);
        sessionEnd.setDate(sessionEnd.getDate() + i * 7);
        sessionsToCreate.push({
          locationId,
          roomId: roomId || null,
          coachId: user.userId,
          title: sessionTitle,
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
    }

    const created = await prisma.session.createMany({ data: sessionsToCreate as any });

    // Audit log
    await createAuditLog({
      userId: user.userId,
      locationId,
      action: 'session.created',
      resourceType: 'session',
      changes: {
        title: sessionTitle,
        sessionType,
        count: sessionsToCreate.length,
        recurringGroupId,
        isRecurring: !!isRecurring,
        recurringDays: recurringDays || null,
        recurringEndDate: recurringEndDate || null,
      },
    });

    // Notify admins if a staff member made the change
    if (user.role === Role.STAFF) {
      const staffUser = await prisma.user.findUnique({ where: { id: user.userId }, select: { fullName: true } });
      const firstSession = sessionsToCreate[0];
      const firstStart = firstSession.startTime as Date;
      await notifyAdminsOfScheduleChange(
        user.userId,
        staffUser?.fullName || 'Staff',
        'created',
        sessionTitle,
        `${sessionsToCreate.length} session(s) starting ${firstStart.toLocaleDateString()} at ${firstStart.toLocaleTimeString()}`
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
// RECURRING SERIES MANAGEMENT
// ============================================================

/**
 * GET /api/sessions/series/:groupId
 * Staff/Admin: view all sessions in a recurring group.
 * Shows past, current, and future sessions grouped together.
 */
router.get('/series/:groupId', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const groupId = param(req, 'groupId');

    const sessions = await prisma.session.findMany({
      where: { recurringGroupId: groupId },
      include: {
        room: { select: { id: true, name: true } },
        coach: { select: { id: true, fullName: true } },
        _count: { select: { bookings: { where: { status: { in: ['CONFIRMED', 'COMPLETED'] } } } } },
      },
      orderBy: { startTime: 'asc' },
    });

    if (sessions.length === 0) {
      throw ApiError.notFound('No sessions found for this recurring group');
    }

    const now = new Date();
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
      room: s.room,
      coach: s.coach,
      isActive: s.isActive,
      isPast: s.startTime < now,
      recurringGroupId: s.recurringGroupId,
      recurringRule: s.recurringRule,
    }));

    const first = sessions[0];
    const activeSessions = sessions.filter(s => s.isActive);
    const futureSessions = activeSessions.filter(s => s.startTime > now);

    res.json({
      success: true,
      data: {
        groupId,
        title: first.title,
        sessionType: first.sessionType,
        locationId: first.locationId,
        recurringRule: first.recurringRule,
        totalSessions: sessions.length,
        activeSessions: activeSessions.length,
        futureSessions: futureSessions.length,
        firstDate: sessions[0].startTime.toISOString(),
        lastDate: sessions[sessions.length - 1].startTime.toISOString(),
        sessions: data,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/sessions/series/:groupId
 * Staff/Admin: edit all FUTURE sessions in a recurring series.
 * Only modifies sessions that haven't happened yet.
 * Body: { title?, roomId?, coachId?, maxCapacity?, sessionType?,
 *         registrationCutoffHours?, cancellationCutoffHours?, time?, durationMinutes? }
 */
router.put('/series/:groupId', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const groupId = param(req, 'groupId');
    const user = req.user!;

    // Get the series sessions
    const sessions = await prisma.session.findMany({
      where: { recurringGroupId: groupId, isActive: true },
      orderBy: { startTime: 'asc' },
    });

    if (sessions.length === 0) {
      throw ApiError.notFound('No active sessions found for this recurring group');
    }

    // Staff location check
    if (user.role === Role.STAFF) {
      const staffLoc = await prisma.staffLocation.findUnique({
        where: { staffId_locationId: { staffId: user.userId, locationId: sessions[0].locationId } },
      });
      if (!staffLoc) throw ApiError.forbidden('You can only edit sessions at your assigned locations');
    }

    const {
      title, roomId, coachId, sessionType, maxCapacity,
      registrationCutoffHours, cancellationCutoffHours,
      time, durationMinutes,
    } = req.body;

    const now = new Date();
    const futureSessionIds = sessions.filter(s => s.startTime > now).map(s => s.id);

    if (futureSessionIds.length === 0) {
      throw ApiError.badRequest('No future sessions to update — all sessions in this series are in the past');
    }

    // Build update data
    const updateData: Record<string, unknown> = {};
    if (title !== undefined) updateData.title = title;
    if (roomId !== undefined) updateData.roomId = roomId || null;
    if (coachId !== undefined) updateData.coachId = coachId || null;
    if (sessionType !== undefined) updateData.sessionType = sessionType;
    if (maxCapacity !== undefined) updateData.maxCapacity = maxCapacity;
    if (registrationCutoffHours !== undefined) updateData.registrationCutoffHours = registrationCutoffHours;
    if (cancellationCutoffHours !== undefined) updateData.cancellationCutoffHours = cancellationCutoffHours;

    // If time or duration changes, update each session individually to preserve dates
    if (time || durationMinutes) {
      const [newHours, newMinutes] = time ? time.split(':').map(Number) : [null, null];
      const newDuration = durationMinutes || null;

      for (const session of sessions.filter(s => s.startTime > now)) {
        const newStart = new Date(session.startTime);
        if (newHours !== null && newMinutes !== null) {
          newStart.setHours(newHours, newMinutes, 0, 0);
        }
        const dur = newDuration || ((session.endTime.getTime() - session.startTime.getTime()) / 60000);
        const newEnd = new Date(newStart);
        newEnd.setMinutes(newEnd.getMinutes() + dur);

        await prisma.session.update({
          where: { id: session.id },
          data: {
            ...updateData,
            startTime: newStart,
            endTime: newEnd,
          },
        });
      }
    } else if (Object.keys(updateData).length > 0) {
      // Bulk update if no time changes
      await prisma.session.updateMany({
        where: { id: { in: futureSessionIds } },
        data: updateData as any,
      });
    }

    await createAuditLog({
      userId: user.userId,
      locationId: sessions[0].locationId,
      action: 'session.series_updated',
      resourceType: 'session',
      changes: {
        recurringGroupId: groupId,
        sessionsUpdated: futureSessionIds.length,
        ...updateData,
        ...(time && { time }),
        ...(durationMinutes && { durationMinutes }),
      },
    });

    if (user.role === Role.STAFF) {
      const staffUser = await prisma.user.findUnique({ where: { id: user.userId }, select: { fullName: true } });
      await notifyAdminsOfScheduleChange(
        user.userId,
        staffUser?.fullName || 'Staff',
        'updated series',
        sessions[0].title,
        `${futureSessionIds.length} future session(s) updated`
      );
    }

    res.json({
      success: true,
      data: { updated: futureSessionIds.length, groupId },
      message: `${futureSessionIds.length} future session(s) updated in series`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/sessions/series/:groupId
 * Staff/Admin: cancel all FUTURE sessions in a recurring series.
 * Past sessions are untouched. All confirmed bookings on cancelled sessions are auto-cancelled.
 * Query: ?fromDate=ISO — only cancel sessions from this date forward (optional)
 */
router.delete('/series/:groupId', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const groupId = param(req, 'groupId');
    const user = req.user!;
    const fromDate = req.query.fromDate ? new Date(req.query.fromDate as string) : new Date();

    const sessions = await prisma.session.findMany({
      where: {
        recurringGroupId: groupId,
        isActive: true,
        startTime: { gt: fromDate },
      },
      include: {
        _count: { select: { bookings: { where: { status: 'CONFIRMED' } } } },
      },
    });

    if (sessions.length === 0) {
      return res.json({ success: true, data: { cancelled: 0 }, message: 'No future sessions to cancel' });
    }

    // Staff location check
    if (user.role === Role.STAFF) {
      const staffLoc = await prisma.staffLocation.findUnique({
        where: { staffId_locationId: { staffId: user.userId, locationId: sessions[0].locationId } },
      });
      if (!staffLoc) throw ApiError.forbidden('You can only cancel sessions at your assigned locations');
    }

    const sessionIds = sessions.map(s => s.id);

    // Soft delete all future sessions in the series
    await prisma.session.updateMany({
      where: { id: { in: sessionIds } },
      data: { isActive: false },
    });

    // Cancel all confirmed bookings on those sessions
    const cancelledBookings = await prisma.booking.updateMany({
      where: {
        sessionId: { in: sessionIds },
        status: 'CONFIRMED',
      },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancellationReason: 'Recurring series cancelled by staff/admin',
      },
    });

    const totalBookingsAffected = sessions.reduce((sum, s) => sum + s._count.bookings, 0);

    await createAuditLog({
      userId: user.userId,
      locationId: sessions[0].locationId,
      action: 'session.series_deleted',
      resourceType: 'session',
      changes: {
        recurringGroupId: groupId,
        sessionsCancelled: sessionIds.length,
        bookingsCancelled: cancelledBookings.count,
      },
    });

    if (user.role === Role.STAFF) {
      const staffUser = await prisma.user.findUnique({ where: { id: user.userId }, select: { fullName: true } });
      await notifyAdminsOfScheduleChange(
        user.userId,
        staffUser?.fullName || 'Staff',
        'cancelled series',
        sessions[0].title,
        `${sessionIds.length} session(s) cancelled. ${cancelledBookings.count} booking(s) affected.`
      );
    }

    res.json({
      success: true,
      data: {
        cancelled: sessionIds.length,
        bookingsAffected: cancelledBookings.count,
        groupId,
      },
      message: `${sessionIds.length} session(s) cancelled. ${cancelledBookings.count} booking(s) were automatically cancelled.`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/sessions/series/:groupId/extend
 * Admin: extend a recurring series by generating more sessions beyond the current end date.
 * Body: { newEndDate: ISO string, additionalWeeks?: number }
 */
router.post('/series/:groupId/extend', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const groupId = param(req, 'groupId');
    const user = req.user!;
    if (user.role !== Role.ADMIN) throw ApiError.forbidden('Only admins can extend recurring series');

    const { newEndDate, additionalWeeks } = req.body;

    // Get existing sessions in this group to determine the pattern
    const existingSessions = await prisma.session.findMany({
      where: { recurringGroupId: groupId },
      orderBy: { startTime: 'asc' },
    });

    if (existingSessions.length === 0) {
      throw ApiError.notFound('No sessions found for this recurring group');
    }

    const first = existingSessions[0];
    const last = existingSessions[existingSessions.length - 1];

    // Determine the recurring days from existing sessions
    const daySet = new Set(existingSessions.map(s => s.startTime.getDay()));
    const recurringDays = Array.from(daySet).sort();

    // Calculate duration from first session
    const durationMinutes = (first.endTime.getTime() - first.startTime.getTime()) / 60000;
    const startHour = first.startTime.getHours();
    const startMinute = first.startTime.getMinutes();

    // Determine the end date
    let endDateLimit: Date;
    if (newEndDate) {
      endDateLimit = new Date(newEndDate);
    } else if (additionalWeeks) {
      endDateLimit = new Date(last.startTime);
      endDateLimit.setDate(endDateLimit.getDate() + additionalWeeks * 7);
    } else {
      throw ApiError.badRequest('Either newEndDate or additionalWeeks is required');
    }
    endDateLimit.setHours(23, 59, 59, 999);

    // Start generating from the day after the last existing session
    const currentDate = new Date(last.startTime);
    currentDate.setDate(currentDate.getDate() + 1);
    currentDate.setHours(0, 0, 0, 0);

    const sessionsToCreate: Array<Record<string, unknown>> = [];
    const now = new Date();

    while (currentDate <= endDateLimit) {
      const dayOfWeek = currentDate.getDay();
      if (recurringDays.includes(dayOfWeek)) {
        const sessionStart = new Date(currentDate);
        sessionStart.setHours(startHour, startMinute, 0, 0);
        const sessionEnd = new Date(sessionStart);
        sessionEnd.setMinutes(sessionEnd.getMinutes() + durationMinutes);

        if (sessionStart > now) {
          // Check for duplicate
          const exists = await prisma.session.findFirst({
            where: {
              locationId: first.locationId,
              title: first.title,
              sessionType: first.sessionType,
              startTime: sessionStart,
            },
          });

          if (!exists) {
            sessionsToCreate.push({
              locationId: first.locationId,
              roomId: first.roomId,
              coachId: first.coachId,
              title: first.title,
              sessionType: first.sessionType,
              startTime: sessionStart,
              endTime: sessionEnd,
              maxCapacity: first.maxCapacity,
              registrationCutoffHours: first.registrationCutoffHours,
              cancellationCutoffHours: first.cancellationCutoffHours,
              recurringRule: first.recurringRule,
              recurringGroupId: groupId,
            });
          }
        }
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    let created = 0;
    if (sessionsToCreate.length > 0) {
      const result = await prisma.session.createMany({ data: sessionsToCreate as any });
      created = result.count;
    }

    await createAuditLog({
      userId: user.userId,
      locationId: first.locationId,
      action: 'session.series_extended',
      resourceType: 'session',
      changes: {
        recurringGroupId: groupId,
        sessionsAdded: created,
        newEndDate: endDateLimit.toISOString(),
      },
    });

    res.status(201).json({
      success: true,
      data: { created, groupId },
      message: `${created} new session(s) added to series through ${endDateLimit.toLocaleDateString()}`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/sessions/conflicts?locationId=&start=&end=
 * Staff/Admin: check for overlapping sessions at a location within a date range.
 * Useful before creating sessions to prevent double-booking rooms or coaches.
 */
router.get('/conflicts', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { locationId, start, end, roomId, coachId } = req.query;

    if (!locationId || !start || !end) {
      throw ApiError.badRequest('locationId, start, and end are required');
    }

    const startDate = new Date(start as string);
    const endDate = new Date(end as string);

    const where: Record<string, unknown> = {
      locationId: locationId as string,
      isActive: true,
      OR: [
        // Session starts during the time window
        { startTime: { gte: startDate, lt: endDate } },
        // Session ends during the time window
        { endTime: { gt: startDate, lte: endDate } },
        // Session spans the entire time window
        { AND: [{ startTime: { lte: startDate } }, { endTime: { gte: endDate } }] },
      ],
    };

    // Optional: narrow by room or coach
    if (roomId) where.roomId = roomId as string;
    if (coachId) where.coachId = coachId as string;

    const conflicting = await prisma.session.findMany({
      where: where as any,
      include: {
        room: { select: { id: true, name: true } },
        coach: { select: { id: true, fullName: true } },
      },
      orderBy: { startTime: 'asc' },
    });

    res.json({
      success: true,
      data: {
        hasConflicts: conflicting.length > 0,
        count: conflicting.length,
        conflicts: conflicting.map(s => ({
          id: s.id,
          title: s.title,
          sessionType: s.sessionType,
          startTime: s.startTime.toISOString(),
          endTime: s.endTime.toISOString(),
          room: s.room,
          coach: s.coach,
        })),
      },
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
// STAFF CHECK-IN (continued — bulk check-in)
// ============================================================

/**
 * POST /api/sessions/:id/checkin
 * Staff/Admin: bulk check-in — mark multiple bookings at once.
 * Body: { bookingIds: string[], status: 'COMPLETED' | 'NO_SHOW' }
 */
router.post('/:id/checkin', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = param(req, 'id');
    const user = req.user!;
    const { bookingIds, status } = req.body;

    if (!bookingIds || !Array.isArray(bookingIds) || bookingIds.length === 0) {
      throw ApiError.badRequest('At least one booking ID is required');
    }
    if (!status || !['COMPLETED', 'NO_SHOW'].includes(status)) {
      throw ApiError.badRequest('Status must be COMPLETED or NO_SHOW');
    }

    // Verify all bookings belong to this session
    const bookings = await prisma.booking.findMany({
      where: {
        id: { in: bookingIds },
        sessionId,
      },
      include: {
        client: { select: { fullName: true } },
      },
    });

    if (bookings.length !== bookingIds.length) {
      throw ApiError.badRequest('One or more booking IDs are invalid for this session');
    }

    // Bulk update
    await prisma.booking.updateMany({
      where: { id: { in: bookingIds }, sessionId },
      data: { status },
    });

    // Get session for audit log
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { locationId: true, title: true },
    });

    // Audit each
    for (const booking of bookings) {
      await createAuditLog({
        userId: user.userId,
        locationId: session?.locationId || '',
        action: `booking.${status.toLowerCase()}`,
        resourceType: 'booking',
        resourceId: booking.id,
        changes: { clientName: booking.client.fullName, status, bulkCheckin: true },
      });
    }

    res.json({
      success: true,
      data: { updated: bookings.length },
      message: `${bookings.length} athlete${bookings.length !== 1 ? 's' : ''} marked as ${
        status === 'COMPLETED' ? 'checked in' : 'no-show'
      }`,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================
// ATTENDANCE VIOLATIONS (Roster Management)
// ============================================================

/**
 * GET /api/sessions/:id/roster
 * Staff/Admin: get session roster — booked athletes + any violations logged.
 */
router.get('/:id/roster', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = param(req, 'id');

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        bookings: {
          where: { status: { in: ['CONFIRMED', 'COMPLETED'] } },
          include: {
            client: { select: { id: true, fullName: true, email: true, phone: true } },
          },
        },
        attendanceViolations: {
          include: {
            client: { select: { id: true, fullName: true, email: true, phone: true } },
            assessedBy: { select: { id: true, fullName: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!session) throw ApiError.notFound('Session not found');

    res.json({
      success: true,
      data: {
        session: {
          id: session.id,
          title: session.title,
          sessionType: session.sessionType,
          startTime: session.startTime.toISOString(),
          endTime: session.endTime.toISOString(),
          maxCapacity: session.maxCapacity,
        },
        roster: session.bookings.map((b) => ({
          bookingId: b.id,
          client: b.client,
          status: b.status,
          bookedAt: b.createdAt,
        })),
        violations: session.attendanceViolations,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/sessions/:id/violations
 * Staff/Admin: log an attendance violation (no-signup or wrong-time).
 * Body: { clientId, type: 'NO_SIGNUP' | 'WRONG_TIME', notes? }
 */
router.post('/:id/violations', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = param(req, 'id');
    const user = req.user!;
    const { clientId, type, notes } = req.body;

    if (!clientId || !type) {
      throw ApiError.badRequest('clientId and violation type are required');
    }
    if (!['NO_SIGNUP', 'WRONG_TIME'].includes(type)) {
      throw ApiError.badRequest('type must be NO_SIGNUP or WRONG_TIME');
    }

    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw ApiError.notFound('Session not found');

    // Determine fine amount
    const amountCents = type === 'NO_SIGNUP' ? 2000 : 1000; // $20 or $10

    const violation = await prisma.attendanceViolation.create({
      data: {
        clientId,
        sessionId,
        locationId: session.locationId,
        type,
        amountCents,
        notes: notes || null,
        assessedById: user.userId,
      },
      include: {
        client: { select: { id: true, fullName: true, email: true } },
        assessedBy: { select: { id: true, fullName: true } },
      },
    });

    await createAuditLog({
      userId: user.userId,
      locationId: session.locationId,
      action: 'attendance_violation.created',
      resourceType: 'attendance_violation',
      resourceId: violation.id,
      changes: {
        clientId,
        type,
        amountCents,
        sessionTitle: session.title,
      },
    });

    res.status(201).json({
      success: true,
      data: violation,
      message: `${type === 'NO_SIGNUP' ? '$20 no-signup' : '$10 wrong-time'} violation logged for ${violation.client.fullName}`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/sessions/violations/:violationId/waive
 * Admin: waive a violation fine.
 */
router.put('/violations/:violationId/waive', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    if (user.role !== Role.ADMIN) throw ApiError.forbidden('Only admins can waive fines');

    const violationId = param(req, 'violationId');
    const violation = await prisma.attendanceViolation.findUnique({ where: { id: violationId } });
    if (!violation) throw ApiError.notFound('Violation not found');

    const updated = await prisma.attendanceViolation.update({
      where: { id: violationId },
      data: {
        status: 'WAIVED',
        waivedAt: new Date(),
        waivedById: user.userId,
      },
    });

    res.json({ success: true, data: updated, message: 'Fine waived' });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/sessions/violations/pending?locationId=
 * Staff/Admin: list all pending (unpaid) violations at a location.
 */
router.get('/violations/pending', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { locationId } = req.query;

    const where: Record<string, unknown> = { status: 'PENDING' };
    if (locationId) where.locationId = locationId as string;

    const violations = await prisma.attendanceViolation.findMany({
      where: where as any,
      include: {
        client: { select: { id: true, fullName: true, email: true, phone: true } },
        session: { select: { id: true, title: true, startTime: true } },
        assessedBy: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalPendingCents = violations.reduce((sum, v) => sum + v.amountCents, 0);

    res.json({
      success: true,
      data: violations,
      summary: {
        count: violations.length,
        totalPendingCents,
        totalPendingDollars: (totalPendingCents / 100).toFixed(2),
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
