/**
 * Admin-only email preview + test-send endpoints.
 *
 * Lets admins preview the rendered HTML of any role-specific invite email
 * (and other transactional templates) with sample data, plus send a test
 * to themselves to see how it renders in their actual inbox.
 *
 * Why this matters:
 *   - The role-specific invite copy hits real recipients — being able to
 *     review + tweak the design before going live saves a lot of "oops"
 *     emails.
 *   - Email clients render HTML wildly differently; a Gmail / Outlook /
 *     Apple Mail test trip catches issues a code review can't.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import { ApiError } from '../utils/apiError';
import {
  buildInviteEmailByRole,
  roleDisplayName,
  sendEmail,
  sendInviteEmailByRole,
} from '../services/emailService';
import { config } from '../config';
import { Role } from '@prisma/client';

const router = Router();

router.use(authenticate, requireAdmin);

// All 10 invitable roles, in the order the admin UI dropdown shows them.
const PREVIEWABLE_ROLES: Role[] = [
  Role.ADMIN,
  Role.COORDINATOR,
  Role.PERFORMANCE_COACH,
  Role.CONTENT_MARKETING_ADMIN,
  Role.CONTENT_MARKETING,
  Role.MEDICAL_ADMIN,
  Role.MEDICAL,
  Role.PARTNERSHIP_COACH,
  Role.OUTSIDE_COACH,
  Role.PARENT,
  Role.ATHLETE,
];

/**
 * GET /api/email-preview/role-list
 * Returns the metadata the frontend uses to populate the role dropdown.
 */
router.get('/role-list', async (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: PREVIEWABLE_ROLES.map((r) => ({
      role: r,
      label: roleDisplayName(r),
    })),
  });
});

/**
 * GET /api/email-preview/invite/:role
 * Returns the rendered HTML + subject + plain-text fallback for a role-
 * specific invite email, populated with sample data so the admin can see
 * how it'll render before sending.
 *
 * Query overrides (so the admin can preview with their own copy choices):
 *   ?fullName=         default 'Sample Recipient'
 *   ?invitedByName=    default the requesting admin's name
 *   ?locationName=     default 'PPL Lexington'
 *   ?schoolName=       default 'Lafayette High School'
 */
router.get('/invite/:role', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const role = req.params.role as string;
    if (!(PREVIEWABLE_ROLES as string[]).includes(role)) {
      throw ApiError.badRequest(`Unknown role: ${role}`);
    }

    const fullName = (req.query.fullName as string) || 'Sample Recipient';
    const invitedByName =
      (req.query.invitedByName as string) || req.user?.email || 'Chad Martin';
    const locationName = (req.query.locationName as string) || 'PPL Lexington';
    const schoolName = (req.query.schoolName as string) || 'Lafayette High School';

    // Use a placeholder accept URL so the previewed email looks complete.
    // Live invites use a real tokenized URL.
    const acceptUrl = `${config.frontendUrl}/join/staff/preview-token-not-real`;

    const subject = `You\u2019re invited to PPL as a ${roleDisplayName(role)}`;
    const html = buildInviteEmailByRole({
      fullName,
      invitedByName,
      role,
      // Only attach scope when relevant to this role.
      locationName: needsLocationScope(role as Role) ? locationName : null,
      schoolName: role === Role.PARTNERSHIP_COACH ? schoolName : null,
      acceptUrl,
      expiresInDays: 7,
    });

    res.json({
      success: true,
      data: {
        role,
        roleLabel: roleDisplayName(role),
        subject,
        html,
        // Plain-text fallback that mirrors what sendInviteEmailByRole sends
        // to clients that strip HTML.
        text: buildInviteTextFallback({
          role,
          fullName,
          invitedByName,
          locationName: needsLocationScope(role as Role) ? locationName : null,
          schoolName: role === Role.PARTNERSHIP_COACH ? schoolName : null,
          acceptUrl,
          expiresInDays: 7,
        }),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/email-preview/invite/:role/send-test
 * Send the previewed invite email to the requesting admin's own inbox.
 * Body: { to?: string }  — defaults to the admin's email
 */
router.post('/invite/:role/send-test', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const role = req.params.role as string;
    if (!(PREVIEWABLE_ROLES as string[]).includes(role)) {
      throw ApiError.badRequest(`Unknown role: ${role}`);
    }

    const to = ((req.body as { to?: string })?.to || req.user?.email || '').trim();
    if (!to) throw ApiError.badRequest('No recipient email');

    await sendInviteEmailByRole({
      to,
      fullName: 'Sample Recipient',
      invitedByName: req.user?.email || 'PPL Admin',
      role,
      locationName: needsLocationScope(role as Role) ? 'PPL Lexington' : null,
      schoolName: role === Role.PARTNERSHIP_COACH ? 'Lafayette High School' : null,
      acceptUrl: `${config.frontendUrl}/join/staff/preview-token-not-real`,
      expiresInDays: 7,
    });

    res.json({
      success: true,
      message: `Test invite for ${roleDisplayName(role)} sent to ${to}.`,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/email-preview/raw-test
 * Lets the admin send a fully-customized test email with a one-off
 * subject + body. Useful for designing new templates before they're
 * baked into the codebase.
 *
 * Body: { to?: string, subject: string, html: string, text?: string }
 */
router.post('/raw-test', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { to: rawTo, subject, html, text } = req.body as {
      to?: string;
      subject?: string;
      html?: string;
      text?: string;
    };

    if (!subject || !html) {
      throw ApiError.badRequest('subject and html are required');
    }
    const to = (rawTo || req.user?.email || '').trim();
    if (!to) throw ApiError.badRequest('No recipient email');

    const ok = await sendEmail({
      to,
      subject,
      text: text || stripHtml(html),
      html,
    });

    res.json({
      success: ok,
      message: ok ? `Test email sent to ${to}.` : 'Email send failed; check server logs.',
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// Helpers
// ============================================================

function needsLocationScope(role: Role): boolean {
  const scoped: Role[] = [
    Role.COORDINATOR,
    Role.PERFORMANCE_COACH,
    Role.CONTENT_MARKETING,
    Role.MEDICAL,
  ];
  return scoped.includes(role);
}

/**
 * Plain-text fallback that mirrors sendInviteEmailByRole's text version
 * (kept in sync — if the body copy changes there, update here too).
 */
function buildInviteTextFallback(args: {
  role: string;
  fullName: string;
  invitedByName: string | null;
  locationName: string | null;
  schoolName: string | null;
  acceptUrl: string;
  expiresInDays: number;
}): string {
  const firstName = args.fullName.split(' ')[0];
  const roleLabel = roleDisplayName(args.role);
  const scopeLine = args.locationName
    ? `Location: ${args.locationName}`
    : args.schoolName
    ? `Partner school: ${args.schoolName}`
    : 'Global access across all PPL locations';

  return [
    `Hey ${firstName},`,
    '',
    args.invitedByName
      ? `${args.invitedByName} added you to PPL as a ${roleLabel}.`
      : `You've been added to PPL as a ${roleLabel}.`,
    scopeLine,
    '',
    `Accept and set a password: ${args.acceptUrl}`,
    `This link expires in ${args.expiresInDays} days.`,
  ].join('\n');
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export default router;
