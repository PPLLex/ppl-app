import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { config } from '../config';
import { Role } from '@prisma/client';
import { JwtPayload } from './auth';

/**
 * MEMBERSHIP GUARD MIDDLEWARE
 *
 * Enforces "dummy mode" for clients with failed/cancelled/suspended memberships.
 * When membership is not ACTIVE, clients can ONLY access:
 *   - GET /api/account (view their own account)
 *   - GET/PUT /api/memberships (manage payment/restart membership)
 *   - POST /api/auth/logout
 *   - Payment-related endpoints
 *
 * Everything else (booking, notes, goals, messages, programs) is blocked.
 * Coaches also get notified when trying to submit notes for payment-blocked athletes.
 *
 * NOTE: This runs as global middleware before route handlers. It peeks at the JWT
 * to determine role without requiring full authentication (unauthenticated requests pass through).
 */
export const membershipGuard = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    // Try to peek at the JWT to get user info
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return next(); // No token — let the route's own authenticate middleware handle it
    }

    let decoded: JwtPayload;
    try {
      decoded = jwt.verify(authHeader.split(' ')[1], config.jwt.secret) as JwtPayload;
    } catch {
      return next(); // Invalid token — let authenticate middleware handle the error
    }

    // Only applies to CLIENT users
    if (decoded.role !== Role.CLIENT) {
      return next();
    }

    // Allowlisted paths — always accessible even without active membership
    // Use originalUrl since this middleware may be mounted at a sub-path
    const path = req.originalUrl.toLowerCase();
    const allowedPaths = [
      '/api/account',
      '/api/memberships',
      '/api/auth',
      '/api/webhooks',
      '/api/locations',       // need to see locations for payment setup
      '/api/notifications',   // need to receive payment notifications
      '/api/onboarding',      // need to complete onboarding before having a membership
      '/api/conversations',   // need to message us about payment issues
    ];

    const isAllowed = allowedPaths.some((allowed) => path.startsWith(allowed));
    if (isAllowed) return next();

    // Check if the client has at least one ACTIVE membership
    const activeMembership = await prisma.clientMembership.findFirst({
      where: {
        clientId: decoded.userId,
        status: 'ACTIVE',
      },
    });

    if (!activeMembership) {
      // Check what their membership status actually is for a better error message
      const anyMembership = await prisma.clientMembership.findFirst({
        where: { clientId: decoded.userId },
        orderBy: { updatedAt: 'desc' },
      });

      let message = 'Your account is on hold. Please set up your membership to access this feature.';

      if (anyMembership) {
        switch (anyMembership.status) {
          case 'PAST_DUE':
            message = 'Your payment is past due. Please update your payment method to restore access.';
            break;
          case 'SUSPENDED':
            message = 'Your membership has been suspended. Please contact us or update your payment to restore access.';
            break;
          case 'CANCELLED':
            message = 'Your membership has been cancelled. Please sign up for a new membership to access this feature.';
            break;
        }
      }

      throw ApiError.forbidden(message);
    }

    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Check membership status for a specific athlete.
 * Used by coaches when submitting notes — returns the status
 * rather than blocking the request outright.
 */
export const checkAthleteMembershipStatus = async (athleteId: string): Promise<{
  isActive: boolean;
  status: string | null;
  message: string;
}> => {
  const membership = await prisma.clientMembership.findFirst({
    where: {
      clientId: athleteId,
      status: 'ACTIVE',
    },
  });

  if (membership) {
    return { isActive: true, status: 'ACTIVE', message: 'Membership is active' };
  }

  const anyMembership = await prisma.clientMembership.findFirst({
    where: { clientId: athleteId },
    orderBy: { updatedAt: 'desc' },
  });

  if (!anyMembership) {
    return { isActive: false, status: null, message: 'No membership found' };
  }

  return {
    isActive: false,
    status: anyMembership.status,
    message: `Membership is ${anyMembership.status.toLowerCase().replace('_', ' ')}`,
  };
};
