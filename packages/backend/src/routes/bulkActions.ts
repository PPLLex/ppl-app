/**
 * Bulk-action endpoints (#U8 / PREMIUM_AUDIT).
 *
 * Lets admins / coordinators take action on multiple rows at once from
 * the CRM (leads) and Members lists. Every endpoint:
 *   - requires authenticated admin or staff
 *   - caps the batch at 200 rows (UI guards too, this is the safety net)
 *   - writes a single AuditLog row capturing the action + the IDs touched
 *   - returns { processed, skipped } so the UI can show "12 tagged, 1 already had it"
 *
 *   POST /api/bulk/tag-add        { tagId, userIds?, leadIds? }
 *   POST /api/bulk/tag-remove     { tagId, userIds?, leadIds? }
 *   POST /api/bulk/leads/stage    { leadIds, stage }
 *   POST /api/bulk/leads/owner    { leadIds, ownerUserId | null }
 *   POST /api/bulk/members/archive { userIds }    — sets isActive=false
 *   POST /api/bulk/members/restore { userIds }    — sets isActive=true
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate, requireStaffOrAdmin } from '../middleware/auth';
import { createAuditLog } from '../services/auditService';
import { PipelineStage } from '@prisma/client';

const router = Router();

const MAX_BATCH = 200;

function assertBatch<T>(arr: T[] | undefined, name: string): T[] {
  if (!Array.isArray(arr) || arr.length === 0) {
    throw ApiError.badRequest(`${name} must be a non-empty array`);
  }
  if (arr.length > MAX_BATCH) {
    throw ApiError.badRequest(`Batch size capped at ${MAX_BATCH}; got ${arr.length}`);
  }
  return arr;
}

router.use(authenticate, requireStaffOrAdmin);

// ============================================================
// POST /api/bulk/tag-add  { tagId, userIds?, leadIds? }
// Skips assignments that already exist (idempotent), counts them as
// "skipped" rather than failures.
// ============================================================

router.post('/tag-add', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tagId, userIds, leadIds } = req.body as {
      tagId?: string;
      userIds?: string[];
      leadIds?: string[];
    };
    if (!tagId) throw ApiError.badRequest('tagId is required');
    const tag = await prisma.tag.findUnique({ where: { id: tagId } });
    if (!tag) throw ApiError.notFound('Tag not found');

    const userTargets = userIds ? assertBatch(userIds, 'userIds') : [];
    const leadTargets = leadIds ? assertBatch(leadIds, 'leadIds') : [];
    if (userTargets.length === 0 && leadTargets.length === 0) {
      throw ApiError.badRequest('Provide userIds or leadIds');
    }

    let processed = 0;
    let skipped = 0;
    const assignedById = req.user!.userId;

    for (const userId of userTargets) {
      try {
        await prisma.tagAssignment.create({
          data: { tagId, userId, assignedById },
        });
        processed++;
      } catch (err) {
        if (err instanceof Error && err.message.includes('Unique constraint')) {
          skipped++;
        } else {
          throw err;
        }
      }
    }
    for (const leadId of leadTargets) {
      try {
        await prisma.tagAssignment.create({
          data: { tagId, leadId, assignedById },
        });
        processed++;
      } catch (err) {
        if (err instanceof Error && err.message.includes('Unique constraint')) {
          skipped++;
        } else {
          throw err;
        }
      }
    }

    void createAuditLog({
      userId: req.user!.userId,
      action: 'bulk.tag.added',
      resourceType: 'Tag',
      resourceId: tagId,
      changes: { userIds: userTargets, leadIds: leadTargets, processed, skipped },
    });

    res.json({ success: true, data: { processed, skipped } });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/bulk/tag-remove  { tagId, userIds?, leadIds? }
// ============================================================

router.post('/tag-remove', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tagId, userIds, leadIds } = req.body as {
      tagId?: string;
      userIds?: string[];
      leadIds?: string[];
    };
    if (!tagId) throw ApiError.badRequest('tagId is required');

    const userTargets = userIds ? assertBatch(userIds, 'userIds') : [];
    const leadTargets = leadIds ? assertBatch(leadIds, 'leadIds') : [];
    if (userTargets.length === 0 && leadTargets.length === 0) {
      throw ApiError.badRequest('Provide userIds or leadIds');
    }

    const userResult = userTargets.length
      ? await prisma.tagAssignment.deleteMany({
          where: { tagId, userId: { in: userTargets } },
        })
      : { count: 0 };
    const leadResult = leadTargets.length
      ? await prisma.tagAssignment.deleteMany({
          where: { tagId, leadId: { in: leadTargets } },
        })
      : { count: 0 };

    void createAuditLog({
      userId: req.user!.userId,
      action: 'bulk.tag.removed',
      resourceType: 'Tag',
      resourceId: tagId,
      changes: {
        userIds: userTargets,
        leadIds: leadTargets,
        removed: userResult.count + leadResult.count,
      },
    });

    res.json({ success: true, data: { processed: userResult.count + leadResult.count } });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/bulk/leads/stage  { leadIds, stage }
// Move many leads into one pipeline stage (drag-many-cards-at-once).
// Writes a STAGE_CHANGE LeadActivity for each so individual lead histories
// stay accurate.
// ============================================================

router.post('/leads/stage', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { leadIds, stage } = req.body as { leadIds?: string[]; stage?: PipelineStage };
    const ids = assertBatch(leadIds, 'leadIds');
    if (!stage) throw ApiError.badRequest('stage is required');

    const existing = await prisma.lead.findMany({
      where: { id: { in: ids } },
      select: { id: true, stage: true },
    });
    const stageMap = new Map(existing.map((l) => [l.id, l.stage]));
    const toUpdate = existing.filter((l) => l.stage !== stage).map((l) => l.id);

    if (toUpdate.length > 0) {
      await prisma.lead.updateMany({
        where: { id: { in: toUpdate } },
        data: { stage },
      });
      // One activity per lead so the lead detail page shows the bulk move.
      await prisma.leadActivity.createMany({
        data: toUpdate.map((leadId) => ({
          leadId,
          type: 'STAGE_CHANGE' as const,
          authorUserId: req.user!.userId,
          fromStage: stageMap.get(leadId) ?? null,
          toStage: stage,
          notes: 'Bulk action from the CRM kanban',
        })),
      });
    }

    void createAuditLog({
      userId: req.user!.userId,
      action: 'bulk.leads.stage_changed',
      resourceType: 'Lead',
      changes: { leadIds: ids, stage, processed: toUpdate.length },
    });

    res.json({
      success: true,
      data: { processed: toUpdate.length, skipped: ids.length - toUpdate.length },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/bulk/leads/owner  { leadIds, ownerUserId | null }
// Reassign or unassign owner across many leads at once.
// ============================================================

router.post('/leads/owner', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { leadIds, ownerUserId } = req.body as {
      leadIds?: string[];
      ownerUserId?: string | null;
    };
    const ids = assertBatch(leadIds, 'leadIds');

    if (ownerUserId) {
      const owner = await prisma.user.findUnique({
        where: { id: ownerUserId },
        select: { id: true, isActive: true },
      });
      if (!owner || !owner.isActive) {
        throw ApiError.badRequest('Owner not found or inactive');
      }
    }

    const result = await prisma.lead.updateMany({
      where: { id: { in: ids } },
      data: { ownerUserId: ownerUserId ?? null },
    });

    void createAuditLog({
      userId: req.user!.userId,
      action: 'bulk.leads.owner_changed',
      resourceType: 'Lead',
      changes: { leadIds: ids, ownerUserId: ownerUserId ?? null, processed: result.count },
    });

    res.json({ success: true, data: { processed: result.count } });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/bulk/members/archive  { userIds }
// Soft-archive — flips User.isActive=false. Doesn't cancel memberships
// or refund anything; admins still need to handle that side via the
// existing /admin/billing flow.
// ============================================================

router.post('/members/archive', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userIds } = req.body as { userIds?: string[] };
    const ids = assertBatch(userIds, 'userIds');

    // Safety: never let an admin archive themselves in a bulk call —
    // if they're in the list, they probably misclicked.
    const filtered = ids.filter((id) => id !== req.user!.userId);
    const skipped = ids.length - filtered.length;

    const result = await prisma.user.updateMany({
      where: { id: { in: filtered } },
      data: { isActive: false },
    });

    void createAuditLog({
      userId: req.user!.userId,
      action: 'bulk.members.archived',
      resourceType: 'User',
      changes: { userIds: filtered, processed: result.count, skipped },
    });

    res.json({ success: true, data: { processed: result.count, skipped } });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/bulk/members/restore  { userIds }
// ============================================================

router.post('/members/restore', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userIds } = req.body as { userIds?: string[] };
    const ids = assertBatch(userIds, 'userIds');

    const result = await prisma.user.updateMany({
      where: { id: { in: ids } },
      data: { isActive: true },
    });

    void createAuditLog({
      userId: req.user!.userId,
      action: 'bulk.members.restored',
      resourceType: 'User',
      changes: { userIds: ids, processed: result.count },
    });

    res.json({ success: true, data: { processed: result.count } });
  } catch (err) {
    next(err);
  }
});

export default router;
