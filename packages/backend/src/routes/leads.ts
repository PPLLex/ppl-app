/**
 * Leads / sales pipeline CRUD.
 *
 * All routes require authentication + a CRM-permitted role (ADMIN /
 * CONTENT_MARKETING_ADMIN / CONTENT_MARKETING / COORDINATOR).
 * Performance Coaches and Medical staff don't see leads in this first
 * iteration — we can open it up later once the team's happy with the
 * base flow.
 *
 * Scope for this foundation commit — basic CRUD + activity logging:
 *   GET    /api/leads                   list with filters
 *   POST   /api/leads                   create a lead (also used by public form intake later)
 *   GET    /api/leads/:id               detail + activity stream
 *   PATCH  /api/leads/:id               update fields (stage, owner, notes)
 *   POST   /api/leads/:id/activities    log an activity (NOTE / CALL / EMAIL_SENT / etc.)
 *   POST   /api/leads/:id/convert       mark CLOSED_WON + link to a User
 *   DELETE /api/leads/:id               soft-handled (actually hard delete for now;
 *                                       we can swap to soft-delete if Chad wants)
 *
 * Automations + email-blast integration + public form intake endpoint ship
 * in follow-up commits — this file is just the structured core so the UI
 * has something to talk to.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate } from '../middleware/auth';
import { requireAnyRole } from '../services/roleService';
import { createAuditLog } from '../services/auditService';
import {
  LeadActivityType,
  LeadSource,
  PipelineStage,
  Prisma,
  Role,
  WorkflowTrigger,
} from '@prisma/client';
import { emitTrigger } from '../services/workflowEngine';

const router = Router();

function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

// All lead routes require auth + a CRM-eligible role.
router.use(
  authenticate,
  requireAnyRole(
    Role.ADMIN,
    Role.CONTENT_MARKETING_ADMIN,
    Role.CONTENT_MARKETING,
    Role.COORDINATOR
  )
);

/**
 * GET /api/leads
 * Filters: ?stage=, ?source=, ?ownerUserId=, ?locationId=, ?q= (name/email search)
 * Returns leads ordered by nextFollowUpAt (null last), then createdAt desc.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stage, source, ownerUserId, locationId, q } = req.query as Record<string, string>;

    const where: Prisma.LeadWhereInput = {};
    if (stage && (Object.values(PipelineStage) as string[]).includes(stage)) {
      where.stage = stage as PipelineStage;
    }
    if (source && (Object.values(LeadSource) as string[]).includes(source)) {
      where.source = source as LeadSource;
    }
    if (ownerUserId) where.ownerUserId = ownerUserId;
    if (locationId) where.locationId = locationId;
    if (q) {
      const needle = q.trim();
      where.OR = [
        { firstName: { contains: needle, mode: 'insensitive' } },
        { lastName: { contains: needle, mode: 'insensitive' } },
        { email: { contains: needle, mode: 'insensitive' } },
      ];
    }

    const leads = await prisma.lead.findMany({
      where,
      include: {
        owner: { select: { id: true, fullName: true, email: true } },
        location: { select: { id: true, name: true } },
      },
      // Leads with an upcoming follow-up surface first, then everything else
      // by recency. Postgres sorts nulls last by default for DESC.
      orderBy: [{ nextFollowUpAt: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });

    res.json({ success: true, data: leads });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/leads
 * Body: { firstName, lastName, email, phone?, ageGroup?, source?, stage?,
 *         locationId?, ownerUserId?, notes?, sourceMetadata? }
 * Upserts by (organizationId, email) — repeat form submissions update the
 * existing row and log a FORM_SUBMISSION activity rather than creating
 * duplicate leads.
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      ageGroup,
      source,
      stage,
      locationId,
      ownerUserId,
      notes,
      sourceMetadata,
    } = req.body as Record<string, unknown>;

    if (!firstName || !lastName || !email) {
      throw ApiError.badRequest('firstName, lastName, and email are required');
    }

    const emailLower = String(email).toLowerCase();
    const existing = await prisma.lead.findFirst({
      where: { organizationId: 'ppl', email: emailLower },
    });

    const data = {
      firstName: String(firstName),
      lastName: String(lastName),
      email: emailLower,
      phone: phone ? String(phone) : null,
      ageGroup: ageGroup ? String(ageGroup) : null,
      source: (source && (Object.values(LeadSource) as string[]).includes(String(source))
        ? (source as LeadSource)
        : LeadSource.OTHER) as LeadSource,
      stage: (stage && (Object.values(PipelineStage) as string[]).includes(String(stage))
        ? (stage as PipelineStage)
        : PipelineStage.NEW) as PipelineStage,
      locationId: locationId ? String(locationId) : null,
      ownerUserId: ownerUserId ? String(ownerUserId) : null,
      notes: notes ? String(notes) : null,
      sourceMetadata: (sourceMetadata as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
    };

    const lead = existing
      ? await prisma.lead.update({
          where: { id: existing.id },
          data: {
            firstName: data.firstName,
            lastName: data.lastName,
            phone: data.phone ?? existing.phone,
            ageGroup: data.ageGroup ?? existing.ageGroup,
            // Don't downgrade the stage on a form resubmission — if they're
            // already QUALIFIED, leaving them at NEW would be wrong.
            // Only apply the new stage if it's "further" in the funnel.
            ...(shouldUpgradeStage(existing.stage, data.stage)
              ? { stage: data.stage }
              : {}),
            locationId: data.locationId ?? existing.locationId,
            sourceMetadata: data.sourceMetadata,
          },
        })
      : await prisma.lead.create({ data });

    // Log the form submission as an activity — whether this is a new lead
    // or a dedupe'd resubmission, we want the audit trail.
    await prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        type: existing ? LeadActivityType.FORM_SUBMISSION : LeadActivityType.NOTE,
        authorUserId: req.user!.userId,
        content: existing
          ? 'Resubmitted a form — details refreshed'
          : `Lead created by ${req.user!.email}`,
        metadata: data.sourceMetadata,
      },
    });

    await createAuditLog({
      action: existing ? 'LEAD_UPDATED' : 'LEAD_CREATED',
      userId: req.user!.userId,
      resourceType: 'Lead',
      resourceId: lead.id,
      changes: { firstName, lastName, email, source: data.source },
    });

    res.status(existing ? 200 : 201).json({ success: true, data: lead });
  } catch (err) {
    next(err);
  }
});

/**
 * Stage ordering for "further-in-funnel" check when deduping form subs.
 * If a form submission comes in for a lead already past NEW, we don't
 * want to drag them back.
 */
