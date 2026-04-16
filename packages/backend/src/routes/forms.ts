import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate, requireStaffOrAdmin, requireAdmin } from '../middleware/auth';
import { Role } from '@prisma/client';

const router = Router();

function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

// ============================================================
// FORM TEMPLATES â admin/staff create forms
// ============================================================

/**
 * POST /api/forms
 * Admin/Staff: create a new form template
 * Fields format: [{ name: "velocity_goal", type: "text|number|select|checkbox|textarea", label: "...", required: true, options: ["a","b"] }]
 */
router.post('/', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const { title, description, fields, isOnboarding } = req.body;

    if (!title) throw ApiError.badRequest('Form title is required');
    if (!fields || !Array.isArray(fields) || fields.length === 0) {
      throw ApiError.badRequest('Form must have at least one field');
    }

    // Validate each field has at minimum name, type, and label
    for (const field of fields) {
      if (!field.name || !field.type || !field.label) {
        throw ApiError.badRequest('Each field must have name, type, and label');
      }
      const validTypes = ['text', 'number', 'select', 'checkbox', 'textarea', 'date', 'email', 'phone', 'multiselect'];
      if (!validTypes.includes(field.type)) {
        throw ApiError.badRequest(`Invalid field type "${field.type}". Must be one of: ${validTypes.join(', ')}`);
      }
    }

    const form = await prisma.formTemplate.create({
      data: {
        createdById: user.userId,
        title: title.trim(),
        description: description?.trim() || null,
        fields,
        isOnboarding: isOnboarding || false,
      },
      include: {
        createdBy: { select: { id: true, fullName: true } },
      },
    });

    res.status(201).json({ data: form });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/forms
 * List all active form templates.
 * Clients see active non-onboarding forms + their required onboarding forms.
 * Staff/Admin see all.
 */
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const { onboarding } = req.query;

    const where: Record<string, unknown> = { isActive: true };
    if (onboarding === 'true') where.isOnboarding = true;
    if (onboarding === 'false') where.isOnboarding = false;

    const forms = await prisma.formTemplate.findMany({
      where,
      include: {
        createdBy: { select: { id: true, fullName: true } },
        _count: { select: { responses: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // For clients, also check which forms they've already completed
    if (user.role === Role.CLIENT) {
      const myResponses = await prisma.formResponse.findMany({
        where: { athleteId: user.userId },
        select: { formId: true },
      });
      const completedFormIds = new Set(myResponses.map((r: { formId: string }) => r.formId));

      const formsWithStatus = forms.map((form: { id: string; [key: string]: unknown }) => ({
        ...form,
        isCompleted: completedFormIds.has(form.id),
      }));

      return res.json({ data: formsWithStatus });
    }

    res.json({ data: forms });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/forms/:formId
 * Get a single form template with its fields
 */
router.get('/:formId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const formId = param(req, 'formId');

    const form = await prisma.formTemplate.findUnique({
      where: { id: formId },
      include: {
        createdBy: { select: { id: true, fullName: true } },
      },
    });

    if (!form || !form.isActive) throw ApiError.notFound('Form not found');

    res.json({ data: form });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/forms/:formId
 * Admin: update a form template
 */
router.put('/:formId', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const formId = param(req, 'formId');
    const { title, description, fields, isOnboarding, isActive } = req.body;

    const existing = await prisma.formTemplate.findUnique({ where: { id: formId } });
    if (!existing) throw ApiError.notFound('Form not found');

    const updateData: Record<string, unknown> = {};
    if (title !== undefined) updateData.title = title.trim();
    if (description !== undefined) updateData.description = description?.trim() || null;
    if (fields !== undefined) updateData.fields = fields;
    if (isOnboarding !== undefined) updateData.isOnboarding = isOnboarding;
    if (isActive !== undefined) updateData.isActive = isActive;

    const form = await prisma.formTemplate.update({
      where: { id: formId },
      data: updateData,
    });

    res.json({ data: form });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// FORM RESPONSES â athletes fill out forms
// ============================================================

/**
 * POST /api/forms/:formId/respond
 * Submit (or update) a response to a form
 */
router.post('/:formId/respond', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const formId = param(req, 'formId');
    const { answers, athleteId } = req.body;

    if (!answers || typeof answers !== 'object') {
      throw ApiError.badRequest('Answers object is required');
    }

    // Staff/Admin can submit on behalf of an athlete
    const resolvedAthleteId = (user.role !== Role.CLIENT && athleteId) ? athleteId : user.userId;

    // Validate form exists
    const form = await prisma.formTemplate.findUnique({ where: { id: formId } });
    if (!form || !form.isActive) throw ApiError.notFound('Form not found');

    // Validate required fields
    const fields = form.fields as Array<{ name: string; required?: boolean; label: string }>;
    for (const field of fields) {
      if (field.required && (answers[field.name] === undefined || answers[field.name] === '')) {
        throw ApiError.badRequest(`"${field.label}" is required`);
      }
    }

    // Upsert â one response per athlete per form
    const response = await prisma.formResponse.upsert({
      where: { formId_athleteId: { formId, athleteId: resolvedAthleteId } },
      create: {
        formId,
        athleteId: resolvedAthleteId,
        answers,
      },
      update: {
        answers,
      },
    });

    res.status(201).json({ data: response });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/forms/:formId/responses
 * Admin/Staff: get all responses for a form
 */
router.get('/:formId/responses', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const formId = param(req, 'formId');

    const responses = await prisma.formResponse.findMany({
      where: { formId },
      include: {
        athlete: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ data: responses });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/forms/:formId/my-response
 * Client: get my own response to a form
 */
router.get('/:formId/my-response', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const formId = param(req, 'formId');

    const response = await prisma.formResponse.findUnique({
      where: { formId_athleteId: { formId, athleteId: user.userId } },
    });

    res.json({ data: response });
  } catch (err) {
    next(err);
  }
});

export default router;
