import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate } from '../middleware/auth';
import { createAuditLog } from '../services/auditService';
import { BookingStatus, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

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

/**
 * GET /api/account/athletes
 * List all athletes under the authenticated user's Family. Returns the
 * parent's own AthleteProfile too (if they self-manage on top of being
 * a parent). Used by the parent dashboard to show "your athletes" +
 * feed per-athlete widgets like Recent Coach Notes.
 *
 * Returns:
 *   [{ id, firstName, lastName, ageGroup, dateOfBirth, relationToParent }, ...]
 */
router.get('/athletes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;

    // Family the user parents (if any)
    const family = await prisma.family.findUnique({ where: { parentUserId: userId } });
    const familyId = family?.id;

    // Pull every AthleteProfile whose User is either THIS user (self-managing)
    // or a child in their Family.
    const athletes = await prisma.athleteProfile.findMany({
      where: {
        OR: [
          { userId: userId },
          ...(familyId ? [{ familyId: familyId }] : []),
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        ageGroup: true,
        dateOfBirth: true,
        relationToParent: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ success: true, data: athletes });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/account/athletes
 * Add a new athlete (sibling / additional kid) under the authenticated
 * parent's Family AFTER they've already registered. Used by the "Add
 * another athlete" flow on the parent dashboard.
 *
 * Creates a child User (no login, family+athlete-<tag> email) and an
 * AthleteProfile linked to the existing Family. If the parent doesn't
 * have a Family row yet (unusual edge case — they self-managed during
 * signup), one is created for them here.
 *
 * Body: { firstName, lastName, dateOfBirth?, ageGroup }
 *
 * NOTE: this does NOT create a subscription for the new athlete. The
 * frontend should route the parent to the Choose Plan flow for this
 * athleteId after creation. Per-athlete subscribe support lands in the
 * membership/subscribe refactor (deferred — see commit notes).
 */
router.post('/athletes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { firstName, lastName, dateOfBirth, ageGroup } = req.body as {
      firstName?: string;
      lastName?: string;
      dateOfBirth?: string;
      ageGroup?: string;
    };

    // ── Validation ────────────────────────────────────────────
    if (!firstName || !firstName.trim() || !lastName || !lastName.trim()) {
      throw ApiError.badRequest("Athlete's first and last name are required.");
    }
    if (!ageGroup || !['youth', 'ms_hs', 'college', 'pro'].includes(ageGroup)) {
      throw ApiError.badRequest(
        'Playing level must be youth, ms_hs, college, or pro.'
      );
    }

    // Load the parent user for email tag generation + enforce CLIENT role.
    const parent = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, homeLocationId: true },
    });
    if (!parent) throw ApiError.notFound('Parent account not found');
    if (parent.role !== Role.CLIENT) {
      throw ApiError.forbidden('Only client accounts can add athletes.');
    }

    const result = await prisma.$transaction(async (tx) => {
      // Get-or-create the Family. Most parents have one from registration;
      // the `findUnique` covers the rare case where a user registered solo
      // and later becomes a parent.
      let family = await tx.family.findUnique({ where: { parentUserId: userId } });
      if (!family) {
        family = await tx.family.create({
          data: {
            parentUserId: userId,
            primaryLocationId: parent.homeLocationId,
          },
        });
      }

      // Create the athlete's User row — no login, family+athlete tag email.
      const tag = randomBytes(4).toString('hex');
      const parentLocal = parent.email.toLowerCase().split('@')[0];
      const parentDomain = parent.email.toLowerCase().split('@')[1];
      const athleteEmail = `${parentLocal}+athlete-${tag}@${parentDomain}`;

      const athleteUser = await tx.user.create({
        data: {
          email: athleteEmail,
          passwordHash: null,
          fullName: `${firstName!.trim()} ${lastName!.trim()}`,
          role: Role.CLIENT,
          authProvider: 'family',
          homeLocationId: parent.homeLocationId,
        },
      });

      const profile = await tx.athleteProfile.create({
        data: {
          userId: athleteUser.id,
          familyId: family.id,
          firstName: firstName!.trim(),
          lastName: lastName!.trim(),
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
          ageGroup,
          relationToParent: 'CHILD',
        },
      });

      return { family, profile };
    });

    await createAuditLog({
      userId,
      action: 'athlete.added',
      resourceType: 'athlete_profile',
      resourceId: result.profile.id,
      changes: { athleteFirstName: firstName, ageGroup },
    });

    res.status(201).json({
      success: true,
      data: {
        athleteId: result.profile.id,
        firstName: result.profile.firstName,
        lastName: result.profile.lastName,
        ageGroup: result.profile.ageGroup,
      },
      message: `${firstName} has been added to your family. Next, pick a plan for them.`,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
