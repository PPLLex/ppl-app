import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { generateToken, JwtPayload } from '../middleware/auth';
import { sensitiveLimiter } from '../middleware/rateLimit';
import { config } from '../config';
import { Role } from '@prisma/client';

const router = Router();

// ============================================================
// HELPERS
// ============================================================

/**
 * Build JWT payload and generate token for a user.
 * Shared by all OAuth flows.
 */
function buildAuthResponse(user: {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: Role;
  homeLocationId: string | null;
  homeLocation?: { id: string; name: string } | null;
  clientProfile?: { ageGroup: string | null } | null;
  avatarUrl?: string | null;
}) {
  const payload: JwtPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    homeLocationId: user.homeLocationId,
  };
  const token = generateToken(payload);

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      role: user.role,
      homeLocation: user.homeLocation || null,
      ageGroup: user.clientProfile?.ageGroup || null,
      avatarUrl: user.avatarUrl || null,
    },
    isNewUser: false, // overridden when appropriate
  };
}

const userInclude = {
  homeLocation: { select: { id: true, name: true } },
  clientProfile: { select: { ageGroup: true } },
};

// ============================================================
// POST /api/auth/google
// Google Sign-In â verify ID token and sign in / create account
// ============================================================

router.post('/google', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { idToken, locationId, ageGroup } = req.body;

    if (!idToken) {
      throw ApiError.badRequest('Google ID token is required');
    }

    // Dynamically import google-auth-library (ESM module)
    const { OAuth2Client } = await import('google-auth-library');
    const client = new OAuth2Client(config.google.clientId);

    // Verify the ID token with Google
    const ticket = await client.verifyIdToken({
      idToken,
      audience: config.google.clientId,
    });

    const googlePayload = ticket.getPayload();
    if (!googlePayload || !googlePayload.email) {
      throw ApiError.unauthorized('Invalid Google token');
    }

    const { sub: googleId, email, name, picture } = googlePayload;

    // Check if user exists by Google ID or email
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { googleId },
          { email: email!.toLowerCase() },
        ],
      },
      include: userInclude,
    });

    let isNewUser = false;

    if (user) {
      // Link Google ID if not already linked
      if (!user.googleId) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            googleId,
            avatarUrl: user.avatarUrl || picture || null,
            authProvider: user.authProvider || 'google',
          },
          include: userInclude,
        });
      }

      if (!user.isActive) {
        throw ApiError.unauthorized('Account is deactivated. Please contact PPL.');
      }
    } else {
      // Create new user
      isNewUser = true;
      user = await prisma.user.create({
        data: {
          email: email!.toLowerCase(),
          fullName: name || email!.split('@')[0],
          role: Role.CLIENT,
          authProvider: 'google',
          googleId,
          avatarUrl: picture || null,
          homeLocationId: locationId || null,
          clientProfile: {
            create: {
              ageGroup: ageGroup || null,
            },
          },
        },
        include: userInclude,
      });
    }

    const authResponse = buildAuthResponse(user);
    authResponse.isNewUser = isNewUser;

    res.json({
      success: true,
      data: authResponse,
    });
  } catch (error) {
    if (error instanceof ApiError) return next(error);
    console.error('Google auth error:', error);
    next(ApiError.internal('Google authentication failed'));
  }
});

// ============================================================
// POST /api/auth/apple
// Apple Sign-In â verify identity token and sign in / create
// ============================================================

router.post('/apple', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { identityToken, authorizationCode, fullName, locationId, ageGroup } = req.body;

    if (!identityToken) {
      throw ApiError.badRequest('Apple identity token is required');
    }

    // Dynamically import apple-signin-auth
    const appleSignin = await import('apple-signin-auth');

    // Verify Apple identity token
    const applePayload = await appleSignin.verifyIdToken(identityToken, {
      audience: config.apple.clientId,
      ignoreExpiration: false,
    });

    if (!applePayload || !applePayload.sub) {
      throw ApiError.unauthorized('Invalid Apple token');
    }

    const appleId = applePayload.sub;
    const email = applePayload.email || null;

    // Check if user exists by Apple ID or email
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { appleId },
          ...(email ? [{ email: email.toLowerCase() }] : []),
        ],
      },
      include: userInclude,
    });

    let isNewUser = false;

    if (user) {
      // Link Apple ID if not already linked
      if (!user.appleId) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            appleId,
            authProvider: user.authProvider || 'apple',
          },
          include: userInclude,
        });
      }

      if (!user.isActive) {
        throw ApiError.unauthorized('Account is deactivated. Please contact PPL.');
      }
    } else {
      // Apple only sends name on first auth, so we capture it here
      const displayName =
        fullName?.givenName && fullName?.familyName
          ? `${fullName.givenName} ${fullName.familyName}`
          : email?.split('@')[0] || 'PPL Athlete';

      isNewUser = true;
      user = await prisma.user.create({
        data: {
          email: (email || `apple_${appleId}@privaterelay.appleid.com`).toLowerCase(),
          fullName: displayName,
          role: Role.CLIENT,
          authProvider: 'apple',
          appleId,
          homeLocationId: locationId || null,
          clientProfile: {
            create: {
              ageGroup: ageGroup || null,
            },
          },
        },
        include: userInclude,
      });
    }

    const authResponse = buildAuthResponse(user);
    authResponse.isNewUser = isNewUser;

    res.json({
      success: true,
      data: authResponse,
    });
  } catch (error) {
    if (error instanceof ApiError) return next(error);
    console.error('Apple auth error:', error);
    next(ApiError.internal('Apple authentication failed'));
  }
});

