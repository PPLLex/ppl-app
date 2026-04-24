import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate, requireAdmin } from '../middleware/auth';
import { createAuditLog } from '../services/auditService';
import { sendStaffReinstateEmail, sendStaffInviteEmail } from '../services/emailService';
import { config } from '../config';
import { Role, LocationRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const router = Router();

function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

const VALID_ROLES = Object.values(LocationRole);

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  PITCHING_COORDINATOR: 'Pitching Coordinator',
  YOUTH_COORDINATOR: 'Youth Coordinator',
  COACH: 'Coach',
  TRAINER: 'Trainer',
};

// ============================================================
// AUTHENTICATED ADMIN ROUTES
// ============================================================

router.use(authenticate, requireAdmin);

/**
 * GET /api/staff
 * List all staff and admin users with their location assignments.
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
        avatarUrl: true,
        createdAt: true,
        staffLocations: {
          select: {
            id: true,
            roles: true,
            location: {
              select: { id: true, name: true },
            },
          },
        },
      },
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
    });

    const result = staff.map((s: any) => ({
      id: s.id,
      fullName: s.fullName,
      email: s.email,
      phone: s.phone,
      role: s.role,
      profileImageUrl: s.avatarUrl,
      createdAt: s.createdAt,
      locations: s.staffLocations.map((sl: any) => ({
        ...sl.location,
        roles: sl.roles,
      })),
    }));

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/staff/invites
 * List pending staff invitations.
 */
