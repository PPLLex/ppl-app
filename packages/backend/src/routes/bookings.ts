import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate, requireStaffOrAdmin } from '../middleware/auth';
import { createAuditLog } from '../services/auditService';
import { notify } from '../services/notificationService';
import { Role, BookingStatus, NotificationType, NotificationChannel } from '@prisma/client';

const router = Router();

function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

/**
 * POST /api/bookings
 * Client: book a session. Validates credits, capacity, cutoff time.
 */
router.post('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const { sessionId } = req.body;

    if (!sessionId) throw ApiError.badRequest('Session ID is required');

    // Get the session
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        room: { select: { id: true, name: true } },
        coach: { select: { id: true, fullName: true } },
        _count: { select: { bookings: { where: { status: { in: ['CONFIRMED', 'COMPLETED'] } } } } },
      },
    });

    if (!session || !session.isActive) {
      throw ApiError.notFound('Session not found or is no longer available');
    }

    // Check: client's home location matches session location
    if (user.role === Role.CLIENT && user.homeLocationId !== session.locationId) {
      throw ApiError.forbidden('This session is at a different location than your home location');
    }

    // Check: registration cutoff (2 hours before by default)
    const cutoffTime = new Date(session.startTime);
    cutoffTime.setHours(cutoffTime.getHours() - session.registrationCutoffHours);
    if (new Date() > cutoffTime) {
      throw ApiError.badRequest(
        `Registration closed ${session.registrationCutoffHours} hour(s) before the session starts`
      );
    }

    // Check: not already booked
    const existingBooking = await prisma.booking.findUnique({
      where: { clientId_sessionId: { clientId: user.userId, sessionId } },
    });
    if (existingBooking && existingBooking.status === 'CONFIRMED') {
      throw ApiError.conflict('You are already booked for this session');
    }

    // Check: capacity
    if (session._count.bookings >= session.maxCapacity) {
      throw ApiError.badRequest('This session is full');
    }

    // Check: active membership
    const membership = await prisma.clientMembership.findFirst({
      where: {
        clientId: user.userId,
        status: 'ACTIVE',
        locationId: session.locationId,
      },
      include: { plan: true },
    });

    if (!membership) {
      throw ApiError.forbidden('You need an active membership to book sessions. Please set up your membership first.');
    }

    // Check: credits (for limited plans)
    let creditsUsed = 0;
    if (membership.plan.sessionsPerWeek !== null) {
      // Limited plan — check weekly credits
      const now = new Date();
      const weekStart = getWeekStart(now, membership.billingDay);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);

      let weeklyCredit = await prisma.weeklyCredit.findFirst({
        where: {
          clientId: user.userId,
          membershipId: membership.id,
          weekStartDate: weekStart,
        },
      });

      // Create weekly credit record if it doesn't exist yet
      if (!weeklyCredit) {
        weeklyCredit = await prisma.weeklyCredit.create({
          data: {
            clientId: user.userId,
            membershipId: membership.id,
            creditsTotal: membership.plan.sessionsPerWeek,
            creditsUsed: 0,
            weekStartDate: weekStart,
            weekEndDate: weekEnd,
          },
        });
      }

      const creditsRemaining = weeklyCredit.creditsTotal - weeklyCredit.creditsUsed;
      if (creditsRemaining <= 0) {
        throw ApiError.badRequest(
          `You've used all ${weeklyCredit.creditsTotal} credit(s) for this week. Credits reset on your billing day (${membership.billingDay}).`
        );
      }

      creditsUsed = 1;

      // Deduct credit
      await prisma.weeklyCredit.update({
        where: { id: weeklyCredit.id },
        data: { creditsUsed: { increment: 1 } },
      });

      // Log the credit transaction
      await prisma.creditTransaction.create({
        data: {
          clientId: user.userId,
          transactionType: 'usage',
          amount: -1,
          notes: `Booked: ${session.title} on ${session.startTime.toLocaleDateString()}`,
        },
      });
    }
    // Unlimited plans: no credit check needed, just verify active membership (already done)

    // Create the booking
    const booking = await prisma.booking.upsert({
      where: { clientId_sessionId: { clientId: user.userId, sessionId } },
      create: {
        clientId: user.userId,
        sessionId,
        status: 'CONFIRMED',
        creditsUsed,
      },
      update: {
        status: 'CONFIRMED',
        creditsUsed,
        cancelledAt: null,
        cancellationReason: null,
      },
      include: {
        session: {
          include: {
            room: { select: { name: true } },
            coach: { select: { fullName: true } },
          },
        },
      },
    });

    // Update session enrolled count
    await prisma.session.update({
      where: { id: sessionId },
      data: { currentEnrolled: { increment: 1 } },
    });

    // Send booking confirmation notification
    const sessionDate = session.startTime.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    const sessionTime = session.startTime.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });

    await notify({
      userId: user.userId,
      type: NotificationType.BOOKING_CONFIRMED,
      title: 'Session Booked!',
      body: `You're booked for ${session.title} on ${sessionDate} at ${sessionTime}.${
        session.room ? ` Room: ${session.room.name}.` : ''
      }${session.coach ? ` Coach: ${session.coach.fullName}.` : ''}`,
      channels: [NotificationChannel.EMAIL, NotificationChannel.SMS],
      metadata: { bookingId: booking.id, sessionId: session.id },
    });

    await createAuditLog({
      userId: user.userId,
      locationId: session.locationId,
      action: 'booking.created',
      resourceType: 'booking',
      resourceId: booking.id,
      changes: { sessionTitle: session.title, creditsUsed },
    });

    res.status(201).json({
      success: true,
      data: booking,
      message: `You're booked for ${session.title} on ${sessionDate} at ${sessionTime}!`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/bookings/:id
 * Client: cancel a booking. Credit is auto-restored if within cancellation window.
 */
router.delete('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bookingId = param(req, 'id');
    const user = req.user!;

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        session: {
          include: {
            room: { select: { name: true } },
            coach: { select: { fullName: true } },
          },
        },
      },
    });

    if (!booking) throw ApiError.notFound('Booking not found');

    // Only the client who booked or admin/staff can cancel
    if (user.role === Role.CLIENT && booking.clientId !== user.userId) {
      throw ApiError.forbidden('You can only cancel your own bookings');
    }

    if (booking.status !== 'CONFIRMED') {
      throw ApiError.badRequest('This booking is not in a cancellable state');
    }

    // Check cancellation cutoff (1 hour before by default)
    const cutoffTime = new Date(booking.session.startTime);
    cutoffTime.setHours(cutoffTime.getHours() - booking.session.cancellationCutoffHours);

    if (new Date() > cutoffTime && user.role === Role.CLIENT) {
      throw ApiError.badRequest(
        `Cancellation window has closed. You can cancel up to ${booking.session.cancellationCutoffHours} hour(s) before the session.`
      );
    }

    // Cancel the booking
    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancellationReason: req.body?.reason || 'Cancelled by client',
      },
    });

    // Decrement session enrolled count
    await prisma.session.update({
      where: { id: booking.sessionId },
      data: { currentEnrolled: { decrement: 1 } },
    });

    // Restore credit if it was a limited plan
    let creditRestored = false;
    if (booking.creditsUsed > 0) {
      // Find the weekly credit record and restore
      const membership = await prisma.clientMembership.findFirst({
        where: { clientId: booking.clientId, status: 'ACTIVE' },
        include: { plan: true },
      });

      if (membership && membership.plan.sessionsPerWeek !== null) {
        const weekStart = getWeekStart(new Date(), membership.billingDay);
        await prisma.weeklyCredit.updateMany({
          where: {
            clientId: booking.clientId,
            membershipId: membership.id,
            weekStartDate: weekStart,
          },
          data: { creditsUsed: { decrement: 1 } },
        });

        await prisma.creditTransaction.create({
          data: {
            clientId: booking.clientId,
            transactionType: 'refund',
            amount: 1,
            bookingId,
            notes: `Cancellation refund: ${booking.session.title}`,
          },
        });

        creditRestored = true;
      }
    }

    // Get updated credit balance for the notification
    let creditBalanceMsg = '';
    if (creditRestored) {
      const membership = await prisma.clientMembership.findFirst({
        where: { clientId: booking.clientId, status: 'ACTIVE' },
      });
      if (membership) {
        const weekStart = getWeekStart(new Date(), membership.billingDay);
        const weeklyCredit = await prisma.weeklyCredit.findFirst({
          where: { clientId: booking.clientId, membershipId: membership.id, weekStartDate: weekStart },
        });
        if (weeklyCredit) {
          const remaining = weeklyCredit.creditsTotal - weeklyCredit.creditsUsed;
          creditBalanceMsg = ` Your credit has been restored. Current balance: ${remaining}/${weeklyCredit.creditsTotal} credits this week.`;
        }
      }
    }

    const sessionDate = booking.session.startTime.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    const sessionTime = booking.session.startTime.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });

    // Send cancellation confirmation
    await notify({
      userId: booking.clientId,
      type: NotificationType.BOOKING_CANCELLED,
      title: 'Session Cancelled',
      body: `Your ${booking.session.title} session on ${sessionDate} at ${sessionTime} has been cancelled.${creditBalanceMsg}`,
      channels: [NotificationChannel.EMAIL, NotificationChannel.SMS],
      metadata: { bookingId, sessionId: booking.sessionId, creditRestored },
    });

    await createAuditLog({
      userId: user.userId,
      locationId: booking.session.locationId,
      action: 'booking.cancelled',
      resourceType: 'booking',
      resourceId: bookingId,
      changes: {
        sessionTitle: booking.session.title,
        creditRestored,
        cancelledBy: user.role,
      },
    });

    res.json({
      success: true,
      message: `Session cancelled.${creditRestored ? ' Your credit has been restored to your account.' : ''}`,
      data: { creditRestored },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/bookings/my
 * Client: get all my bookings (upcoming and past).
 */
router.get('/my', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const { status, upcoming } = req.query;

    const where: Record<string, unknown> = { clientId: user.userId };
    if (status) where.status = status;
    if (upcoming === 'true') {
      where.session = { startTime: { gte: new Date() } };
    }

    const bookings = await prisma.booking.findMany({
      where: where as any,
      include: {
        session: {
          include: {
            room: { select: { id: true, name: true } },
            coach: { select: { id: true, fullName: true } },
          },
        },
      },
      orderBy: { session: { startTime: 'asc' } },
    });

    res.json({ success: true, data: bookings });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/bookings/:id/attendance
 * Staff/Admin: mark attendance (completed or no-show).
 */
router.put(
  '/:id/attendance',
  authenticate,
  requireStaffOrAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const bookingId = param(req, 'id');
      const { status } = req.body;

      if (!status || !['COMPLETED', 'NO_SHOW'].includes(status)) {
        throw ApiError.badRequest('Status must be COMPLETED or NO_SHOW');
      }

      const booking = await prisma.booking.update({
        where: { id: bookingId },
        data: { status: status as BookingStatus },
        include: {
          session: { select: { title: true, locationId: true } },
          client: { select: { fullName: true } },
        },
      });

      await createAuditLog({
        userId: req.user!.userId,
        locationId: booking.session.locationId,
        action: `booking.${status.toLowerCase()}`,
        resourceType: 'booking',
        resourceId: bookingId,
        changes: { clientName: booking.client.fullName, status },
      });

      res.json({
        success: true,
        data: booking,
        message: `${booking.client.fullName} marked as ${status === 'COMPLETED' ? 'attended' : 'no-show'}`,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Helper: Calculate the start of the billing week based on billing day.
 */
function getWeekStart(date: Date, billingDay: string): Date {
  const d = new Date(date);
  const dayMap: Record<string, number> = { MONDAY: 1, THURSDAY: 4 };
  const targetDay = dayMap[billingDay] || 1;
  const currentDay = d.getDay();

  // Calculate days since last billing day
  let diff = currentDay - targetDay;
  if (diff < 0) diff += 7;

  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ============================================================
// WAITLIST PROMOTION HELPER
// ============================================================

export default router;
