/**
 * Educational Resources — admin-curated content (videos, guides,
 * onboarding explainers) surfaced on the parent dashboard via the
 * EducationalContent widget.
 *
 * Routes:
 *   GET    /api/educational-resources           — public list (auth only)
 *   GET    /api/educational-resources/:id       — single resource (auth only)
 *   POST   /api/educational-resources           — admin create
 *   PUT    /api/educational-resources/:id       — admin update
 *   DELETE /api/educational-resources/:id       — admin delete
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();

// Helper: param extraction that tolerates express array-params weirdness.
const param = (req: Request, key: string): string =>
  Array.isArray(req.params[key]) ? (req.params[key] as string[])[0] : (req.params[key] as string);

/**
 * GET /api/educational-resources
 * Authenticated read — every signed-in user can list published resources.
 * Supports optional ?ageGroup=youth filter to match the current user's
 * AthleteProfile age group.
 */
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ageGroup = typeof req.query.ageGroup === 'string' ? req.query.ageGroup : null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p: any = prisma;
    const all = await p.educationalResource.findMany({
      where: { isPublished: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
    // Post-filter by ageGroup if specified. ageGroupFilter is a comma-
    // separated allow-list; null means "all age groups."
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const visible = all.filter((r: any) => {
      if (!r.ageGroupFilter) return true;
      if (!ageGroup) return true; // we don't know the user's age group; show everything
      const allowed = r.ageGroupFilter.split(',').map((s: string) => s.trim());
      return allowed.includes(ageGroup);
    });
    res.json({ success: true, data: visible });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/educational-resources/:id
 */
router.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p: any = prisma;
    const row = await p.educationalResource.findUnique({ where: { id } });
    if (!row) throw ApiError.notFound('Resource not found');
    res.json({ success: true, data: row });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/educational-resources
 * Admin create.
 */
router.post('/', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, description, body, videoUrl, thumbnailUrl, category, ageGroupFilter, sortOrder, isPublished } = req.body;
    if (!title || typeof title !== 'string') throw ApiError.badRequest('title is required');
    if (!description || typeof description !== 'string') throw ApiError.badRequest('description is required');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p: any = prisma;
    const row = await p.educationalResource.create({
      data: {
        title,
        description,
        body: body || null,
        videoUrl: videoUrl || null,
        thumbnailUrl: thumbnailUrl || null,
        category: category || 'general',
        ageGroupFilter: ageGroupFilter || null,
        sortOrder: typeof sortOrder === 'number' ? sortOrder : 0,
        isPublished: isPublished !== false,
      },
    });
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/educational-resources/:id
 * Admin update. Partial update semantics.
 */
router.put('/:id', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const { title, description, body, videoUrl, thumbnailUrl, category, ageGroupFilter, sortOrder, isPublished } = req.body;
    const data: Record<string, unknown> = {};
    if (title !== undefined) data.title = title;
    if (description !== undefined) data.description = description;
    if (body !== undefined) data.body = body || null;
    if (videoUrl !== undefined) data.videoUrl = videoUrl || null;
    if (thumbnailUrl !== undefined) data.thumbnailUrl = thumbnailUrl || null;
    if (category !== undefined) data.category = category;
    if (ageGroupFilter !== undefined) data.ageGroupFilter = ageGroupFilter || null;
    if (sortOrder !== undefined) data.sortOrder = sortOrder;
    if (isPublished !== undefined) data.isPublished = !!isPublished;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p: any = prisma;
    const row = await p.educationalResource.update({ where: { id }, data });
    res.json({ success: true, data: row });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/educational-resources/:id
 * Admin delete.
 */
router.delete('/:id', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p: any = prisma;
    await p.educationalResource.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