router.get('/invites', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const invites = await prisma.staffInvite.findMany({
      where: { usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: invites });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/staff/invite
 * Create a staff invitation. Sends an invite link (does NOT create the account yet).
 * Body: { fullName, email, phone?, role?, locations: [{locationId, roles: ['PITCHING_COORDINATOR', ...]}] }
 */
router.post('/invite', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { fullName, email, phone, role, locations } = req.body;

    if (!fullName || !email) {
      throw ApiError.badRequest('Name and email are required');
    }

    if (!locations || !Array.isArray(locations) || locations.length === 0) {
      throw ApiError.badRequest('At least one location assignment is required');
    }

    // Validate location assignments
    for (const loc of locations) {
      if (!loc.locationId) throw ApiError.badRequest('Each location must have a locationId');
      if (!loc.roles || !Array.isArray(loc.roles) || loc.roles.length === 0) {
        throw ApiError.badRequest('Each location must have at least one role');
      }
      for (const r of loc.roles) {
        if (!VALID_ROLES.includes(r)) {
          throw ApiError.badRequest(`Invalid role: ${r}. Must be one of: ${VALID_ROLES.join(', ')}`);
        }
      }
    }

    // Validate locations exist (done before the user-existence check so the
    // same validation applies to both the fresh-invite and reinstate paths)
    const locationIds = locations.map((l: any) => l.locationId);
    const validLocations = await prisma.location.findMany({
      where: { id: { in: locationIds } },
      select: { id: true, name: true },
    });
    if (validLocations.length !== locationIds.length) {
      throw ApiError.badRequest('One or more location IDs are invalid');
    }

    const userRole = role === 'ADMIN' ? Role.ADMIN : Role.STAFF;

    // Check for existing user.
    //
    // Our DELETE /api/staff/:id is a soft-remove: it wipes the staff location
    // assignments and demotes the user's role to CLIENT, but keeps the user
    // record intact so we don't lose booking history, payments, and audit
    // trail. That creates a scenario where an admin "deletes" a staff member
    // and then tries to re-add them — the email still exists and a naive
    // uniqueness check would block the re-add.
    //
    // Policy:
    //   - If the email belongs to an active STAFF or ADMIN → true conflict.
    //   - If the email belongs to a CLIENT (i.e. was previously staff, or
    //     is a real client now being hired) → reinstate them in place.
    //     Preserves their login + history, and skips the invite/password
    //     reset round trip since they already have credentials.
    const existing = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existing && (existing.role === Role.ADMIN || existing.role === Role.STAFF)) {
      throw ApiError.conflict('A staff user with this email already exists');
    }

    if (existing && existing.role === Role.CLIENT) {
      // Reinstate: update role + replace staff-location assignments in one tx.
      const locationAssignments = locations.map((l: any) => ({
        staffId: existing.id,
        locationId: l.locationId,
        roles: l.roles as LocationRole[],
      }));

      const reinstated = await prisma.$transaction(async (tx) => {
        const user = await tx.user.update({
          where: { id: existing.id },
          data: {
            role: userRole,
            fullName,
            phone: phone || existing.phone,
          },
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            role: true,
          },
        });

        await tx.staffLocation.deleteMany({ where: { staffId: user.id } });
        if (locationAssignments.length > 0) {
          await tx.staffLocation.createMany({ data: locationAssignments });
        }

        return user;
      });

      const roleSummary = locations
        .map((l: any) => {
          const locName =
            validLocations.find((vl) => vl.id === l.locationId)?.name || l.locationId;
          return `${locName}: ${l.roles.map((r: string) => ROLE_LABELS[r] || r).join(', ')}`;
        })
        .join('; ');

      await createAuditLog({
        action: 'STAFF_REINSTATED',
        userId: req.user!.userId,
        resourceType: 'User',
        resourceId: reinstated.id,
        changes: { fullName, email, role: userRole, locations: roleSummary },
      });

      // Fire the welcome/reinstate notification email. We don't block the API
      // response on it — email should be best-effort, not a blocker for the
      // admin action. Errors get logged and the admin can always hit the
      // manual resend endpoint if anything went wrong.
      const existingUserFull = await prisma.user.findUnique({
        where: { id: reinstated.id },
        select: { avatarUrl: true, phone: true },
      });
      const needsAvatar = !existingUserFull?.avatarUrl;
      const needsPhone = !existingUserFull?.phone;

      sendStaffReinstateEmail({
        to: reinstated.email,
        fullName: reinstated.fullName,
        assignments: locations.map((l: any) => ({
          locationName:
            validLocations.find((vl) => vl.id === l.locationId)?.name || l.locationId,
          roleLabels: l.roles.map((r: string) => ROLE_LABELS[r] || r),
        })),
        frontendUrl: config.frontendUrl,
        needsPhone,
        needsAvatar,
      }).catch((err) => {
        console.error('Failed to send staff reinstate email:', err);
      });

      res.status(200).json({
        success: true,
        data: reinstated,
        reinstated: true,
        message: `${fullName} reinstated as staff. Welcome email sent — their existing login still works.`,
      });
      return;
    }

    // Check for existing pending invite (only relevant on the fresh-invite path)
    const existingInvite = await prisma.staffInvite.findFirst({
      where: { email: email.toLowerCase(), usedAt: null, expiresAt: { gt: new Date() } },
    });
    if (existingInvite) throw ApiError.conflict('A pending invitation already exists for this email');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7-day expiry

    const invite = await prisma.staffInvite.create({
      data: {
        email: email.toLowerCase(),
        fullName,
        phone: phone || null,
        role: userRole,
        locations: locations, // JSON: [{locationId, roles}]
        expiresAt,
        invitedBy: req.user!.userId,
      },
    });

    // Build role summary for audit log
    const roleSummary = locations.map((l: any) => {
      const locName = validLocations.find((vl) => vl.id === l.locationId)?.name || l.locationId;
      return `${locName}: ${l.roles.map((r: string) => ROLE_LABELS[r] || r).join(', ')}`;
    }).join('; ');

    await createAuditLog({
      action: 'STAFF_INVITED',
      userId: req.user!.userId,
      resourceType: 'StaffInvite',
      resourceId: invite.id,
      changes: { fullName, email, role: userRole, locations: roleSummary },
    });

    // Fire the actual invite email. Previously this endpoint created the
    // StaffInvite row but never sent the invite — admins saw "Invitation
    // sent" in the UI while the invitee saw nothing. Fix: send the email
    // with the tokenized accept URL. Fire-and-forget; bad SMTP shouldn't
    // block the admin's response, and the manual resend endpoint is
    // still available as a backstop.
    const inviter = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { fullName: true },
    });
    const acceptUrl = `${config.frontendUrl}/join/staff/${invite.token}`;
    sendStaffInviteEmail({
      to: invite.email,
      fullName: invite.fullName,
      invitedByName: inviter?.fullName ?? null,
      assignments: locations.map((l: any) => ({
        locationName:
          validLocations.find((vl) => vl.id === l.locationId)?.name || l.locationId,
        roleLabels: l.roles.map((r: string) => ROLE_LABELS[r] || r),
      })),
      acceptUrl,
      expiresInDays: 7,
    }).catch((err) => {
      console.error('Failed to send staff invite email:', err);
    });

    res.status(201).json({
      success: true,
      data: invite,
      message: `Invitation sent to ${fullName} (${email})`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/staff/invites/:id
 * Revoke a pending invitation.
 */
router.delete('/invites/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const inviteId = param(req, 'id');
    await prisma.staffInvite.delete({ where: { id: inviteId } });
    res.json({ success: true, message: 'Invitation revoked' });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/staff/:id/send-welcome-email
 * Admin-only: (re)send the staff welcome/reinstate notification to an existing
 * staff user. Useful when the automatic email bounced, was lost, or the admin
 * wants to ping the person again with their current access summary.
 */
router.post(
  '/:id/send-welcome-email',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = param(req, 'id');

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          avatarUrl: true,
          role: true,
          staffLocations: {
            select: {
              roles: true,
              location: { select: { id: true, name: true } },
            },
          },
        },
      });

      if (!user) throw ApiError.notFound('Staff member not found');
      if (user.role !== Role.STAFF && user.role !== Role.ADMIN) {
        throw ApiError.badRequest(
          'Cannot send welcome email — this user is not currently a staff or admin'
        );
      }
      if (user.staffLocations.length === 0) {
        throw ApiError.badRequest(
          'Cannot send welcome email — this user has no location assignments'
        );
      }

      const assignments = user.staffLocations.map((sl) => ({
        locationName: sl.location.name,
        roleLabels: sl.roles.map((r) => ROLE_LABELS[r] || r),
      }));

      // Fire-and-forget the SMTP call. If we awaited it, a slow SMTP server
      // would block the admin-facing response (seen in testing — CDP-level
      // timeout fired on the browser before SMTP finished). The send result
      // is logged server-side either way, and the admin can re-hit the button
      // if the first one didn't land.
      const started = Date.now();
      sendStaffReinstateEmail({
        to: user.email,
        fullName: user.fullName,
        assignments,
        frontendUrl: config.frontendUrl,
        needsPhone: !user.phone,
        needsAvatar: !user.avatarUrl,
      })
        .then(() =>
          console.log(
            `[staff welcome] sent to ${user.email} in ${Date.now() - started}ms`
          )
        )
        .catch((err) =>
          console.error(
            `[staff welcome] failed for ${user.email} after ${Date.now() - started}ms:`,
            err
          )
        );

      await createAuditLog({
        action: 'STAFF_WELCOME_RESENT',
        userId: req.user!.userId,
        resourceType: 'User',
        resourceId: user.id,
        changes: {
          to: user.email,
          assignments: assignments
            .map((a) => `${a.locationName}: ${a.roleLabels.join(', ')}`)
            .join('; '),
        },
      });

      res.json({
        success: true,
        queued: true,
        message: `Welcome email queued for ${user.fullName} (${user.email}). They should see it within a minute.`,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/staff/:id/role
 * Update a staff member's global role.
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
 * Update a staff member's location assignments with multi-role support.
 * Body: { assignments: [{ locationId, roles: ['PITCHING_COORDINATOR', 'YOUTH_COORDINATOR'] }] }
 * Also supports legacy format: { assignments: [{ locationId, locationRole }] }
 */
router.put('/:id/locations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const staffId = param(req, 'id');
    const { assignments, locationIds } = req.body as {
      assignments?: { locationId: string; roles?: LocationRole[]; locationRole?: LocationRole }[];
      locationIds?: string[];
    };

    let locationAssignments: { locationId: string; roles: LocationRole[] }[];

    if (assignments && Array.isArray(assignments)) {
      locationAssignments = assignments.map((a) => {
        if (!a.locationId) throw ApiError.badRequest('Each assignment must have a locationId');
        // Support both new format (roles array) and legacy (locationRole single)
        const roles = a.roles && Array.isArray(a.roles) && a.roles.length > 0
          ? a.roles
          : a.locationRole ? [a.locationRole] : [LocationRole.COACH];
        // Validate roles
        for (const r of roles) {
          if (!VALID_ROLES.includes(r)) {
            throw ApiError.badRequest(`Invalid role: ${r}`);
          }
        }
        return { locationId: a.locationId, roles };
      });
    } else if (locationIds && Array.isArray(locationIds)) {
      locationAssignments = locationIds.map((locationId) => ({
        locationId,
        roles: [LocationRole.COACH],
      }));
    } else {
      throw ApiError.badRequest('Provide assignments array');
    }

    // Remove existing assignments
    await prisma.staffLocation.deleteMany({ where: { staffId } });

    // Create new assignments
    if (locationAssignments.length > 0) {
      await prisma.staffLocation.createMany({
        data: locationAssignments.map((a) => ({
          staffId,
          locationId: a.locationId,
          roles: a.roles,
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

/**
 * DELETE /api/staff/:id
 * Deactivate a staff member (remove all location assignments, set role to CLIENT).
 *
 * Note: this is a soft-remove — we keep the user record so bookings, payments,
 * notes, and audit trail remain intact. If the admin later re-adds someone by
 * the same email, POST /api/staff/invite detects the demoted CLIENT state and
 * reinstates them in place (see the reinstate branch above).
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const staffId = param(req, 'id');

    // Don't let admin remove themselves
    if (staffId === req.user!.userId) {
      throw ApiError.badRequest('You cannot remove yourself');
    }

    // Remove all location assignments
    await prisma.staffLocation.deleteMany({ where: { staffId } });

    // Downgrade to client
    await prisma.user.update({
      where: { id: staffId },
      data: { role: Role.CLIENT },
    });

    await createAuditLog({
      action: 'STAFF_REMOVED',
      userId: req.user!.userId,
      resourceType: 'User',
      resourceId: staffId,
      changes: { action: 'removed_from_staff' },
    });

    res.json({ success: true, message: 'Staff member removed' });
  } catch (error) {
    next(error);
  }
});

// ============================================================
// PUBLIC ROUTES — Staff invite acceptance (no auth required)
// ============================================================

// These are registered in the main app before the auth middleware
// See staffPublicRoutes export below

export const staffPublicRouter = Router();

/**
 * GET /api/staff/invite/:token
 * Get invite details for the profile setup page.
 */
staffPublicRouter.get('/invite/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = param(req, 'token');

    const invite = await prisma.staffInvite.findUnique({ where: { token } });
    if (!invite) throw ApiError.notFound('Invitation not found');
    if (invite.usedAt) throw ApiError.badRequest('This invitation has already been used');
    if (invite.expiresAt < new Date()) throw ApiError.badRequest('This invitation has expired');

    // Resolve location names
    const locationIds = (invite.locations as any[]).map((l) => l.locationId);
    const locations = await prisma.location.findMany({
      where: { id: { in: locationIds } },
      select: { id: true, name: true },
    });

    const enrichedLocations = (invite.locations as any[]).map((l) => ({
      ...l,
      locationName: locations.find((loc) => loc.id === l.locationId)?.name || 'Unknown',
      roleLabels: l.roles.map((r: string) => ROLE_LABELS[r] || r),
    }));

    res.json({
      success: true,
      data: {
        fullName: invite.fullName,
        email: invite.email,
        phone: invite.phone,
        role: invite.role,
        locations: enrichedLocations,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/staff/invite/:token/accept
 * Accept invitation and create the staff account.
 * Body: { password, phone?, profileImageUrl? }
 */
staffPublicRouter.post('/invite/:token/accept', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = param(req, 'token');
    const { password, phone, profileImageUrl } = req.body;

    if (!password || password.length < 8) {
      throw ApiError.badRequest('Password must be at least 8 characters');
    }

    const invite = await prisma.staffInvite.findUnique({ where: { token } });
    if (!invite) throw ApiError.notFound('Invitation not found');
    if (invite.usedAt) throw ApiError.badRequest('This invitation has already been used');
    if (invite.expiresAt < new Date()) throw ApiError.badRequest('This invitation has expired');

    // Check if email is already taken
    const existing = await prisma.user.findUnique({ where: { email: invite.email } });
    if (existing) throw ApiError.conflict('An account with this email already exists');

    const passwordHash = await bcrypt.hash(password, 12);

    // Create user + location assignments in a transaction
    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: invite.email,
          passwordHash,
          fullName: invite.fullName,
          phone: phone || invite.phone || null,
          profileImageUrl: profileImageUrl || null,
          role: invite.role,
        },
      });

      // Create location assignments from invite
      const locationData = invite.locations as any[];
      if (locationData.length > 0) {
        await tx.staffLocation.createMany({
          data: locationData.map((l: any) => ({
            staffId: newUser.id,
            locationId: l.locationId,
            roles: l.roles as LocationRole[],
          })),
        });
      }

      // Mark invite as used
      await tx.staffInvite.update({
        where: { id: invite.id },
        data: { usedAt: new Date() },
      });

      return newUser;
    });

    await createAuditLog({
      action: 'STAFF_JOINED',
      userId: user.id,
      resourceType: 'User',
      resourceId: user.id,
      changes: { fullName: user.fullName, email: user.email, inviteId: invite.id },
    });

    res.status(201).json({
      success: true,
      message: `Welcome to the team, ${user.fullName}!`,
      data: { id: user.id, fullName: user.fullName, email: user.email },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
