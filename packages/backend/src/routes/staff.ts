import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate, requireAdmin } from '../middleware/auth';
import { createAuditLog } from '../services/auditService';
import { Role, LocationRole } from '@prisma/client';
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
            locationRole: true,
            location: {
              select: { id: true, name: true },
            },
          },
        },
      },
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
    });

    // Flatten staffLocations to locations array with roles
    const result = staff.map((s: any) => ({
      id: s.id,
      fullName: s.fullName,
      email: s.email,
      phone: s.phone,
      role: s.role,
      locations: s.staffLocations.map((sl: any) => ({
        ...sl.location,
        locationRole: sl.locationRole,
      })),
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
 * Assign locations to a staff member with per-location roles.
 * Body: { assignments: [{ locationId, locationRole }] }
 * Also supports legacy format: { locationIds: string[] } (defaults to COACH)
 */
router.put('/:id/locations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const staffId = param(req, 'id');
    const { assignments, locationIds } = req.body as {
      assignments?: { locationId: string; locationRole: LocationRole }[];
      locationIds?: string[];  // legacy support
    };

    // Support both new format (assignments) and legacy (locationIds)
    let locationAssignments: { locationId: string; locationRole: LocationRole }[];

    if (assignments && Array.isArray(assignments)) {
      // Validate locationRole values
      const validRoles = Object.values(LocationRole);
      for (const a of assignments) {
        if (!a.locationId) throw ApiError.badRequest('Each assignment must have a locationId');
        if (a.locationRole && !validRoles.includes(a.locationRole)) {
          throw ApiError.badRequest(`Invalid locationRole: ${a.locationRole}. Must be one of: ${validRoles.join(', ')}`);
        }
      }
      locationAssignments = assignments.map((a) => ({
        locationId: a.locationId,
        locationRole: a.locationRole || LocationRole.COACH,
      }));
    } else if (locationIds && Array.isArray(locationIds)) {
      // Legacy: default all to COACH
      locationAssignments = locationIds.map((locationId) => ({
        locationId,
        locationRole: LocationRole.COACH,
      }));
    } else {
      throw ApiError.badRequest('Provide either assignments (array of {locationId, locationRole}) or locationIds (array of strings)');
    }

    // Remove existing assignments
    await prisma.staffLocation.deleteMany({ where: { staffId } });

    // Create new assignments
    if (locationAssignments.length > 0) {
      await prisma.staffLocation.createMany({
        data: locationAssignments.map((a) => ({
          staffId,
          locationId: a.locationId,
          locationRole: a.locationRole,
        })),
      });
    }

    await createAuditLog({
      action: 'STAFF_LOCATIONS_UPDATED',
      userId: req.user!.userId,
      resourceType: 'User',
      resourceId: staffId,
      changes: { assignments: locationAssignments },
    });

    res.json({ success: true, message: 'Location assignments updated' });
  } catch (error) {
    next(error);
  }
});

export default router;
