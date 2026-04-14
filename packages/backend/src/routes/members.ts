import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate, requireStaffOrAdmin, requireAdmin } from '../middleware/auth';
import { Role } from '@prisma/client';

const router = Router();

function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

/**
 * GET /api/members
 * Admin/Staff: list all clients with optional filters.
 */
router.get('/', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { search, locationId, ageGroup, status, page = '1', limit = '50' } = req.query;
    const user = req.user!;

    const where: Record<string, unknown> = { role: Role.CLIENT, isActive: true };

    // Staff can only see clients at their locations
    if (user.role === Role.STAFF) {
      // Get staff's assigned locations
      const staffLocations = await prisma.staffLocation.findMany({
        where: { staffId: user.userId },
        select: { locationId: true },
      });
      const locationIds = staffLocations.map((sl) => sl.locationId);
      where.homeLocationId = { in: locationIds };
    }

    if (locationId) where.homeLocationId = locationId;

    // Search by name or email
    if (search) {
      where.OR = [
        { fullName: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const pageNum = parseInt(page as string) || 1;
    const limitNum = parseInt(limit as string) || 50;
    const skip = (pageNum - 1) * limitNum;

    const [clients, total] = await Promise.all([
      prisma.user.findMany({
        where: where as any,
        include: {
          clientProfile: true,
          homeLocation: { select: { id: true, name: true } },
          clientMemberships: {
            where: { status: { in: ['ACTIVE', 'PAST_DUE'] } },
            include: { plan: { select: { id: true, name: true, sessionsPerWeek: true, priceCents: true } } },
            take: 1,
            orderBy: { startedAt: 'desc' },
          },
          _count: {
            select: {
              bookings: { where: { status: { in: ['CONFIRMED', 'COMPLETED'] } } },
            },
          },
        },
        orderBy: { fullName: 'asc' },
        skip,
        take: limitNum,
      }),
      prisma.user.count({ where: where as any }),
    ]);

    // Filter by age group at application level (clientProfile relation)
    let filtered = clients;
    if (ageGroup) {
      filtered = clients.filter((c) => c.clientProfile?.ageGroup === ageGroup);
    }

    // Filter by membership status
    if (status === 'active') {
      filtered = filtered.filter((c) => c.clientMemberships.length > 0 && c.clientMemberships[0].status === 'ACTIVE');
    } else if (status === 'past_due') {
      filtered = filtered.filter((c) => c.clientMemberships.length > 0 && c.clientMemberships[0].status === 'PAST_DUE');
    } else if (status === 'no_membership') {
      filtered = filtered.filter((c) => c.clientMemberships.length === 0);
    }

    const data = filtered.map((c) => ({
      id: c.id,
      fullName: c.fullName,
      email: c.email,
      phone: c.phone,
      ageGroup: c.clientProfile?.ageGroup || null,
      location: c.homeLocation,
      membership: c.clientMemberships.length > 0
        ? {
            status: c.clientMemberships[0].status,
            plan: c.clientMemberships[0].plan,
          }
        : null,
      totalBookings: c._count.bookings,
      joinedAt: c.createdAt,
      notes: c.clientProfile?.notes || null,
      trainingGoals: c.clientProfile?.trainingGoals || null,
    }));

    res.json({
      success: true,
      data,
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/members/:id
 * Admin/Staff: get detailed client profile.
 */
router.get('/:id', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clientId = param(req, 'id');

    const client = await prisma.user.findUnique({
      where: { id: clientId },
      include: {
        clientProfile: true,
        homeLocation: { select: { id: true, name: true } },
        clientMemberships: {
          include: {
            plan: true,
            location: { select: { id: true, name: true } },
          },
          orderBy: { startedAt: 'desc' },
        },
        bookings: {
          include: {
            session: {
              include: {
                room: { select: { name: true } },
                coach: { select: { fullName: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!client || client.role !== Role.CLIENT) {
      throw ApiError.notFound('Client not found');
    }

    res.json({ success: true, data: client });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/members/:id/notes
 * Staff/Admin: update client notes.
 */
router.put('/:id/notes', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clientId = param(req, 'id');
    const { notes, trainingGoals } = req.body;

    const profile = await prisma.clientProfile.update({
      where: { userId: clientId },
      data: {
        ...(notes !== undefined && { notes }),
        ...(trainingGoals !== undefined && { trainingGoals }),
      },
    });

    res.json({ success: true, data: profile });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/members/:id/deactivate
 * Admin: deactivate a client account.
 */
router.put(
  '/:id/deactivate',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clientId = param(req, 'id');

      await prisma.user.update({
        where: { id: clientId },
        data: { isActive: false },
      });

      res.json({ success: true, message: 'Client account deactivated.' });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