// ============================================================
// POST /api/auth/magic-link
// Send a magic link email for passwordless login
// ============================================================

// Rate-limited (5/hr/IP) — magic-link is an email-spam + enumeration
// target just like password reset. Handler already returns a generic
// success response regardless of whether the email exists.
router.post('/magic-link', sensitiveLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body;

    if (!email) {
      throw ApiError.badRequest('Email is required');
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Always return success to prevent email enumeration
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (user && user.isActive) {
      // Generate a secure token
      const token = crypto.randomBytes(32).toString('hex');
      const expiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      await prisma.user.update({
        where: { id: user.id },
        data: {
          magicLinkToken: token,
          magicLinkExpiry: expiry,
        },
      });

      // Build magic link URL
      const magicLinkUrl = `${config.frontendUrl}/auth/magic-link?token=${token}`;

      // Send email via nodemailer
      try {
        const nodemailer = await import('nodemailer');
        const transporter = nodemailer.createTransport({
          host: config.smtp.host,
          port: config.smtp.port,
          secure: config.smtp.port === 465,
          auth: {
            user: config.smtp.user,
            pass: config.smtp.pass,
          },
        });

        await transporter.sendMail({
          from: config.smtp.from,
          to: normalizedEmail,
          subject: 'Sign in to Pitching Performance Lab',
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
              <div style="text-align: center; margin-bottom: 32px;">
                <div style="display: inline-block; width: 56px; height: 56px; border-radius: 50%; background: linear-gradient(135deg, #B8CC3A, #8FA62F); line-height: 56px; color: white; font-size: 24px; font-weight: bold;">P</div>
                <h1 style="color: #1a1a1a; font-size: 20px; margin: 16px 0 4px;">Pitching Performance Lab</h1>
              </div>
              <p style="color: #4a4a4a; font-size: 16px; line-height: 1.5;">
                Hi ${user.fullName.split(' ')[0]},
              </p>
              <p style="color: #4a4a4a; font-size: 16px; line-height: 1.5;">
                Click the button below to sign in to your PPL account. This link expires in 15 minutes.
              </p>
              <div style="text-align: center; margin: 32px 0;">
                <a href="${magicLinkUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #B8CC3A, #8FA62F); color: white; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: 600;">
                  Sign In to PPL
                </a>
              </div>
              <p style="color: #888; font-size: 13px; line-height: 1.5;">
                If you didn't request this, you can safely ignore this email. If the button doesn't work, copy and paste this URL into your browser:<br/>
                <span style="color: #666; word-break: break-all;">${magicLinkUrl}</span>
              </p>
            </div>
          `,
        });
      } catch (emailError) {
        console.error('Magic link email send failed:', emailError);
        // Don't expose email errors to client
      }
    }

    // Always return success (security best practice)
    res.json({
      success: true,
      data: {
        message: 'If an account exists with that email, a sign-in link has been sent.',
      },
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================
// POST /api/auth/magic-link/verify
// Verify magic link token and sign in
// ============================================================

router.post('/magic-link/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.body;

    if (!token) {
      throw ApiError.badRequest('Token is required');
    }

    const user = await prisma.user.findUnique({
      where: { magicLinkToken: token },
      include: userInclude,
    });

    if (!user) {
      throw ApiError.unauthorized('Invalid or expired link');
    }

    if (!user.magicLinkExpiry || user.magicLinkExpiry < new Date()) {
      // Clear expired token
      await prisma.user.update({
        where: { id: user.id },
        data: { magicLinkToken: null, magicLinkExpiry: null },
      });
      throw ApiError.unauthorized('This link has expired. Please request a new one.');
    }

    if (!user.isActive) {
      throw ApiError.unauthorized('Account is deactivated. Please contact PPL.');
    }

    // Clear the magic link token (single use)
    await prisma.user.update({
      where: { id: user.id },
      data: {
        magicLinkToken: null,
        magicLinkExpiry: null,
        authProvider: user.authProvider || 'email',
      },
    });

    const authResponse = buildAuthResponse(user);

    res.json({
      success: true,
      data: authResponse,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
