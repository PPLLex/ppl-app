/**
 * Tagging system — Phase 1A foundation.
 *
 * Tags can be attached to Leads, Users, or AthleteProfiles. Used for:
 *   - Audience segmentation in marketing campaigns (#22, #23)
 *   - Filtering on dashboards
 *   - Scoping workflow triggers
 *   - Quick visual context in lists
 *
 * Built-in tags (system: true) are seeded on bootstrap and can't be deleted —
 * one per location, one per playing level, one per lifecycle stage. Anything
 * else is custom and admins can CRUD freely.
 *
 * Endpoints:
 *   GET    /api/tags                     list all tags (filter by ?kind=)
 *   POST   /api/tags                     create a custom tag
 *   PATCH  /api/tags/:id                 rename / recolor
 *   DELETE /api/tags/:id                 delete (system tags rejected)
 *
 *   POST   /api/tags/:tagId/assign       attach to Lead/User/AthleteProfile
 *   DELETE /api/tags/:tagId/assign       detach
 *
 *   GET    /api/tags/by-subject/:type/:id  list tags on a specific subject
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate } from '../middleware/auth';
import { requireAnyRole } from '../services/roleService';
import { createAuditLog } from '../services/auditService';
import { Role, TagKind } from '@prisma/client';

const router = Router();

// All tag management requires auth + an admin/coordinator/marketing role.
router.use(
  authenticate,
  requireAnyRole(
    Role.ADMIN,
    Role.COORDINATOR,
    Role.CONTENT_MARKETING_ADMIN,
    Role.CONTENT_MARKETING
  )
);

function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

/**
 * GET /api/tags
 * Optional ?kind=LOCATION|PLAYING_LEVEL|LIFECYCLE|CUSTOM
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { kind } = req.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = { organizationId: 'ppl' };
    if (kind && (Object.values(TagKind) as string[]).includes(kind)) {
      where.kind = kind;
    }
    const tags = await prisma.tag.findMany({
      where: where as any,
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { assignments: true } } },
    });
    res.json({ success: true, data: tags });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/tags
 * Body: { name, color?, kind?, description? }
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, color, kind, description } = req.body as Record<string, unknown>;
    if (!name || typeof name !== 'string') throw ApiError.badRequest('name is required');
    const trimmed = name.trim();
    if (!trimmed) throw ApiError.badRequest('name is required');

    const tag = await prisma.tag.create({
      data: {
        organizationId: 'ppl',
        name: trimmed,
        color: typeof color === 'string' ? color : '#95C83C',
        kind:
          kind && (Object.values(TagKind) as string[]).includes(String(kind))
            ? (kind as TagKind)
            : TagKind.CUSTOM,
        description: typeof description === 'string' ? description : null,
        createdById: req.user?.userId ?? null,
      },
    });
    void createAuditLog({
      userId: req.user?.userId,
      action: 'tag.created',
      resourceType: 'tag',
      resourceId: tag.id,
      changes: { name: tag.name, color: tag.color, kind: tag.kind },
    });
    res.status(201).json({ success: true, data: tag });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('Unique constraint')) {
      return next(ApiError.conflict('A tag with that name already exists'));
    }
    next(err);
  }
});

/**
 * PATCH /api/tags/:id
 * Body: { name?, color?, description? }   (kind is immutable; system tags
 * can be recolored but not renamed.)
 */
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const { name, color, description } = req.body as Record<string, unknown>;

    const existing = await prisma.tag.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound('Tag not found');

    const data: Record<string, unknown> = {};
    if (typeof color === 'string') data.color = color;
    if (typeof description === 'string') data.description = description;
    if (typeof name === 'string' && name.trim()) {
      if (existing.system) {
        throw ApiError.badRequest('System tags cannot be renamed (color and description still updatable)');
      }
      data.name = name.trim();
    }

    const tag = await prisma.tag.update({ where: { id }, data: data as any });
    void createAuditLog({
      userId: req.user?.userId,
      action: 'tag.updated',
      resourceType: 'tag',
      resourceId: tag.id,
      changes: data,
    });
    res.json({ success: true, data: tag });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/tags/:id   System tags can't be deleted.
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const existing = await prisma.tag.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound('Tag not found');
    if (existing.system) throw ApiError.badRequest('System tags cannot be deleted');
    await prisma.tag.delete({ where: { id } });
    void createAuditLog({
      userId: req.user?.userId,
      action: 'tag.deleted',
      resourceType: 'tag',
      resourceId: id,
      changes: { name: existing.name },
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/tags/:tagId/assign
 * Body: { leadId?, userId?, athleteProfileId?, expiresAt? }
 * Exactly one subject ID required.
 */
router.post('/:tagId/assign', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tagId = param(req, 'tagId');
    const { leadId, userId, athleteProfileId, expiresAt } = req.body as Record<string, unknown>;

    const subjectCount = [leadId, userId, athleteProfileId].filter(Boolean).length;
    if (subjectCount !== 1) {
      throw ApiError.badRequest('Provide exactly one of leadId, userId, athleteProfileId');
    }

    const tag = await prisma.tag.findUnique({ where: { id: tagId } });
    if (!tag) throw ApiError.notFound('Tag not found');

    try {
      const assignment = await prisma.tagAssignment.create({
        data: {
          tagId,
          leadId: typeof leadId === 'string' ? leadId : null,
          userId: typeof userId === 'string' ? userId : null,
          athleteProfileId: typeof athleteProfileId === 'string' ? athleteProfileId : null,
          assignedById: req.user?.userId ?? null,
          expiresAt: expiresAt ? new Date(String(expiresAt)) : null,
        },
      });
      res.status(201).json({ success: true, data: assignment });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('Unique constraint')) {
        return next(ApiError.conflict('Tag already assigned to that subject'));
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/tags/:tagId/assign
 * Body: { leadId?, userId?, athleteProfileId? }
 */
router.delete('/:tagId/assign', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tagId = param(req, 'tagId');
    const { leadId, userId, athleteProfileId } = req.body as Record<string, unknown>;
    if (![leadId, userId, athleteProfileId].some((v) => typeof v === 'string')) {
      throw ApiError.badRequest('Provide one of leadId, userId, athleteProfileId');
    }
    await prisma.tagAssignment.deleteMany({
      where: {
        tagId,
        leadId: typeof leadId === 'string' ? leadId : undefined,
        userId: typeof userId === 'string' ? userId : undefined,
        athleteProfileId: typeof athleteProfileId === 'string' ? athleteProfileId : undefined,
      },
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/tags/by-subject/:type/:id
 * type = 'lead' | 'user' | 'athlete'
 * Returns the full tags attached to that subject.
 */
router.get('/by-subject/:type/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const type = param(req, 'type');
    const id = param(req, 'id');
    const where: Record<string, unknown> = {};
    if (type === 'lead') where.leadId = id;
    else if (type === 'user') where.userId = id;
    else if (type === 'athlete') where.athleteProfileId = id;
    else throw ApiError.badRequest("type must be 'lead', 'user', or 'athlete'");

    const assignments = await prisma.tagAssignment.findMany({
      where: where as any,
      include: { tag: true },
    });
    res.json({ success: true, data: assignments.map((a) => a.tag) });
  } catch (err) {
    next(err);
  }
});

export default router;
