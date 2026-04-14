import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate, requireAdmin } from '../middleware/auth';
import { createAuditLog } from '../services/auditService';
import { Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const router = Router();

function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

// All staff routes require admin
router.use(authenticate, requireAdmin);

/**
 * GET /api/staff
 * List all staff and admin users.
 */
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const staff = await prisma.user.findMany({
      where: {
        role: { in: [Role.ADMIN, Role.STAFF] },
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        staffLocations: {
          select: {
            location: {
              select: { id: true, name: true },
            },
          },
        },
      },
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
    });

    // Flatten staffLocations to locations array
    const result = staff.map((s: any) => ({
      id: s.id,
      fullName: s.fullName,
      email: s.email,
      phone: s.phone,
      role: s.role,
      locations: s.staffLocations.map((sl: any) => sl.location),
    }));

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/staff/invite
 * Create a new staff/admin user account.
 */
router.post('/invite', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { fullName, email, password, role, phone } = req.body;

    if (!fullName || !email || !password) {
      throw ApiError.badRequest('Name, email, and password are required');
    }

    // Check for existing user
    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) throw ApiError.conflict('A user with this email already exists');

    // Validate role
    const userRole = role === 'ADMIN' ? Role.ADMIN : Role.STAFF;

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        fullName,
        phone: phone || null,
        role: userRole,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
      },
    });

    await createAuditLog({
      action: 'STAFF_INVITED',
      userId: req.user!.userId,
      resourceType: 'User',
      resourceId: user.id,
      changes: { fullName, email, role: userRole },
    });

    res.status(201).json({
      success: true,
      data: { ...user, locations: [] },
      message: `${userRole === Role.ADMIN ? 'Admin' : 'Staff'} account created for ${fullName}`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/staff/:id/role
 * Update a staff member's role.
 */
router.put('/:id/role', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = param(req, 'id');
    const { role } = req.body;

    if (!role || !['ADMIN', 'STAFF'].includes(role)) {
      throw ApiError.badRequest('Role must be ADMIN or STAFF');
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { role: role as Role },
      select: { id: true, fullName: true, role: true },
    });

    await createAuditLog({
      action: 'ROLE_CHANGED',
      userId: req.user!.userId,
      resourceType: 'User',
      resourceId: userId,
      changes: { newRole: role },
    });

    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/staff/:id/locations
 * Assign locations to a staff member.
 */
router.put('/:id/locations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = param(req, 'id');
    const { locationIds } = req.body as { locationIds: string[] };

    if (!Array.isArray(locationIds)) {
      throw ApiError.badRequest('locationIds must be an array');
    }

    // Remove existing assignments
    await prisma.staffLocation.deleteMany({ where: { userId } });

    // Create new assignments
    if (locationIds.length > 0) {
      await prisma.staffLocation.createMany({
        data: locationIds.map((locationId) => ({ userId, locationId })),
      });
    }

    await createAuditLog({
      action: 'STAFF_LOCATIONS_UPDATED',
      userId: req.user!.userId,
      resourceType: 'User',
      resourceId: userId,
      changes: { locationIds },
    });

    res.json({ success: true, message: 'Location assignments updated' });
  } catch (error) {
    next(error);
  }
});

export default router;
