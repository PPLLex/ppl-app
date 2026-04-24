/**
 * Email campaigns API (foundation).
 *
 * This commit ships CRUD for EmailCampaign + a recipient-preview endpoint
 * so the Content & Marketing UI can build a campaign, save it as draft,
 * and see how many recipients the selected audience will hit before
 * scheduling. The actual send path (fan-out worker + Resend API calls +
 * webhook event handling) lands in a follow-up commit.
 *
 * Access: ADMIN, CONTENT_MARKETING_ADMIN, CONTENT_MARKETING only.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate } from '../middleware/auth';
import { requireAnyRole } from '../services/roleService';
import {
  CampaignAudience,
  CampaignStatus,
  CampaignType,
  Prisma,
  Role,
} from '@prisma/client';

const router = Router();

function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

router.use(
  authenticate,
  requireAnyRole(Role.ADMIN, Role.CONTENT_MARKETING_ADMIN, Role.CONTENT_MARKETING)
);

/**
 * GET /api/campaigns
 * List campaigns the caller can see (all for Admin / CM_ADMIN; own-created
 * for CM to start — can relax once the team's comfortable).
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, type } = req.query as Record<string, string>;

    const where: Prisma.EmailCampaignWhereInput = {};
    if (status && (Object.values(CampaignStatus) as string[]).includes(status)) {
      where.status = status as CampaignStatus;
    }
    if (type && (Object.values(CampaignType) as string[]).includes(type)) {
      where.type = type as CampaignType;
    }

    const campaigns = await prisma.emailCampaign.findMany({
      where,
      include: {
        createdBy: { select: { id: true, fullName: true } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 100,
    });

    res.json({ success: true, data: campaigns });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/campaigns — create a draft campaign.
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      name,
      subject,
      fromName,
      fromAddress,
      replyToAddress,
      bodyHtml,
      bodyText,
      type,
      audience,
      audienceFilter,
      scheduledFor,
    } = req.body as Record<string, unknown>;

    if (!name || !subject || !bodyHtml) {
      throw ApiError.badRequest('name, subject, and bodyHtml are required');
    }

    const campaign = await prisma.emailCampaign.create({
      data: {
        name: String(name),
        subject: String(subject),
        fromName: fromName ? String(fromName) : undefined,
        fromAddress: fromAddress ? String(fromAddress) : undefined,
        replyToAddress: replyToAddress ? String(replyToAddress) : null,
        bodyHtml: String(bodyHtml),
        bodyText: bodyText ? String(bodyText) : null,
        type:
          type && (Object.values(CampaignType) as string[]).includes(String(type))
            ? (type as CampaignType)
            : CampaignType.MARKETING,
        audience:
          audience && (Object.values(CampaignAudience) as string[]).includes(String(audience))
            ? (audience as CampaignAudience)
            : CampaignAudience.CUSTOM_SEGMENT,
        audienceFilter: (audienceFilter as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
        scheduledFor: scheduledFor ? new Date(String(scheduledFor)) : null,
        createdByUserId: req.user!.userId,
      },
    });

    res.status(201).json({ success: true, data: campaign });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/campaigns/:id — detail + recipient rollup
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const campaign = await prisma.emailCampaign.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, fullName: true, email: true } },
      },
    });
    if (!campaign) throw ApiError.notFound('Campaign not found');
    res.json({ success: true, data: campaign });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/campaigns/:id — edit a DRAFT or SCHEDULED campaign. Locked
 * fields: once SENDING/SENT/CANCELLED/FAILED, no more edits.
 */
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const existing = await prisma.emailCampaign.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound('Campaign not found');
    const editableStates: CampaignStatus[] = [CampaignStatus.DRAFT, CampaignStatus.SCHEDULED];
    if (!editableStates.includes(existing.status)) {
      throw ApiError.badRequest(
        `Cannot edit a campaign in status ${existing.status}; create a new campaign instead`
      );
    }

    const body = req.body as Record<string, unknown>;
    const updates: Prisma.EmailCampaignUpdateInput = {};
    const editable = [
      'name',
      'subject',
      'fromName',
      'fromAddress',
      'replyToAddress',
      'bodyHtml',
      'bodyText',
    ] as const;
    for (const k of editable) {
      if (typeof body[k] === 'string') (updates as Record<string, unknown>)[k] = body[k];
    }
    if (body.type && (Object.values(CampaignType) as string[]).includes(String(body.type))) {
      updates.type = body.type as CampaignType;
    }
    if (body.audience && (Object.values(CampaignAudience) as string[]).includes(String(body.audience))) {
      updates.audience = body.audience as CampaignAudience;
    }
    if ('audienceFilter' in body) {
      updates.audienceFilter =
        (body.audienceFilter as Prisma.InputJsonValue | null) ?? Prisma.JsonNull;
    }
    if ('scheduledFor' in body) {
      updates.scheduledFor =
        body.scheduledFor === null ? null : new Date(String(body.scheduledFor));
    }
    if (body.status && (Object.values(CampaignStatus) as string[]).includes(String(body.status))) {
      // Allow DRAFT ↔ SCHEDULED transitions via PATCH; everything else
      // goes through the dedicated /send and /cancel endpoints (once shipped).
      const desired = body.status as CampaignStatus;
      if (desired === CampaignStatus.DRAFT || desired === CampaignStatus.SCHEDULED) {
        updates.status = desired;
      }
    }

    const campaign = await prisma.emailCampaign.update({ where: { id }, data: updates });
    res.json({ success: true, data: campaign });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/campaigns/:id — delete a DRAFT. Non-draft campaigns stay
 * around for historical stats; cancel them via status=CANCELLED instead.
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const existing = await prisma.emailCampaign.findUnique({ where: { id }, select: { status: true } });
    if (!existing) throw ApiError.notFound('Campaign not found');
    if (existing.status !== CampaignStatus.DRAFT) {
      throw ApiError.badRequest(
        `Only DRAFT campaigns can be deleted; set status=CANCELLED to archive instead`
      );
    }
    await prisma.emailCampaign.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/campaigns/:id/audience-preview
 * Compute how many recipients this campaign would hit if sent right now.
 * Doesn't actually create CampaignRecipient rows — just returns the count
 * and a sample of the first 10 matches so the CM UI can show a preview.
 *
 * The real fan-out worker (follow-up commit) will reuse this resolution
 * logic to populate CampaignRecipient rows at send time.
 */
