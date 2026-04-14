import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();

/** Helper to safely extract a single string param */
function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

/**
 * GET /api/locations
 * List all active locations (public — needed for registration)
 */
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const locations = await prisma.location.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        timezone: true,
        operatingHours: true,
        closedDay: true,
      },
      orderBy: { name: 'asc' },
    });

    res.json({ success: true, data: locations });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/locations/:id
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const location = await prisma.location.findUnique({
      where: { id },
      include: {
        rooms: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!location) throw ApiError.notFound('Location not found');
    res.json({ success: true, data: location });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/locations
 * Admin-only: create a new location
 */
router.post('/', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, address, phone, timezone, operatingHours, closedDay } = req.body;

    if (!name) throw ApiError.badRequest('Location name is required');

    const location = await prisma.location.create({
      data: {
        name,
        address,
        phone,
        timezone: timezone || 'America/Chicago',
        operatingHours,
        closedDay,
      },
    });

    res.status(201).json({ success: true, data: location });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/locations/:id
 * Admin-only: update a location
 */
router.put('/:id', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const { name, address, phone, timezone, operatingHours, closedDay, isActive } = req.body;

    const location = await prisma.location.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(address !== undefined && { address }),
        ...(phone !== undefined && { phone }),
        ...(timezone !== undefined && { timezone }),
        ...(operatingHours !== undefined && { operatingHours }),
        ...(closedDay !== undefined && { closedDay }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    res.json({ success: true, data: location });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/locations/:id/rooms
 * Admin-only: add a room to a location
 */
router.post('/:id/rooms', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const { name, sortOrder } = req.body;

    if (!name) throw ApiError.badRequest('Room name is required');

    const location = await prisma.location.findUnique({ where: { id } });
    if (!location) throw ApiError.notFound('Location not found');

    const room = await prisma.room.create({
      data: {
        locationId: id,
        name,
        sortOrder: sortOrder || 0,
      },
    });

    res.status(201).json({ success: true, data: room });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/locations/:locationId/clients/:clientId
 * Admin-only: reassign a client's home location
 */
router.put(
  '/:locationId/clients/:clientId',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const locationId = param(req, 'locationId');
      const clientId = param(req, 'clientId');

      const location = await prisma.location.findUnique({ where: { id: locationId } });
      if (!location || !location.isActive) throw ApiError.notFound('Location not found');

      const user = await prisma.user.update({
        where: { id: clientId },
        data: { homeLocationId: locationId },
        include: {
          homeLocation: { select: { id: true, name: true } },
        },
      });

      res.json({
        success: true,
        data: {
          id: user.id,
          fullName: user.fullName,
          homeLocation: user.homeLocation,
        },
        message: `${user.fullName} has been reassigned to ${location.name}`,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
