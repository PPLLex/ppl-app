import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { kioskPinLimiter } from '../middleware/rateLimit';
import { BookingStatus } from '@prisma/client';

const router = Router();

// Every kiosk route validates the PIN in the body/query. Apply the
// aggressive rate limiter globally so a brute-forcer can't rotate
// endpoints to extend their attempt budget.
router.use(kioskPinLimiter);

/**
 * POST /api/kiosk/auth
 * Validate a kiosk PIN and return the location info + today's sessions.
 * No user auth required — PIN is the access control.
 *
 * Rate-limited aggressively: a 4-digit PIN has 10,000 combinations, so
 * without limiting an attacker could brute-force the whole space in a
 * few hours. 10 attempts per 15 min per IP makes that infeasible.
 */
router.post('/auth', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { pin } = req.body;
    if (!pin || typeof pin !== 'string') {
      throw ApiError.badRequest('PIN is required');
    }

    const location = await prisma.location.findFirst({
      where: { kioskPin: pin, isActive: true },
      select: { id: true, name: true, address: true },
    });

    if (!location) {
      throw ApiError.unauthorized('Invalid kiosk PIN');
    }

    res.json({ success: true, data: location });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/kiosk/sessions?pin=XXXX
 * Get today's sessions for the location matching the PIN.
 * Returns session list with rosters for check-in.
 */
router.get('/sessions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pin = req.query.pin as string;
    if (!pin) throw ApiError.badRequest('PIN is required');

    // Validate PIN
    const location = await prisma.location.findFirst({
      where: { kioskPin: pin, isActive: true },
      select: { id: true, name: true, timezone: true },
    });
    if (!location) throw ApiError.unauthorized('Invalid kiosk PIN');

    // Get today's date range in the location's timezone
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    const sessions = await prisma.session.findMany({
      where: {
        locationId: location.id,
        startTime: { gte: todayStart },
        endTime: { lte: todayEnd },
        isActive: true,
      },
      include: {
        room: { select: { id: true, name: true } },
        coach: { select: { id: true, fullName: true } },
        bookings: {
          where: {
            status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW'] },
          },
          include: {
            client: {
              select: {
                id: true,
                fullName: true,
              },
            },
          },
          orderBy: { client: { fullName: 'asc' } },
        },
      },
      orderBy: { startTime: 'asc' },
    });

    const result = sessions.map((s) => {
      const isActive = now >= new Date(s.startTime) && now <= new Date(s.endTime);
      const isPast = now > new Date(s.endTime);
      const confirmed = s.bookings.filter((b) => b.status === 'CONFIRMED').length;
      const checkedIn = s.bookings.filter((b) => b.status === 'COMPLETED').length;

      return {
        id: s.id,
        title: s.title,
        sessionType: s.sessionType,
        startTime: s.startTime.toISOString(),
        endTime: s.endTime.toISOString(),
        maxCapacity: s.maxCapacity,
        isActive,
        isPast,
        room: s.room,
        coach: s.coach,
        stats: { confirmed, checkedIn, total: s.bookings.length },
        roster: s.bookings.map((b) => ({
          bookingId: b.id,
          clientId: b.client.id,
          clientName: b.client.fullName,
          status: b.status,
        })),
      };
    });

    res.json({
      success: true,
      data: {
        location: { id: location.id, name: location.name },
        sessions: result,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/kiosk/checkin
 * Self-service check-in — athlete taps their name.
 * Requires PIN + bookingId.
 */
router.post('/checkin', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { pin, bookingId } = req.body;
    if (!pin || !bookingId) {
      throw ApiError.badRequest('PIN and booking ID are required');
    }

    // Validate PIN
    const location = await prisma.location.findFirst({
      where: { kioskPin: pin, isActive: true },
      select: { id: true },
    });
    if (!location) throw ApiError.unauthorized('Invalid kiosk PIN');

    // Get the booking and verify it belongs to this location
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        session: { select: { id: true, locationId: true, title: true, startTime: true, endTime: true } },
        client: { select: { id: true, fullName: true } },
      },
    });

    if (!booking) throw ApiError.notFound('Booking not found');
    if (booking.session.locationId !== location.id) {
      throw ApiError.forbidden('Booking does not belong to this location');
    }
    if (booking.status !== 'CONFIRMED') {
      throw ApiError.badRequest(
        booking.status === 'COMPLETED'
          ? 'Already checked in!'
          : `Cannot check in — booking is ${booking.status.toLowerCase()}`
      );
    }

    // Perform the check-in
    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.COMPLETED,
      },
    });

    res.json({
      success: true,
      message: `${booking.client.fullName} checked in!`,
      data: {
        clientName: booking.client.fullName,
        sessionTitle: booking.session.title,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
