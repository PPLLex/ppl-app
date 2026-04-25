import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate, requireStaffOrAdmin } from '../middleware/auth';
import { createAuditLog } from '../services/auditService';
import { notify } from '../services/notificationService';
import {
  buildBookingConfirmationEmail,
  buildBookingCancellationEmail,
} from '../services/emailService';
import { Role, BookingStatus, NotificationType, NotificationChannel, Prisma } from '@prisma/client';

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

    // Capacity will be re-checked inside the transaction below to close the
    // race between two clients seeing the same _count and both inserting.
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

    // Check: liability waiver signed for the athlete(s) this user covers.
    //
    // The booker (req.user.userId) is either the athlete themselves (self
    // account, e.g. college/pro) or a parent (Family.parentUserId). In
    // both cases we require an active signature against the current
    // waiver version for at least one AthleteProfile associated with
    // this user. We block booking if no relevant athlete has signed.
    if (user.role === Role.CLIENT) {
      const bookerUser = await prisma.user.findUnique({
        where: { id: user.userId },
        include: {
          athleteProfile: { select: { id: true } },
          family: { include: { athletes: { select: { id: true } } } },
        },
      });

      const athleteIds = new Set<string>();
      if (bookerUser?.athleteProfile?.id) athleteIds.add(bookerUser.athleteProfile.id);
      if (bookerUser?.family?.athletes) {
        for (const a of bookerUser.family.athletes) athleteIds.add(a.id);
      }

      if (athleteIds.size > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const settings: any = await prisma.orgSettings.findUnique({ where: { id: 'ppl' } });
        const currentVersion = settings?.liabilityWaiverVersion || '2026-04-23';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p: any = prisma;
        const signatures = await p.liabilityWaiverSignature.findMany({
          where: {
            athleteProfileId: { in: Array.from(athleteIds) },
            waiverVersion: currentVersion,
          },
          select: { athleteProfileId: true },
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const signedSet = new Set<string>(signatures.map((s: any) => s.athleteProfileId));
        const anySigned = Array.from(athleteIds).some((id) => signedSet.has(id));
        if (!anySigned) {
          throw ApiError.forbidden(
            'Please sign the liability waiver before booking. You can sign from your dashboard.'
          );
        }
      }
    }

    // Pre-flight: enforce 60-day advance-booking cap for limited plans.
    // (Cheap to check before opening the transaction.)
    if (membership.plan.sessionsPerWeek !== null) {
      const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;
      if (session.startTime.getTime() - Date.now() > SIXTY_DAYS_MS) {
        throw ApiError.badRequest(
          'You can only book sessions up to 60 days in advance.'
        );
      }
    }

    // ============================================================
    // ATOMIC TRANSACTION: capacity recheck → credit deduct → booking insert → counter increment
    // ============================================================
    // Serializable isolation prevents two simultaneous bookings from
    // both passing the capacity check on the same last slot. If a
    // conflict is detected Postgres aborts and Prisma retries (or
    // surfaces an error which Express's error middleware turns into
    // a 5xx — clients can retry safely because the booking row has
    // a unique (clientId, sessionId) constraint).
    //
    // Side effects (notifications, audit log, email) stay OUTSIDE the
    // transaction — they're fire-and-forget and shouldn't roll back
    // a successful booking just because Resend hiccups.
    let creditsUsed = 0;
    const booking = await prisma.$transaction(
      async (tx) => {
        // Re-check capacity using a live count inside the tx — this is the
        // critical anti-race step.
        const liveCount = await tx.booking.count({
          where: {
            sessionId,
            status: { in: ['CONFIRMED', 'COMPLETED'] },
          },
        });
        if (liveCount >= session.maxCapacity) {
          throw ApiError.badRequest('This session is full');
        }

        // Credit deduction (limited plans only). Unlimited plans skip this
        // entire block — only the membership-active check above gates them.
        if (membership.plan.sessionsPerWeek !== null) {
          // Key the WeeklyCredit row to the session's week — this is what
          // lets advance-booking work across weeks without double-spending.
          const weekStart = getWeekStart(session.startTime, membership.billingDay);
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekEnd.getDate() + 7);

          let weeklyCredit = await tx.weeklyCredit.findFirst({
            where: {
              clientId: user.userId,
              membershipId: membership.id,
              weekStartDate: weekStart,
            },
          });

          if (!weeklyCredit) {
            weeklyCredit = await tx.weeklyCredit.create({
              data: {
                clientId: user.userId,
                membershipId: membership.id,
                creditsTotal: membership.plan.sessionsPerWeek!,
                creditsUsed: 0,
                weekStartDate: weekStart,
                weekEndDate: weekEnd,
              },
            });
          }

          const creditsRemaining = weeklyCredit.creditsTotal - weeklyCredit.creditsUsed;
          if (creditsRemaining <= 0) {
            const isFuture = weekStart > new Date();
            const weekLabel = isFuture
              ? `the week of ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
              : 'this week';
            throw ApiError.badRequest(
              `You've used all ${weeklyCredit.creditsTotal} credit(s) for ${weekLabel}.`
            );
          }

          creditsUsed = 1;

          await tx.weeklyCredit.update({
            where: { id: weeklyCredit.id },
            data: { creditsUsed: { increment: 1 } },
          });

          await tx.creditTransaction.create({
            data: {
              clientId: user.userId,
              transactionType: 'usage',
              amount: -1,
              notes: `Booked: ${session.title} on ${session.startTime.toLocaleDateString()}`,
            },
          });
        }

        const created = await tx.booking.upsert({
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

        await tx.session.update({
          where: { id: sessionId },
          data: { currentEnrolled: { increment: 1 } },
        });

        return created;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        // Default 5s timeout is fine — every step is a single primary-key write.
      },
    );

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

    // Resolve the booker's name for the email template. We pull the
    // booker's User row because that's whom we're actually emailing;
    // the athlete name might differ for family-managed accounts but
    // the email subject + salutation always speaks to the account
    // holder.
    const bookerUser = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { fullName: true, homeLocation: { select: { name: true } } },
    });
    const bookingHtml = buildBookingConfirmationEmail({
      athleteName: bookerUser?.fullName || 'Athlete',
      sessionTitle: session.title,
      date: sessionDate,
      time: sessionTime,
      coach: session.coach?.fullName,
      room: session.room?.name,
      location: bookerUser?.homeLocation?.name,
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
      emailHtml: bookingHtml,
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

    // Check cancellation cutoff (4 hours before by default)
    const cutoffTime = new Date(booking.session.startTime);
    cutoffTime.setHours(cutoffTime.getHours() - booking.session.cancellationCutoffHours);

    if (new Date() > cutoffTime && user.role === Role.CLIENT) {
      throw ApiError.forbidden(
        'Cancellation window has closed. Sessions cannot be cancelled within ' +
        `${booking.session.cancellationCutoffHours} hours of the start time.`
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
        // Restore to the SESSION'S week, not the current week — matches
        // the advance-booking model where a credit may live in a future
        // WeeklyCredit row.
        const weekStart = getWeekStart(booking.session.startTime, membership.billingDay);
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
        // Report on the session's week so the message is accurate for
        // advance-booked cancellations too (e.g. "3/5 credits for the
        // week of May 12" instead of lying about "this week").
        const sessionWeekStart = getWeekStart(booking.session.startTime, membership.billingDay);
        const weeklyCredit = await prisma.weeklyCredit.findFirst({
          where: { clientId: booking.clientId, membershipId: membership.id, weekStartDate: sessionWeekStart },
        });
        if (weeklyCredit) {
          const remaining = weeklyCredit.creditsTotal - weeklyCredit.creditsUsed;
          const isFuture = sessionWeekStart > new Date();
          const weekLabel = isFuture
            ? `the week of ${sessionWeekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
            : 'this week';
          creditBalanceMsg = ` Your credit has been restored. Current balance: ${remaining}/${weeklyCredit.creditsTotal} credits for ${weekLabel}.`;
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

    // Send cancellation confirmation — use the rich HTML template.
    const cancelClient = await prisma.user.findUnique({
      where: { id: booking.clientId },
      select: { fullName: true },
    });
    const cancelHtml = buildBookingCancellationEmail({
      athleteName: cancelClient?.fullName || 'Athlete',
      sessionTitle: booking.session.title,
      date: sessionDate,
      time: sessionTime,
      creditRestored,
    });
    await notify({
      userId: booking.clientId,
      type: NotificationType.BOOKING_CANCELLED,
      title: 'Session Cancelled',
      body: `Your ${booking.session.title} session on ${sessionDate} at ${sessionTime} has been cancelled.${creditBalanceMsg}`,
      channels: [NotificationChannel.EMAIL, NotificationChannel.SMS],
      metadata: { bookingId, sessionId: booking.sessionId, creditRestored },
      emailHtml: cancelHtml,
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
 * PATCH /api/bookings/:id/reschedule
 *
 * Move a confirmed booking to a different session in one atomic step.
 * This is the equivalent of "cancel + rebook" but performed inside a
 * single Serializable transaction so the user never ends up with neither
 * slot (a partial-failure window the cancel-then-rebook pattern leaves
 * open). Body: { newSessionId: string }.
 *
 * Rules enforced:
 *   - Caller must own the booking (or be admin/staff)
 *   - Original booking must be CONFIRMED
 *   - We respect the original booking's cancellation cutoff
 *   - We respect the new session's registration cutoff + capacity
 *   - Credits move from the OLD session's week to the NEW session's week,
 *     creating the destination WeeklyCredit row if it doesn't exist yet
 *   - Audit log + cancellation/confirmation emails fire on success
 */
router.patch('/:id/reschedule', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bookingId = param(req, 'id');
    const user = req.user!;
    const { newSessionId } = req.body as { newSessionId?: string };
    if (!newSessionId) throw ApiError.badRequest('newSessionId is required');

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        session: {
          include: {
            room: { select: { id: true, name: true } },
            coach: { select: { id: true, fullName: true } },
          },
        },
      },
    });
    if (!booking) throw ApiError.notFound('Booking not found');

    if (user.role === Role.CLIENT && booking.clientId !== user.userId) {
      throw ApiError.forbidden('You can only reschedule your own bookings');
    }
    if (booking.status !== 'CONFIRMED') {
      throw ApiError.badRequest('Only confirmed bookings can be rescheduled');
    }
    if (booking.sessionId === newSessionId) {
      throw ApiError.badRequest('That is the same session you are already booked for');
    }

    // Cancellation cutoff for the OLD session — we treat reschedule as a
    // cancellation of the old slot, so the same window applies. Admins +
    // staff bypass.
    const oldCutoff = new Date(booking.session.startTime);
    oldCutoff.setHours(oldCutoff.getHours() - booking.session.cancellationCutoffHours);
    if (new Date() > oldCutoff && user.role === Role.CLIENT) {
      throw ApiError.forbidden(
        'Cancellation window has closed. Sessions cannot be rescheduled within ' +
          `${booking.session.cancellationCutoffHours} hours of the start time.`
      );
    }

    // Load the new session + its current confirmed-booking count
    const newSession = await prisma.session.findUnique({
      where: { id: newSessionId },
      include: {
        room: { select: { name: true } },
        coach: { select: { fullName: true } },
        _count: {
          select: { bookings: { where: { status: { in: ['CONFIRMED', 'COMPLETED'] } } } },
        },
      },
    });
    if (!newSession || !newSession.isActive) {
      throw ApiError.notFound('Target session not found or no longer available');
    }

    // Same location (cross-location moves are out of scope — ask user to
    // cancel + rebook manually if they really need to)
    if (newSession.locationId !== booking.session.locationId) {
      throw ApiError.badRequest('Cannot reschedule across locations');
    }

    // Registration cutoff on the destination session
    const newCutoff = new Date(newSession.startTime);
    newCutoff.setHours(newCutoff.getHours() - newSession.registrationCutoffHours);
    if (new Date() > newCutoff) {
      throw ApiError.badRequest(
        `Registration closed ${newSession.registrationCutoffHours} hour(s) before the new session starts`
      );
    }

    // Membership still active?
    const membership = await prisma.clientMembership.findFirst({
      where: { clientId: booking.clientId, status: 'ACTIVE', locationId: newSession.locationId },
      include: { plan: true },
    });
    if (!membership) {
      throw ApiError.forbidden('No active membership at this location');
    }

    // ============================================================
    // Atomic move.
    // ============================================================
    await prisma.$transaction(
      async (tx) => {
        // Capacity recheck inside tx
        const liveCount = await tx.booking.count({
          where: { sessionId: newSessionId, status: { in: ['CONFIRMED', 'COMPLETED'] } },
        });
        if (liveCount >= newSession.maxCapacity) {
          throw ApiError.badRequest('The target session is full');
        }

        // 1) Cancel old booking
        await tx.booking.update({
          where: { id: bookingId },
          data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
            cancellationReason: `Rescheduled to ${newSession.title} on ${newSession.startTime.toISOString()}`,
          },
        });
        await tx.session.update({
          where: { id: booking.sessionId },
          data: { currentEnrolled: { decrement: 1 } },
        });

        // 2) Move credit (limited plans only)
        if (membership.plan.sessionsPerWeek !== null && booking.creditsUsed > 0) {
          // Restore to old session's week
          const oldWeekStart = getWeekStart(booking.session.startTime, membership.billingDay);
          await tx.weeklyCredit.updateMany({
            where: {
              clientId: booking.clientId,
              membershipId: membership.id,
              weekStartDate: oldWeekStart,
            },
            data: { creditsUsed: { decrement: booking.creditsUsed } },
          });

          // Deduct from new session's week (create row if needed)
          const newWeekStart = getWeekStart(newSession.startTime, membership.billingDay);
          const newWeekEnd = new Date(newWeekStart);
          newWeekEnd.setDate(newWeekEnd.getDate() + 7);

          let newWeeklyCredit = await tx.weeklyCredit.findFirst({
            where: {
              clientId: booking.clientId,
              membershipId: membership.id,
              weekStartDate: newWeekStart,
            },
          });
          if (!newWeeklyCredit) {
            newWeeklyCredit = await tx.weeklyCredit.create({
              data: {
                clientId: booking.clientId,
                membershipId: membership.id,
                creditsTotal: membership.plan.sessionsPerWeek!,
                creditsUsed: 0,
                weekStartDate: newWeekStart,
                weekEndDate: newWeekEnd,
              },
            });
          }
          const remaining = newWeeklyCredit.creditsTotal - newWeeklyCredit.creditsUsed;
          if (remaining <= 0) {
            const isFuture = newWeekStart > new Date();
            const weekLabel = isFuture
              ? `the week of ${newWeekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
              : 'this week';
            throw ApiError.badRequest(
              `You've used all ${newWeeklyCredit.creditsTotal} credit(s) for ${weekLabel} — pick a different week or cancel a future booking first.`
            );
          }
          await tx.weeklyCredit.update({
            where: { id: newWeeklyCredit.id },
            data: { creditsUsed: { increment: 1 } },
          });

          await tx.creditTransaction.create({
            data: {
              clientId: booking.clientId,
              transactionType: 'reschedule',
              amount: 0, // net zero — credit moved, not consumed
              bookingId,
              notes: `Rescheduled from ${booking.session.title} (${booking.session.startTime.toLocaleDateString()}) to ${newSession.title} (${newSession.startTime.toLocaleDateString()})`,
            },
          });
        }

        // 3) Create new booking
        await tx.booking.upsert({
          where: { clientId_sessionId: { clientId: booking.clientId, sessionId: newSessionId } },
          create: {
            clientId: booking.clientId,
            sessionId: newSessionId,
            status: 'CONFIRMED',
            creditsUsed: booking.creditsUsed,
          },
          update: {
            status: 'CONFIRMED',
            creditsUsed: booking.creditsUsed,
            cancelledAt: null,
            cancellationReason: null,
          },
        });
        await tx.session.update({
          where: { id: newSessionId },
          data: { currentEnrolled: { increment: 1 } },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    // Side effects (notification + audit) outside the tx
    const newDate = newSession.startTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const newTime = newSession.startTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const userRow = await prisma.user.findUnique({
      where: { id: booking.clientId },
      select: { fullName: true, homeLocation: { select: { name: true } } },
    });
    const confirmHtml = buildBookingConfirmationEmail({
      athleteName: userRow?.fullName || 'Athlete',
      sessionTitle: newSession.title,
      date: newDate,
      time: newTime,
      coach: newSession.coach?.fullName,
      room: newSession.room?.name,
      location: userRow?.homeLocation?.name,
    });
    await notify({
      userId: booking.clientId,
      type: NotificationType.BOOKING_CONFIRMED,
      title: 'Session Rescheduled',
      body: `Your booking has been moved to ${newSession.title} on ${newDate} at ${newTime}.`,
      channels: [NotificationChannel.EMAIL, NotificationChannel.SMS],
      metadata: { bookingId, fromSessionId: booking.sessionId, toSessionId: newSessionId },
      emailHtml: confirmHtml,
    });

    await createAuditLog({
      userId: user.userId,
      locationId: newSession.locationId,
      action: 'booking.rescheduled',
      resourceType: 'booking',
      resourceId: bookingId,
      changes: {
        from: { sessionId: booking.sessionId, title: booking.session.title, startTime: booking.session.startTime },
        to: { sessionId: newSessionId, title: newSession.title, startTime: newSession.startTime },
      },
    });

    res.json({
      success: true,
      message: `Rescheduled to ${newSession.title} on ${newDate} at ${newTime}.`,
      data: { newSessionId, newStartTime: newSession.startTime },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/bookings/my-week
 * Client: get current week's bookings + credit balance + membership info for My Week card.
 */
router.get('/my-week', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;

    // Get active membership with plan details
    const membership = await prisma.clientMembership.findFirst({
      where: { clientId: user.userId, status: 'ACTIVE' },
      include: { plan: true },
    });

    if (!membership) {
      return res.json({
        success: true,
        data: {
          membership: null,
          bookings: [],
          credits: null,
        },
      });
    }

    // Get this week's bookings
    const weekStart = getWeekStart(new Date(), membership.billingDay);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const bookings = await prisma.booking.findMany({
      where: {
        clientId: user.userId,
        status: 'CONFIRMED',
        session: {
          startTime: { gte: weekStart, lt: weekEnd },
        },
      },
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

    // Get credit balance (for limited plans)
    let credits = null;
    if (membership.plan.sessionsPerWeek !== null) {
      const weeklyCredit = await prisma.weeklyCredit.findFirst({
        where: {
          clientId: user.userId,
          membershipId: membership.id,
          weekStartDate: weekStart,
        },
      });

      credits = {
        total: membership.plan.sessionsPerWeek,
        used: weeklyCredit?.creditsUsed || 0,
        remaining: membership.plan.sessionsPerWeek - (weeklyCredit?.creditsUsed || 0),
      };
    }

    // Cancellation cutoff info for each booking
    const bookingsWithCancelInfo = bookings.map((b) => {
      const cutoffTime = new Date(b.session.startTime);
      cutoffTime.setHours(cutoffTime.getHours() - b.session.cancellationCutoffHours);
      const canCancel = new Date() < cutoffTime;

      return {
        ...b,
        canCancel,
        cancellationCutoff: cutoffTime.toISOString(),
      };
    });

    res.json({
      success: true,
      data: {
        membership: {
          planName: membership.plan.name,
          ageGroup: membership.plan.ageGroup,
          sessionsPerWeek: membership.plan.sessionsPerWeek,
          isUnlimited: membership.plan.sessionsPerWeek === null,
          billingDay: membership.billingDay,
        },
        bookings: bookingsWithCancelInfo,
        credits,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/bookings/batch
 * Client: book multiple sessions at once ("Plan my week" mode).
 * Validates credits for all sessions before booking any.
 */
router.post('/batch', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const { sessionIds } = req.body;

    if (!sessionIds || !Array.isArray(sessionIds) || sessionIds.length === 0) {
      throw ApiError.badRequest('At least one session ID is required');
    }

    if (sessionIds.length > 7) {
      throw ApiError.badRequest('Cannot book more than 7 sessions at once');
    }

    // Get active membership
    const membership = await prisma.clientMembership.findFirst({
      where: { clientId: user.userId, status: 'ACTIVE' },
      include: { plan: true },
    });

    if (!membership) {
      throw ApiError.forbidden('You need an active membership to book sessions.');
    }

    // Check credits up front for limited plans
    let creditsAvailable = Infinity;
    let weeklyCredit: { id: string; creditsTotal: number; creditsUsed: number } | null = null;

    if (membership.plan.sessionsPerWeek !== null) {
      const weekStart = getWeekStart(new Date(), membership.billingDay);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);

      const existing = await prisma.weeklyCredit.findFirst({
        where: {
          clientId: user.userId,
          membershipId: membership.id,
          weekStartDate: weekStart,
        },
      });

      if (!existing) {
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
      } else {
        weeklyCredit = existing;
      }

      creditsAvailable = weeklyCredit.creditsTotal - weeklyCredit.creditsUsed;

      if (sessionIds.length > creditsAvailable) {
        throw ApiError.badRequest(
          `You only have ${creditsAvailable} credit(s) remaining this week, but tried to book ${sessionIds.length} session(s).`
        );
      }
    }

    // Validate all sessions exist and are bookable
    const sessions = await prisma.session.findMany({
      where: { id: { in: sessionIds }, isActive: true },
      include: {
        room: { select: { id: true, name: true } },
        coach: { select: { id: true, fullName: true } },
        _count: { select: { bookings: { where: { status: { in: ['CONFIRMED', 'COMPLETED'] } } } } },
      },
    });

    if (sessions.length !== sessionIds.length) {
      throw ApiError.notFound('One or more sessions not found or unavailable');
    }

    const errors: string[] = [];
    for (const session of sessions) {
      // Location check
      if (user.role === Role.CLIENT && user.homeLocationId !== session.locationId) {
        errors.push(`${session.title}: wrong location`);
        continue;
      }
      // Cutoff check
      const cutoff = new Date(session.startTime);
      cutoff.setHours(cutoff.getHours() - session.registrationCutoffHours);
      if (new Date() > cutoff) {
        errors.push(`${session.title}: registration closed`);
        continue;
      }
      // Capacity check
      if (session._count.bookings >= session.maxCapacity) {
        errors.push(`${session.title}: full`);
      }
    }

    if (errors.length > 0) {
      throw ApiError.badRequest(`Cannot book all sessions: ${errors.join('; ')}`);
    }

    // Check for existing bookings
    const existingBookings = await prisma.booking.findMany({
      where: {
        clientId: user.userId,
        sessionId: { in: sessionIds },
        status: 'CONFIRMED',
      },
    });
    const alreadyBooked = new Set(existingBookings.map((b) => b.sessionId));
    const newSessionIds = sessionIds.filter((id: string) => !alreadyBooked.has(id));

    if (newSessionIds.length === 0) {
      throw ApiError.conflict('You are already booked for all selected sessions');
    }

    // Book all sessions in a transaction
    const creditsPerSession = membership.plan.sessionsPerWeek !== null ? 1 : 0;
    const results = await prisma.$transaction(async (tx) => {
      const booked = [];

      for (const sessionId of newSessionIds) {
        const booking = await tx.booking.upsert({
          where: { clientId_sessionId: { clientId: user.userId, sessionId } },
          create: {
            clientId: user.userId,
            sessionId,
            status: 'CONFIRMED',
            creditsUsed: creditsPerSession,
          },
          update: {
            status: 'CONFIRMED',
            creditsUsed: creditsPerSession,
            cancelledAt: null,
            cancellationReason: null,
          },
        });

        await tx.session.update({
          where: { id: sessionId },
          data: { currentEnrolled: { increment: 1 } },
        });

        booked.push(booking);
      }

      // Deduct all credits at once
      if (weeklyCredit && creditsPerSession > 0) {
        await tx.weeklyCredit.update({
          where: { id: weeklyCredit.id },
          data: { creditsUsed: { increment: newSessionIds.length } },
        });

        // Log credit transactions
        for (const sessionId of newSessionIds) {
          const session = sessions.find((s) => s.id === sessionId)!;
          await tx.creditTransaction.create({
            data: {
              clientId: user.userId,
              transactionType: 'usage',
              amount: -1,
              notes: `Booked: ${session.title} on ${session.startTime.toLocaleDateString()}`,
            },
          });
        }
      }

      return booked;
    });

    // Send batch confirmation notification
    const sessionTitles = newSessionIds.map((id: string) => {
      const s = sessions.find((s) => s.id === id)!;
      const day = s.startTime.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const time = s.startTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      return `${s.title} (${day} at ${time})`;
    });

    await notify({
      userId: user.userId,
      type: NotificationType.BOOKING_CONFIRMED,
      title: `${results.length} Session${results.length > 1 ? 's' : ''} Booked!`,
      body: `You're booked for: ${sessionTitles.join(', ')}`,
      channels: [NotificationChannel.EMAIL, NotificationChannel.SMS],
      metadata: { bookingIds: results.map((b) => b.id), sessionIds: newSessionIds },
    });

    res.status(201).json({
      success: true,
      data: results,
      message: `${results.length} session${results.length > 1 ? 's' : ''} booked successfully!`,
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
          session: { select: { id: true, title: true, locationId: true } },
          client: { select: { fullName: true } },
        },
      });

      // Keep currentEnrolled in sync with the live count. Going CONFIRMED →
      // NO_SHOW drops the live count by 1 because NO_SHOW isn't included in
      // the capacity-eligible set; without this recalc the denormalized
      // counter drifts from reality.
      await recalculateCurrentEnrolled(booking.session.id);

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
 * Recompute Session.currentEnrolled from the live booking count.
 *
 * The denormalized `currentEnrolled` column gets manually +1/-1'd on book
 * and cancel — but the capacity-eligible booking statuses are only
 * CONFIRMED + COMPLETED. When a booking transitions CONFIRMED → NO_SHOW
 * the live count drops by 1 while currentEnrolled stays put, and the
 * displayed seat count drifts. Calling this helper anywhere a transition
 * out of {CONFIRMED, COMPLETED} happens keeps the column in sync.
 *
 * Cheap (single COUNT + single UPDATE) and idempotent — safe to call even
 * if the count was already correct.
 */
export async function recalculateCurrentEnrolled(sessionId: string): Promise<number> {
  const liveCount = await prisma.booking.count({
    where: {
      sessionId,
      status: { in: ['CONFIRMED', 'COMPLETED'] },
    },
  });
  await prisma.session.update({
    where: { id: sessionId },
    data: { currentEnrolled: liveCount },
  });
  return liveCount;
}

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
