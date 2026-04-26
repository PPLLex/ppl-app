/**
 * Custom fields — Phase 1B foundation.
 *
 * Per-organization field definitions that can be attached to Lead, User, or
 * AthleteProfile. Field types: TEXT, LONG_TEXT, NUMBER, DATE, BOOLEAN,
 * SELECT, MULTI_SELECT, EMAIL, URL, PHONE.
 *
 * Endpoints:
 *   GET    /api/custom-fields                       all defs (filter by ?entityType=)
 *   POST   /api/custom-fields                       create a definition
 *   PATCH  /api/custom-fields/:id                   rename / reorder / toggle active
 *   DELETE /api/custom-fields/:id                   delete (cascades to values)
 *
 *   GET    /api/custom-fields/values/:entityType/:entityId    read all values
 *   PUT    /api/custom-fields/values/:entityType/:entityId    upsert by slug
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate } from '../middleware/auth';
import { requireAnyRole } from '../services/roleService';
import { CustomFieldEntity, CustomFieldType, Role } from '@prisma/client';

const router = Router();

router.use(
  authenticate,
  requireAnyRole(
    Role.ADMIN,
    Role.COORDINATOR,
    Role.CONTENT_MARKETING_ADMIN,
    Role.CONTENT_MARKETING,
    Role.PERFORMANCE_COACH,
    Role.MEDICAL_ADMIN,
    Role.MEDICAL
  )
);

function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

// Slug helper — same logic the lead-form serializer uses elsewhere.
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

/**
 * GET /api/custom-fields
 * Optional ?entityType=LEAD|USER|ATHLETE_PROFILE
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { entityType, includeInactive } = req.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = { organizationId: 'ppl' };
    if (entityType && (Object.values(CustomFieldEntity) as string[]).includes(entityType)) {
      where.entityType = entityType;
    }
    if (includeInactive !== 'true') where.active = true;
    const fields = await prisma.customFieldDefinition.findMany({
      where: where as any,
      orderBy: [{ entityType: 'asc' }, { order: 'asc' }, { name: 'asc' }],
    });
    res.json({ success: true, data: fields });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/custom-fields
 * Body: { name, entityType, fieldType, config?, required?, order? }
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      name,
      entityType,
      fieldType,
      config,
      required,
      order,
    } = req.body as Record<string, unknown>;
    if (!name || typeof name !== 'string') throw ApiError.badRequest('name is required');
    if (!entityType || !(Object.values(CustomFieldEntity) as string[]).includes(String(entityType))) {
      throw ApiError.badRequest('entityType must be LEAD, USER, or ATHLETE_PROFILE');
    }
    if (!fieldType || !(Object.values(CustomFieldType) as string[]).includes(String(fieldType))) {
      throw ApiError.badRequest('fieldType is required and must be a valid CustomFieldType');
    }

    const slug = slugify(name);
    if (!slug) throw ApiError.badRequest('name produced an empty slug — use letters/numbers');

    const definition = await prisma.customFieldDefinition.create({
      data: {
        organizationId: 'ppl',
        name: name.trim(),
        slug,
        entityType: entityType as CustomFieldEntity,
        fieldType: fieldType as CustomFieldType,
        config: (config as any) ?? null,
        required: required === true,
        order: typeof order === 'number' ? order : 0,
      },
    });
    res.status(201).json({ success: true, data: definition });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('Unique constraint')) {
      return next(ApiError.conflict('A field with that name already exists for this entity type'));
    }
    next(err);
  }
});

/**
 * PATCH /api/custom-fields/:id
 * Body: { name?, config?, required?, order?, active? }
 * fieldType + entityType are immutable — delete and recreate to change.
 */
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const { name, config, required, order, active } = req.body as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    if (typeof name === 'string' && name.trim()) data.name = name.trim();
    if (config !== undefined) data.config = config as any;
    if (typeof required === 'boolean') data.required = required;
    if (typeof order === 'number') data.order = order;
    if (typeof active === 'boolean') data.active = active;
    const def = await prisma.customFieldDefinition.update({ where: { id }, data: data as any });
    res.json({ success: true, data: def });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/custom-fields/:id   Cascades to values.
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    await prisma.customFieldDefinition.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/custom-fields/values/:entityType/:entityId
 * Returns all custom values for a given subject, expanded with field def.
 */
router.get('/values/:entityType/:entityId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entityType = param(req, 'entityType').toUpperCase();
    const entityId = param(req, 'entityId');
    if (!(Object.values(CustomFieldEntity) as string[]).includes(entityType)) {
      throw ApiError.badRequest('entityType must be LEAD, USER, or ATHLETE_PROFILE');
    }

    const where: Record<string, unknown> = {};
    if (entityType === CustomFieldEntity.LEAD) where.leadId = entityId;
    else if (entityType === CustomFieldEntity.USER) where.userId = entityId;
    else where.athleteProfileId = entityId;

    const values = await prisma.customFieldValue.findMany({
      where: where as any,
      include: { field: true },
    });
    res.json({ success: true, data: values });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/custom-fields/values/:entityType/:entityId
 * Body: { values: { [fieldSlug]: value } }
 *
 * Upserts each provided value. Pass an empty string or null to clear.
 */
router.put('/values/:entityType/:entityId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entityType = param(req, 'entityType').toUpperCase();
    const entityId = param(req, 'entityId');
    if (!(Object.values(CustomFieldEntity) as string[]).includes(entityType)) {
      throw ApiError.badRequest('entityType must be LEAD, USER, or ATHLETE_PROFILE');
    }
    const { values } = req.body as { values?: Record<string, unknown> };
    if (!values || typeof values !== 'object') {
      throw ApiError.badRequest('Body must include a values object keyed by field slug');
    }

    // Look up all field definitions for this entity type so we can map
    // slug → fieldId.
    const defs = await prisma.customFieldDefinition.findMany({
      where: { organizationId: 'ppl', entityType: entityType as CustomFieldEntity },
    });
    const bySlug = new Map(defs.map((d) => [d.slug, d]));

    const ops: Promise<unknown>[] = [];
    for (const [slug, raw] of Object.entries(values)) {
      const def = bySlug.get(slug);
      if (!def) continue; // ignore unknown slugs (frontend may have stale schema)

      // Encode multi-select arrays as JSON; everything else stringify-as-is.
      let value: string | null = null;
      if (raw === null || raw === undefined || raw === '') {
        value = null;
      } else if (Array.isArray(raw)) {
        value = JSON.stringify(raw);
      } else {
        value = String(raw);
      }

      const baseWhere =
        entityType === CustomFieldEntity.LEAD
          ? { fieldId_leadId: { fieldId: def.id, leadId: entityId } }
          : entityType === CustomFieldEntity.USER
          ? { fieldId_userId: { fieldId: def.id, userId: entityId } }
          : { fieldId_athleteProfileId: { fieldId: def.id, athleteProfileId: entityId } };

      ops.push(
        prisma.customFieldValue.upsert({
          where: baseWhere as any,
          create: {
            fieldId: def.id,
            leadId: entityType === CustomFieldEntity.LEAD ? entityId : null,
            userId: entityType === CustomFieldEntity.USER ? entityId : null,
            athleteProfileId:
              entityType === CustomFieldEntity.ATHLETE_PROFILE ? entityId : null,
            value,
          },
          update: { value },
        })
      );
    }
    await Promise.all(ops);
    res.json({ success: true, count: ops.length });
  } catch (err) {
    next(err);
  }
});

export default router;