const STAGE_ORDER: Record<PipelineStage, number> = {
  NEW: 0,
  CONTACTED: 1,
  QUALIFIED: 2,
  ASSESSMENT_BOOKED: 3,
  ASSESSMENT_DONE: 4,
  CLOSED_WON: 5,
  CLOSED_LOST: 5, // Terminal, same rank as WON — don't resurrect lost leads
  NURTURE: 1, // Nurture can be bumped up by new activity
};

function shouldUpgradeStage(current: PipelineStage, incoming: PipelineStage): boolean {
  return STAGE_ORDER[incoming] > STAGE_ORDER[current];
}

/**
 * GET /api/leads/:id
 * Detail view with full activity stream.
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const lead = await prisma.lead.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, fullName: true, email: true } },
        location: { select: { id: true, name: true } },
        convertedToUser: { select: { id: true, fullName: true, email: true } },
        activities: {
          orderBy: { createdAt: 'desc' },
          include: {
            author: { select: { id: true, fullName: true } },
          },
          take: 100,
        },
      },
    });
    if (!lead) throw ApiError.notFound('Lead not found');
    res.json({ success: true, data: lead });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/leads/:id
 * Update any subset of { stage, ownerUserId, notes, nextFollowUpAt,
 * locationId, lostReason, phone, ageGroup }. Stage + owner changes also
 * log system activities so the history is self-documenting.
 */
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const existing = await prisma.lead.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound('Lead not found');

    const body = req.body as Record<string, unknown>;
    const updates: Prisma.LeadUpdateInput = {};

    if (typeof body.notes === 'string') updates.notes = body.notes;
    if (typeof body.lostReason === 'string') updates.lostReason = body.lostReason;
    if (typeof body.phone === 'string') updates.phone = body.phone;
    if (typeof body.ageGroup === 'string') updates.ageGroup = body.ageGroup;
    if (body.nextFollowUpAt === null) updates.nextFollowUpAt = null;
    if (typeof body.nextFollowUpAt === 'string') {
      const d = new Date(body.nextFollowUpAt);
      if (!isNaN(d.getTime())) updates.nextFollowUpAt = d;
    }
    if (typeof body.locationId === 'string') {
      updates.location = { connect: { id: body.locationId } };
    } else if (body.locationId === null) {
      updates.location = { disconnect: true };
    }

    let stageChanged: { from: PipelineStage; to: PipelineStage } | null = null;
    if (typeof body.stage === 'string' && (Object.values(PipelineStage) as string[]).includes(body.stage)) {
      const newStage = body.stage as PipelineStage;
      if (newStage !== existing.stage) {
        stageChanged = { from: existing.stage, to: newStage };
        updates.stage = newStage;
        if (newStage === PipelineStage.CLOSED_LOST && typeof body.lostReason === 'string') {
          updates.lostReason = body.lostReason;
        }
      }
    }

    let ownerChanged: { from: string | null; to: string | null } | null = null;
    if ('ownerUserId' in body) {
      const newOwner = body.ownerUserId === null ? null : String(body.ownerUserId);
      if (newOwner !== existing.ownerUserId) {
        ownerChanged = { from: existing.ownerUserId, to: newOwner };
        if (newOwner === null) {
          updates.owner = { disconnect: true };
        } else {
          updates.owner = { connect: { id: newOwner } };
        }
      }
    }

    const lead = await prisma.lead.update({ where: { id }, data: updates });

    // System-generated activity log entries for stage / owner changes so
    // the history in the detail view tells the full story.
    const systemActivities: Prisma.LeadActivityCreateManyInput[] = [];
    if (stageChanged) {
      systemActivities.push({
        leadId: id,
        type: LeadActivityType.STAGE_CHANGE,
        authorUserId: req.user!.userId,
        metadata: stageChanged as unknown as Prisma.InputJsonValue,
      });
    }
    if (ownerChanged) {
      systemActivities.push({
        leadId: id,
        type: LeadActivityType.ASSIGNED,
        authorUserId: req.user!.userId,
        metadata: ownerChanged as unknown as Prisma.InputJsonValue,
      });
    }
    if (systemActivities.length > 0) {
      await prisma.leadActivity.createMany({ data: systemActivities });
    }

    // Fire workflow trigger on stage change so workflows bound to
    // LEAD_STAGE_CHANGED { fromStage, toStage } can run.
    if (stageChanged) {
      emitTrigger(WorkflowTrigger.LEAD_STAGE_CHANGED, 'lead', id, {
        fromStage: stageChanged.from,
        toStage: stageChanged.to,
      });
    }

    res.json({ success: true, data: lead });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/leads/:id/activities
 * Log a manual activity on a lead.
 * Body: { type: LeadActivityType, content?: string, metadata?: object }
 */
