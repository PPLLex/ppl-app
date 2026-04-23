import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate, generateToken, JwtPayload } from '../middleware/auth';
import { Role } from '@prisma/client';
import { sendEmail, buildWelcomeEmail } from '../services/emailService';

const router = Router();

/**
 * POST /api/auth/seed-admin
 * One-time admin account creation. Creates the PPL admin user + locations if they don't exist.
 * TODO: Remove this endpoint after initial production seed.
 */
router.post('/seed-admin', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const seedKey = req.headers['x-seed-key'];
    if (seedKey !== 'ppl-seed-2026') {
      throw ApiError.unauthorized('Invalid seed key');
    }

    // Check if admin already exists
    const existing = await prisma.user.findUnique({
      where: { email: 'cmart@pitchingperformancelab.com' },
    });
    if (existing) {
      res.json({ success: true, message: 'Admin already exists', userId: existing.id });
      return;
    }

    const passwordHash = await bcrypt.hash('PPLadmin2026!', 12);

    // Create locations first
    const loc1 = await prisma.location.upsert({
      where: { id: 'loc-1' },
      update: {},
      create: {
        id: 'loc-1',
        name: 'PPL Southlake',
        address: '1234 Training Way, Southlake, TX 76092',
        phone: '(817) 555-0101',
        timezone: 'America/Chicago',
        closedDay: 'sunday',
        operatingHours: {
          monday: { open: '06:00', close: '21:00' },
          tuesday: { open: '06:00', close: '21:00' },
          wednesday: { open: '06:00', close: '21:00' },
          thursday: { open: '06:00', close: '21:00' },
          friday: { open: '06:00', close: '21:00' },
          saturday: { open: '08:00', close: '18:00' },
          sunday: null,
        },
      },
    });

    const loc2 = await prisma.location.upsert({
      where: { id: 'loc-2' },
      update: {},
      create: {
        id: 'loc-2',
        name: 'PPL Keller',
        address: '5678 Performance Blvd, Keller, TX 76248',
        phone: '(817) 555-0202',
        timezone: 'America/Chicago',
        closedDay: 'sunday',
        operatingHours: {
          monday: { open: '06:00', close: '21:00' },
          tuesday: { open: '06:00', close: '21:00' },
          wednesday: { open: '06:00', close: '21:00' },
          thursday: { open: '06:00', close: '21:00' },
          friday: { open: '06:00', close: '21:00' },
          saturday: { open: '08:00', close: '18:00' },
          sunday: null,
        },
      },
    });

    // Create rooms for each location
    for (const loc of [loc1, loc2]) {
      await prisma.room.upsert({
        where: { id: `${loc.id}-room-1` },
        update: {},
        create: { id: `${loc.id}-room-1`, locationId: loc.id, name: 'Pitching Lab', sortOrder: 1 },
      });
      await prisma.room.upsert({
        where: { id: `${loc.id}-room-2` },
        update: {},
        create: { id: `${loc.id}-room-2`, locationId: loc.id, name: 'Training Bay', sortOrder: 2 },
      });
    }

    // Create admin user
    const admin = await prisma.user.create({
      data: {
        email: 'cmart@pitchingperformancelab.com',
        passwordHash,
        fullName: 'Chad Martinez',
        phone: '(817) 555-0001',
        role: Role.ADMIN,
        authProvider: 'email',
        homeLocationId: loc1.id,
      },
    });

    // Assign admin to all locations as staff
    for (const loc of [loc1, loc2]) {
      await prisma.staffLocation.upsert({
        where: { staffId_locationId: { staffId: admin.id, locationId: loc.id } },
        update: {},
        create: { staffId: admin.id, locationId: loc.id },
      });
    }

    res.json({
      success: true,
      message: 'Admin account created successfully',
      userId: admin.id,
      email: admin.email,
      locations: [loc1.name, loc2.name],
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/register
 * Register a new client account
 */
router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      email,
      password,
      fullName,
      phone,
      locationId,
      ageGroup,
      // Parent path: when registeringAs==='PARENT', the User account being
      // created is the PARENT. The athlete gets their own User row + profile
      // linked via Family. Youth and MS/HS registrations MUST use this path.
      registeringAs,
      athleteFirstName,
      athleteLastName,
      athleteDateOfBirth,
      // Athlete self-signup for College only: acknowledge full responsibility
      // (no parent account created). Ignored for any other combo.
      parentOptOut,
    } = req.body;

    if (!email || !password || !fullName) {
      throw ApiError.badRequest('Email, password, and full name are required');
    }
    // NOTE: locationId is OPTIONAL here. The 6-step register flow creates the
    // account on step 2 (before the user has picked a location on step 4), so
    // we allow a location-less account and let PUT /api/account set homeLocationId
    // later. User.homeLocationId and Family.primaryLocationId are both nullable.

    const isParentRegistration = registeringAs === 'PARENT';
    if (isParentRegistration) {
      if (!athleteFirstName || !athleteLastName) {
        throw ApiError.badRequest(
          "Parent registration requires the athlete's first and last name"
        );
      }
    } else {
      // Athlete self-signup enforcement:
      //   • Youth → ALWAYS requires a parent account. No opt-out.
      //   • MS/HS → requires parent UNLESS parentOptOut is explicitly true
      //     (frontend sends this after the two-checkbox solo acknowledgment).
      //   • College → requires parent UNLESS parentOptOut is true (single box).
      //   • Pro → always allowed solo.
      if (ageGroup === 'youth') {
        throw ApiError.badRequest(
          'Youth athletes must be registered by a parent or guardian.'
        );
      }
      if (ageGroup === 'ms_hs' && !parentOptOut) {
        throw ApiError.badRequest(
          'Middle/High School athletes must either register through a parent/guardian OR acknowledge they are managing their own account (both solo-mode boxes).'
        );
      }
      if (ageGroup === 'college' && !parentOptOut) {
        throw ApiError.badRequest(
          'College athletes must either register through a parent/guardian OR acknowledge they are managing their own account.'
        );
      }
    }

    // Check if user already exists
    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) {
      throw ApiError.conflict('An account with this email already exists');
    }

    // Verify location exists — only if one was provided. The 6-step register
    // flow doesn't have a locationId at account-creation time.
    const effectiveLocationId: string | null = locationId && locationId.trim() ? locationId : null;
    if (effectiveLocationId) {
      const location = await prisma.location.findUnique({ where: { id: effectiveLocationId } });
      if (!location || !location.isActive) {
        throw ApiError.badRequest('Invalid location');
      }
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user + client profile. For parent registrations we also create
    // the Family, the athlete User (with no login of their own — parent
    // controls everything), and the AthleteProfile — all in one transaction
    // so nothing ends up half-persisted on a failure.
    const user = await prisma.$transaction(async (tx) => {
      const authUser = await tx.user.create({
        data: {
          email: email.toLowerCase(),
          passwordHash,
          fullName,
          phone,
          role: Role.CLIENT,
          authProvider: 'email',
          homeLocationId: effectiveLocationId,
          clientProfile: {
            create: {
              ageGroup: ageGroup || null,
            },
          },
        },
        include: {
          clientProfile: true,
          homeLocation: { select: { id: true, name: true } },
        },
      });

      if (isParentRegistration) {
        const family = await tx.family.create({
          data: {
            parentUserId: authUser.id,
            primaryLocationId: effectiveLocationId,
          },
        });

        // Athlete User: placeholder email (parent's email + "+athlete-<short>"
        // tag, which is RFC 5233 compliant and keeps our UNIQUE email index
        // happy without inventing a fake domain). passwordHash is null so
        // direct login is impossible — this account is managed by the parent.
        const athleteEmailTag = randomBytes(4).toString('hex');
        const parentLocalPart = email.toLowerCase().split('@')[0];
        const parentDomain = email.toLowerCase().split('@')[1];
        const athleteEmail = `${parentLocalPart}+athlete-${athleteEmailTag}@${parentDomain}`;

        const athleteUser = await tx.user.create({
          data: {
            email: athleteEmail,
            passwordHash: null,
            fullName: `${athleteFirstName} ${athleteLastName}`.trim(),
            role: Role.CLIENT,
            authProvider: 'family',
            homeLocationId: effectiveLocationId,
          },
        });

        await tx.athleteProfile.create({
          data: {
            userId: athleteUser.id,
            familyId: family.id,
            firstName: athleteFirstName,
            lastName: athleteLastName,
            dateOfBirth: athleteDateOfBirth ? new Date(athleteDateOfBirth) : null,
            ageGroup: ageGroup || null,
            relationToParent: 'CHILD',
          },
        });
      } else if (parentOptOut === true && (ageGroup === 'college' || ageGroup === 'ms_hs')) {
        // Solo College or MS/HS athlete: create their AthleteProfile up front
        // with relationToParent=SELF and a logged opt-out acknowledgment.
        // Uses athleteFirstName/athleteLastName directly (always sent now)
        // instead of splitting fullName. See audit issue #7.
        await tx.athleteProfile.create({
          data: {
            userId: authUser.id,
            firstName: athleteFirstName || authUser.fullName.split(/\s+/)[0] || 'Athlete',
            lastName:
              athleteLastName ||
              authUser.fullName.split(/\s+/).slice(1).join(' ') ||
              'Athlete',
            dateOfBirth: athleteDateOfBirth ? new Date(athleteDateOfBirth) : null,
            ageGroup,
            relationToParent: 'SELF',
            parentOptOut: true,
            parentOptOutAckedAt: new Date(),
          },
        });
      } else if (!isParentRegistration && ageGroup === 'pro') {
        // Pro athletes register solo. Create their AthleteProfile up front
        // with real names + DOB so later onboarding steps don't have to
        // invent them. See audit issue #7.
        await tx.athleteProfile.create({
          data: {
            userId: authUser.id,
            firstName: athleteFirstName || authUser.fullName.split(/\s+/)[0] || 'Athlete',
            lastName:
              athleteLastName ||
              authUser.fullName.split(/\s+/).slice(1).join(' ') ||
              'Athlete',
            dateOfBirth: athleteDateOfBirth ? new Date(athleteDateOfBirth) : null,
            ageGroup,
            relationToParent: 'SELF',
          },
        });
      }

      return authUser;
    });

    // Send welcome email (non-blocking)
    sendEmail({
      to: user.email,
      subject: 'Welcome to Pitching Performance Lab!',
      text: `Hey ${user.fullName.split(' ')[0]}, welcome to PPL! Log in to your dashboard to choose a membership plan and book your first session.`,
      html: buildWelcomeEmail(user.fullName, user.homeLocation?.name || 'PPL'),
    }).catch((err) => console.error('Failed to send welcome email:', err));

    // Generate token
    const tokenPayload: JwtPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      homeLocationId: user.homeLocationId,
    };
    const token = generateToken(tokenPayload);

    res.status(201).json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          phone: user.phone,
          role: user.role,
          homeLocation: user.homeLocation,
          ageGroup: user.clientProfile?.ageGroup,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/login
 * Login with email and password
 */
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw ApiError.badRequest('Email and password are required');
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        homeLocation: { select: { id: true, name: true } },
        clientProfile: true,
      },
    });

    if (!user) {
      throw ApiError.unauthorized('Invalid email or password');
    }

    if (!user.isActive) {
      throw ApiError.unauthorized('Account is deactivated. Please contact PPL.');
    }

    // Verify password â OAuth-only accounts don't have a passwordHash
    if (!user.passwordHash) {
      throw ApiError.unauthorized(
        'This account uses Google or Apple sign-in. Please use that method to log in.'
      );
    }
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      throw ApiError.unauthorized('Invalid email or password');
    }

    // Generate token
    const tokenPayload: JwtPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      homeLocationId: user.homeLocationId,
    };
    const token = generateToken(tokenPayload);

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          phone: user.phone,
          role: user.role,
          homeLocation: user.homeLocation,
          ageGroup: user.clientProfile?.ageGroup,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/auth/me
 * Get current user profile
 */
