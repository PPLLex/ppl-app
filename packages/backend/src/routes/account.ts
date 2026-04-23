import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate } from '../middleware/auth';
import { createAuditLog } from '../services/auditService';
import { BookingStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const router = Router();
router.use(authenticate);

/**
 * GET /api/account/profile
 * Get the current user's full profile.
 */
router.get('/profile', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        createdAt: true,
        clientProfile: {
          select: {
            dateOfBirth: true,
            ageGroup: true,
            parentName: true,
            parentEmail: true,
            parentPhone: true,
            emergencyContact: true,
            emergencyPhone: true,
            trainingGoals: true,
            trainingPreference: true,
            waiverSignedAt: true,
          },
        },
        homeLocation: { select: { id: true, name: true } },
      },
    });

    if (!user) throw ApiError.notFound('User not found');
    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/account/profile
 * Update current user's profile info.
 */
router.put('/profile', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const {
      fullName,
      phone,
      // NEW: homeLocationId — register step 4 sends this. Previously it was
      // silently ignored, which meant the subscribe endpoint at step 5 never
      // saw a home location and every 6-step registration died at step 5.
      // See audit issue #1 (root cause).
      homeLocationId,
      parentName,
      parentEmail,
      parentPhone,
      emergencyContact,
      emergencyPhone,
      trainingGoals,
      trainingPreference,
      clientProfile: clientProfileBody, // frontend sends { clientProfile: { ageGroup } }
    } = req.body;

    // Update user
    const updateData: any = {};
    if (fullName !== undefined) updateData.fullName = fullName;
    if (phone !== undefined) updateData.phone = phone;
    if (homeLocationId !== undefined) {
      // Verify the location exists + is active before accepting
      if (homeLocationId) {
        const loc = await prisma.location.findUnique({ where: { id: homeLocationId } });
        if (!loc || !loc.isActive) {
          throw ApiError.badRequest('Invalid location.');
        }
      }
      updateData.homeLocationId = homeLocationId || null;
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.user.update({
        where: { id: userId },
        data: updateData,
      });

      // If this user is a family parent AND we just set a location, also
      // backfill Family.primaryLocationId so the family's athletes inherit
      // the same home. See audit issue #16.
      if (homeLocationId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p: any = prisma;
        await p.family.updateMany({
          where: { parentUserId: userId },
          data: { primaryLocationId: homeLocationId },
        });
      }
    }

    // Update client profile fields if provided
    const profileData: any = {};
    if (parentName !== undefined) profileData.parentName = parentName;
    if (parentEmail !== undefined) profileData.parentEmail = parentEmail;
    if (parentPhone !== undefined) profileData.parentPhone = parentPhone;
    if (emergencyContact !== undefined) profileData.emergencyContact = emergencyContact;
    if (emergencyPhone !== undefined) profileData.emergencyPhone = emergencyPhone;
    if (trainingGoals !== undefined) profileData.trainingGoals = trainingGoals;
    if (trainingPreference !== undefined) {
      const validPrefs = ['IN_PERSON', 'REMOTE', 'HYBRID'];
      if (validPrefs.includes(trainingPreference)) {
        profileData.trainingPreference = trainingPreference;
      }
    }
    // Accept the nested `clientProfile.ageGroup` shape that the register
    // flow sends. Keeps the frontend API contract stable.
    if (clientProfileBody?.ageGroup !== undefined) {
      profileData.ageGroup = clientProfileBody.ageGroup;
    }

    if (Object.keys(profileData).length > 0) {
      await prisma.clientProfile.updateMany({
        where: { userId },
        data: profileData,
      });
    }

    await createAuditLog({
      action: 'PROFILE_UPDATED',
      userId,
      resourceType: 'User',
      resourceId: userId,
      changes: { ...updateData, ...profileData },
    });

    res.json({ success: true, message: 'Profile updated' });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/account/password
 * Change password. Requires current password.
 */
router.put('/password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      throw ApiError.badRequest('Current and new passwords are required');
    }
    if (newPassword.length < 8) {
      throw ApiError.badRequest('New password must be at least 8 characters');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!user) throw ApiError.notFound('User not found');
    if (!user.passwordHash) throw ApiError.unauthorized('Current password is incorrect');

    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) throw ApiError.unauthorized('Current password is incorrect');

    const newHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    });

    await createAuditLog({
      action: 'PASSWORD_CHANGED',
      userId,
      resourceType: 'User',
      resourceId: userId,
    });

    res.json({ success: true, message: 'Password updated' });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/account/bookings
 * Get current user's booking history.
 */
router.get('/bookings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const status = req.query.status as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const where: any = { clientId: userId };
    if (status) {
      where.status = status;
    }

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: {
          session: {
            include: {
              location: { select: { id: true, name: true } },
              room: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.booking.count({ where }),
    ]);

    const data = bookings.map((b: any) => ({
      id: b.id,
      status: b.status,
      createdAt: b.createdAt,
      cancelledAt: b.cancelledAt,
      session: {
        id: b.session.id,
        title: b.session.title,
        type: b.session.type,
        startTime: b.session.startTime,
        endTime: b.session.endTime,
        locationName: b.session.location?.name,
        roomName: b.session.room?.name,
      },
    }));

    res.json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