router.get('/:id/audience-preview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const campaign = await prisma.emailCampaign.findUnique({ where: { id } });
    if (!campaign) throw ApiError.notFound('Campaign not found');

    const filter = (campaign.audienceFilter as Record<string, unknown> | null) || {};
    const recipients = await resolveAudience(campaign.audience, filter);

    res.json({
      success: true,
      data: {
        totalRecipients: recipients.length,
        sample: recipients.slice(0, 10),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Resolve a CampaignAudience + filter into the list of recipient emails
 * that would receive the campaign. Returns at most 10,000 recipients to
 * cap memory usage — campaigns larger than that will be paginated in the
 * real fan-out worker.
 */
async function resolveAudience(
  audience: CampaignAudience,
  filter: Record<string, unknown>
): Promise<Array<{ email: string; fullName: string | null; userId?: string; leadId?: string }>> {
  switch (audience) {
    case CampaignAudience.ALL_MEMBERS: {
      const memberships = await prisma.clientMembership.findMany({
        where: { status: { in: ['ACTIVE', 'PAST_DUE'] } },
        select: { client: { select: { id: true, email: true, fullName: true } } },
        take: 10000,
      });
      return dedupeByEmail(
        memberships.map((m) => ({
          userId: m.client.id,
          email: m.client.email,
          fullName: m.client.fullName,
        }))
      );
    }
    case CampaignAudience.ALL_PARENTS: {
      const rows = await prisma.userRole.findMany({
        where: { role: Role.PARENT },
        select: { user: { select: { id: true, email: true, fullName: true } } },
        take: 10000,
      });
      return dedupeByEmail(
        rows.map((r) => ({
          userId: r.user.id,
          email: r.user.email,
          fullName: r.user.fullName,
        }))
      );
    }
    case CampaignAudience.ALL_ATHLETES: {
      const rows = await prisma.userRole.findMany({
        where: { role: Role.ATHLETE },
        select: { user: { select: { id: true, email: true, fullName: true } } },
        take: 10000,
      });
      return dedupeByEmail(
        rows.map((r) => ({
          userId: r.user.id,
          email: r.user.email,
          fullName: r.user.fullName,
        }))
      );
    }
    case CampaignAudience.ALL_LEADS: {
      const leads = await prisma.lead.findMany({
        where: {
          stage: {
            notIn: ['CLOSED_LOST' as const, 'CLOSED_WON' as const],
          },
        },
        select: { id: true, email: true, firstName: true, lastName: true },
        take: 10000,
      });
      return leads.map((l) => ({
        leadId: l.id,
        email: l.email,
        fullName: `${l.firstName} ${l.lastName}`.trim(),
      }));
    }
    case CampaignAudience.PAST_DUE_MEMBERS: {
      const memberships = await prisma.clientMembership.findMany({
        where: { status: 'PAST_DUE' },
        select: { client: { select: { id: true, email: true, fullName: true } } },
        take: 10000,
      });
      return dedupeByEmail(
        memberships.map((m) => ({
          userId: m.client.id,
          email: m.client.email,
          fullName: m.client.fullName,
        }))
      );
    }
    case CampaignAudience.LOCATION_MEMBERS: {
      const locationId = typeof filter.locationId === 'string' ? filter.locationId : null;
      if (!locationId) return [];
      const memberships = await prisma.clientMembership.findMany({
        where: { locationId, status: { in: ['ACTIVE', 'PAST_DUE'] } },
        select: { client: { select: { id: true, email: true, fullName: true } } },
        take: 10000,
      });
      return dedupeByEmail(
        memberships.map((m) => ({
          userId: m.client.id,
          email: m.client.email,
          fullName: m.client.fullName,
        }))
      );
    }
    case CampaignAudience.AGE_GROUP: {
      const ageGroup = typeof filter.ageGroup === 'string' ? filter.ageGroup : null;
      if (!ageGroup) return [];
      const athletes = await prisma.athleteProfile.findMany({
        where: { ageGroup },
        select: { user: { select: { id: true, email: true, fullName: true } } },
        take: 10000,
      });
      return dedupeByEmail(
        athletes.map((a) => ({
          userId: a.user.id,
          email: a.user.email,
          fullName: a.user.fullName,
        }))
      );
    }
    case CampaignAudience.IMPORTED_LIST: {
      const emails = Array.isArray(filter.emails) ? (filter.emails as unknown[]) : [];
      return emails
        .filter((e): e is string => typeof e === 'string')
        .map((email) => ({ email: email.toLowerCase(), fullName: null }));
    }
    case CampaignAudience.CUSTOM_SEGMENT:
      // Reserved for the future segment builder. For now, returns empty.
      return [];
    default:
      return [];
  }
}

function dedupeByEmail<T extends { email: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const key = r.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export default router;
