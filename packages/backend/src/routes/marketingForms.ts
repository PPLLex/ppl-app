/**
 * Marketing Forms — public-facing forms for lead intake, post-session
 * feedback, and surveys (#133, GHL parity item #18).
 *
 * Two surfaces:
 *   ADMIN  /api/marketing-forms[/:id]            CRUD + submission viewer
 *   PUBLIC /api/marketing-forms/by-slug/:slug    fetch + submit (no auth)
 *
 * Scheduled delivery is handled by the workflow engine: when a form's
 * `trigger` is anything other than MANUAL, scheduledFormSender cron pulls
 * eligible forms and emails them to the matching audience after the
 * configured delay.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate } from '../middleware/auth';
import { requireAnyRole } from '../services/roleService';
import { createAuditLog } from '../services/auditService';
import { sendEmail } from '../services/emailService';
import { Role, MarketingFormTrigger } from '@prisma/client';

const router = Router();

function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// ────────────────────────────────────────────────────────────────────
// PUBLIC endpoints — mounted BEFORE the auth middleware
// ────────────────────────────────────────────────────────────────────

/**
 * GET /api/marketing-forms/by-slug/:slug
 * Public — returns form schema for rendering. Hides admin-only fields.
 */
router.get('/by-slug/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = param(req, 'slug');
    const form = await prisma.marketingForm.findUnique({
      where: { organizationId_slug: { organizationId: 'ppl', slug } },
    });
    if (!form || !form.isActive || !form.isPublic) {
      throw ApiError.notFound('Form not found');
    }
    res.json({
      success: true,
      data: {
        id: form.id,
        slug: form.slug,
        name: form.name,
        description: form.description,
        fields: form.fields,
        submitMessage: form.submitMessage,
        redirectUrl: form.redirectUrl,
        collectEmail: form.collectEmail,
        collectName: form.collectName,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/marketing-forms/by-slug/:slug/submit
 * Public — accept a submission, optionally auto-create a lead.
 * Body: { payload, submitterEmail?, submitterName?, submitterPhone? }
 */
router.post('/by-slug/:slug/submit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = param(req, 'slug');
    const form = await prisma.marketingForm.findUnique({
      where: { organizationId_slug: { organizationId: 'ppl', slug } },
    });
    if (!form || !form.isActive || !form.isPublic) {
      throw ApiError.notFound('Form not found');
    }

    const body = req.body as {
      payload?: Record<string, unknown>;
      submitterEmail?: string;
      submitterName?: string;
      submitterPhone?: string;
    };
    if (!body.payload || typeof body.payload !== 'object') {
      throw ApiError.badRequest('payload required');
    }

    // Validate required fields against the form definition
    const fields = (form.fields as unknown as Array<{
      key: string;
      label: string;
      required?: boolean;
    }>) || [];
    for (const f of fields) {
      if (f.required) {
        const v = body.payload[f.key];
        if (v === undefined || v === null || v === '') {
          throw ApiError.badRequest(`Missing required field: ${f.label}`);
        }
      }
    }
    if (form.collectEmail && !body.submitterEmail) {
      throw ApiError.badRequest('Email is required');
    }

    // Try to match an existing lead/user by email so submissions stay
    // attributed across visits.
    let leadId: string | null = null;
    let userId: string | null = null;
    if (body.submitterEmail) {
      const email = body.submitterEmail.toLowerCase().trim();
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        userId = existingUser.id;
      } else {
        const existingLead = await prisma.lead.findUnique({
          where: { organizationId_email: { organizationId: 'ppl', email } },
        });
        if (existingLead) {
          leadId = existingLead.id;
        } else if (form.autoCreateLead) {
          const [firstName, ...rest] = (body.submitterName || 'Unknown').split(' ');
          const newLead = await prisma.lead.create({
            data: {
              organizationId: 'ppl',
              firstName: firstName || 'Unknown',
              lastName: rest.join(' ') || '',
              email,
              phone: body.submitterPhone || null,
              source: 'WEBSITE_FORM',
              sourceMetadata: { form: form.slug, payload: body.payload as object },
            },
          });
          leadId = newLead.id;
        }
      }
    }

    const submission = await prisma.marketingFormSubmission.create({
      data: {
        formId: form.id,
        payload: body.payload as object,
        submitterEmail: body.submitterEmail?.toLowerCase().trim() || null,
        submitterName: body.submitterName || null,
        submitterPhone: body.submitterPhone || null,
        leadId,
        userId,
        ipAddress: (req.headers['x-forwarded-for'] as string) || req.ip || null,
        userAgent: (req.headers['user-agent'] as string) || null,
        source: 'public',
      },
    });

    // Auto-tag if configured
    if (form.autoTagIds.length && (leadId || userId)) {
      await Promise.all(
        form.autoTagIds.map((tagId) =>
          prisma.tagAssignment.upsert({
            where: leadId
              ? { tagId_leadId: { tagId, leadId } }
              : { tagId_userId: { tagId, userId: userId! } },
            create: { tagId, leadId, userId },
            update: {},
          }).catch(() => null)
        )
      );
    }

    res.status(201).json({
      success: true,
      data: {
        id: submission.id,
        message: form.submitMessage || 'Thanks! Your submission was received.',
        redirectUrl: form.redirectUrl,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────────────────────────
// ADMIN endpoints — auth required
// ────────────────────────────────────────────────────────────────────

router.use(
  authenticate,
  requireAnyRole(
    Role.ADMIN,
    Role.COORDINATOR,
    Role.CONTENT_MARKETING_ADMIN,
    Role.CONTENT_MARKETING
  )
);

router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const forms = await prisma.marketingForm.findMany({
      where: { organizationId: 'ppl' },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { submissions: true } },
        createdBy: { select: { id: true, fullName: true } },
      },
    });
    res.json({ success: true, data: forms });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as {
      name?: string;
      slug?: string;
      description?: string;
      fields?: Array<unknown>;
      submitMessage?: string;
      redirectUrl?: string;
      collectEmail?: boolean;
      collectName?: boolean;
      isPublic?: boolean;
      trigger?: string;
      triggerDelayHours?: number;
      autoCreateLead?: boolean;
      autoTagIds?: string[];
    };

    if (!body.name) throw ApiError.badRequest('name is required');
    if (!Array.isArray(body.fields) || body.fields.length === 0) {
      throw ApiError.badRequest('fields array is required (at least one field)');
    }

    const baseSlug = slugify(body.slug || body.name);
    if (!baseSlug) throw ApiError.badRequest('Could not derive a valid slug from name');

    // Ensure unique slug — append -1, -2... if collision
    let slug = baseSlug;
    let suffix = 1;
    while (await prisma.marketingForm.findUnique({ where: { organizationId_slug: { organizationId: 'ppl', slug } } })) {
      slug = `${baseSlug}-${suffix++}`;
      if (suffix > 50) throw ApiError.badRequest('Could not generate unique slug');
    }

    const trigger =
      body.trigger && (Object.values(MarketingFormTrigger) as string[]).includes(body.trigger)
        ? (body.trigger as MarketingFormTrigger)
        : MarketingFormTrigger.MANUAL;

    const form = await prisma.marketingForm.create({
      data: {
        organizationId: 'ppl',
        slug,
        name: body.name.trim(),
        description: body.description ?? null,
        fields: body.fields as object,
        submitMessage: body.submitMessage ?? null,
        redirectUrl: body.redirectUrl ?? null,
        collectEmail: body.collectEmail !== false,
        collectName: body.collectName !== false,
        isPublic: body.isPublic !== false,
        trigger,
        triggerDelayHours: typeof body.triggerDelayHours === 'number' ? body.triggerDelayHours : 24,
        autoCreateLead: body.autoCreateLead === true,
        autoTagIds: Array.isArray(body.autoTagIds) ? (body.autoTagIds as string[]) : [],
        createdById: req.user?.userId ?? null,
      },
    });
    void createAuditLog({
      userId: req.user?.userId,
      action: 'marketing_form.created',
      resourceType: 'marketing_form',
      resourceId: form.id,
      changes: { name: form.name, slug: form.slug, trigger: form.trigger },
    });
    res.status(201).json({ success: true, data: form });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const form = await prisma.marketingForm.findUnique({
      where: { id: param(req, 'id') },
      include: {
        _count: { select: { submissions: true } },
        createdBy: { select: { id: true, fullName: true } },
      },
    });
    if (!form) throw ApiError.notFound('Form not found');
    res.json({ success: true, data: form });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const body = req.body as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    if (typeof body.name === 'string') data.name = body.name.trim();
    if (typeof body.description === 'string' || body.description === null) data.description = body.description;
    if (Array.isArray(body.fields)) data.fields = body.fields as object;
    if (typeof body.submitMessage === 'string' || body.submitMessage === null) data.submitMessage = body.submitMessage;
    if (typeof body.redirectUrl === 'string' || body.redirectUrl === null) data.redirectUrl = body.redirectUrl;
    if (typeof body.isActive === 'boolean') data.isActive = body.isActive;
    if (typeof body.isPublic === 'boolean') data.isPublic = body.isPublic;
    if (typeof body.collectEmail === 'boolean') data.collectEmail = body.collectEmail;
    if (typeof body.collectName === 'boolean') data.collectName = body.collectName;
    if (typeof body.autoCreateLead === 'boolean') data.autoCreateLead = body.autoCreateLead;
    if (Array.isArray(body.autoTagIds)) data.autoTagIds = body.autoTagIds as string[];
    if (body.trigger && (Object.values(MarketingFormTrigger) as string[]).includes(String(body.trigger))) {
      data.trigger = body.trigger as MarketingFormTrigger;
    }
    if (typeof body.triggerDelayHours === 'number') data.triggerDelayHours = body.triggerDelayHours;
    const form = await prisma.marketingForm.update({ where: { id }, data: data as any });
    void createAuditLog({
      userId: req.user?.userId,
      action: 'marketing_form.updated',
      resourceType: 'marketing_form',
      resourceId: form.id,
      changes: data,
    });
    res.json({ success: true, data: form });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const existing = await prisma.marketingForm.findUnique({ where: { id } });
    await prisma.marketingForm.delete({ where: { id } });
    void createAuditLog({
      userId: req.user?.userId,
      action: 'marketing_form.deleted',
      resourceType: 'marketing_form',
      resourceId: id,
      changes: existing ? { name: existing.name, slug: existing.slug } : undefined,
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/submissions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const formId = param(req, 'id');
    const submissions = await prisma.marketingFormSubmission.findMany({
      where: { formId },
      orderBy: { submittedAt: 'desc' },
      take: 200,
      include: {
        lead: { select: { id: true, firstName: true, lastName: true, email: true } },
        user: { select: { id: true, fullName: true, email: true } },
      },
    });
    res.json({ success: true, data: submissions });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/marketing-forms/:id/send
 * Body: { recipients: [{email, name?}] }
 * Manually email a form link to one or more people.
 */
router.post('/:id/send', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const form = await prisma.marketingForm.findUnique({ where: { id } });
    if (!form) throw ApiError.notFound('Form not found');
    if (!form.isActive) throw ApiError.badRequest('Form is not active');

    const body = req.body as { recipients?: Array<{ email: string; name?: string }> };
    if (!Array.isArray(body.recipients) || body.recipients.length === 0) {
      throw ApiError.badRequest('recipients array required');
    }

    const baseUrl = process.env.FRONTEND_URL || 'https://app.pitchingperformancelab.com';
    const formUrl = `${baseUrl}/f/${form.slug}`;

    const sent: string[] = [];
    const failed: string[] = [];
    for (const r of body.recipients) {
      if (!r.email) continue;
      try {
        await sendEmail({
          to: r.email,
          subject: form.name,
          text: `${form.description || `${form.name} — please complete this form.`}\n\n${formUrl}\n\n— PPL`,
          html: `<div style="font-family: -apple-system, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #5E9E50; margin: 0 0 16px;">${form.name}</h2>
  ${r.name ? `<p style="color:#444">Hi ${r.name},</p>` : ''}
  <p style="color: #444; line-height: 1.5;">${form.description || 'Please take a moment to complete this form.'}</p>
  <p style="margin: 24px 0;"><a href="${formUrl}" style="display:inline-block;background:#5E9E50;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">Open Form</a></p>
  <p style="color:#888;font-size:12px;">Or paste this link into your browser: ${formUrl}</p>
  <p style="color:#888;font-size:12px;margin-top:32px;">— Pitching Performance Lab</p>
</div>`,
        });
        sent.push(r.email);
      } catch (e) {
        console.error(`[marketing-forms] send failed for ${r.email}:`, e);
        failed.push(r.email);
      }
    }

    void createAuditLog({
      userId: req.user?.userId,
      action: 'marketing_form.sent',
      resourceType: 'marketing_form',
      resourceId: form.id,
      changes: { sent: sent.length, failed: failed.length },
    });

    res.json({ success: true, data: { sent, failed, formUrl } });
  } catch (err) {
    next(err);
  }
});

export default router;