router.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: {
        homeLocation: { select: { id: true, name: true } },
        staffLocations: {
          select: {
            roles: true,
            location: { select: { id: true, name: true } },
          },
        },
        clientProfile: true,
        clientMemberships: {
          where: { status: { in: ['ACTIVE', 'PAST_DUE'] } },
          include: { plan: true },
        },
      },
    });

    if (!user) {
      throw ApiError.notFound('User not found');
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        phone: user.phone,
        role: user.role,
        homeLocation: user.homeLocation,
        locations: user.staffLocations.map((sl: any) => ({
          id: sl.location.id,
          name: sl.location.name,
          roles: sl.roles,
        })),
        profile: user.clientProfile,
        memberships: user.clientMemberships,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/create-staff
 * Admin-only: create a staff or admin account
 */
router.post('/create-staff', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.user!.role !== Role.ADMIN) {
      throw ApiError.forbidden('Only admins can create staff accounts');
    }

    const { email, password, fullName, phone, role, locationIds } = req.body;

    if (!email || !password || !fullName) {
      throw ApiError.badRequest('Email, password, and full name are required');
    }

    const staffRole = role === 'ADMIN' ? Role.ADMIN : Role.STAFF;

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) {
      throw ApiError.conflict('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        fullName,
        phone,
        role: staffRole,
        homeLocationId: locationIds?.[0] || null,
        staffLocations: locationIds?.length
          ? {
              create: locationIds.map((locId: string) => ({
                locationId: locId,
              })),
            }
          : undefined,
      },
      include: {
        staffLocations: {
          include: { location: { select: { id: true, name: true } } },
        },
      },
    });

    res.status(201).json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        locations: user.staffLocations.map((sl) => sl.location),
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
