import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate, generateToken, JwtPayload } from '../middleware/auth';
import { Role } from '@prisma/client';
import { sendEmail, buildWelcomeEmail } from '../services/emailService';

const router = Router();

/**
 * POST /api/auth/register
 * Register a new client account
 */
router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, fullName, phone, locationId, ageGroup } = req.body;

    if (!email || !password || !fullName || !locationId) {
      throw ApiError.badRequest('Email, password, full name, and location are required');
    }

    // Check if user already exists
    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) {
      throw ApiError.conflict('An account with this email already exists');
    }

    // Verify location exists
    const location = await prisma.location.findUnique({ where: { id: locationId } });
    if (!location || !location.isActive) {
      throw ApiError.badRequest('Invalid location');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user + client profile in a transaction
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        fullName,
        phone,
        role: Role.CLIENT,
        authProvider: 'email',
        homeLocationId: locationId,
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