router.post('/:id/activities', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const { type, content, metadata } = req.body as Record<string, unknown>;

    if (!type || !(Object.values(LeadActivityType) as string[]).includes(String(type))) {
      throw ApiError.badRequest('Invalid or missing activity type');
    }
    // System-only types can't be logged via this endpoint — they're created
    // internally by stage/owner changes.
    if (
      type === LeadActivityType.STAGE_CHANGE ||
      type === LeadActivityType.ASSIGNED
    ) {
      throw ApiError.badRequest(
        `${type} activities are system-generated and can't be logged manually`
      );
    }

    const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true } });
    if (!lead) throw ApiError.notFound('Lead not found');

    const activity = await prisma.leadActivity.create({
      data: {
        leadId: id,
        type: type as LeadActivityType,
        content: content ? String(content) : null,
        authorUserId: req.user!.userId,
        metadata: (metadata as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
      },
    });

    res.status(201).json({ success: true, data: activity });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/leads/:id/convert
 * Body: { userId: string } — mark the lead CLOSED_WON and link it to the
 * User who was created from this prospect.
 */
router.post('/:id/convert', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const { userId } = req.body as { userId?: string };
    if (!userId) throw ApiError.badRequest('userId is required');

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw ApiError.notFound('User not found');

    // Guard against double-conversion — convertedToUserId is UNIQUE so this
    // would fail at the DB level anyway, but a clean error beats a 500.
    const alreadyLinked = await prisma.lead.findUnique({
      where: { convertedToUserId: userId },
      select: { id: true },
    });
    if (alreadyLinked && alreadyLinked.id !== id) {
      throw ApiError.conflict('Another lead is already linked to this user');
    }

    const lead = await prisma.lead.update({
      where: { id },
      data: {
        stage: PipelineStage.CLOSED_WON,
        convertedAt: new Date(),
        convertedToUser: { connect: { id: userId } },
      },
    });

    await prisma.leadActivity.create({
      data: {
        leadId: id,
        type: LeadActivityType.STAGE_CHANGE,
        authorUserId: req.user!.userId,
        content: 'Lead converted — CLOSED_WON',
        metadata: { convertedToUserId: userId } as unknown as Prisma.InputJsonValue,
      },
    });

    res.json({ success: true, data: lead });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/leads/:id
 * Hard delete. Converted leads are blocked — you can't delete a lead
 * that's been linked to a member (keeps attribution intact).
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const existing = await prisma.lead.findUnique({ where: { id }, select: { convertedToUserId: true } });
    if (!existing) throw ApiError.notFound('Lead not found');
    if (existing.convertedToUserId) {
      throw ApiError.badRequest('Converted leads cannot be deleted — they preserve attribution');
    }
    await prisma.lead.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
