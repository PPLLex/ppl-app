/**
 * Public lead intake endpoint.
 *
 * The /api/leads router gates everything behind auth + a CRM-eligible role
 * — that's the right shape for admins working the pipeline. But the
 * marketing site needs an unauthenticated way to drop a lead in the funnel
 * (a "Get Info" form on pitchingperformancelab.com, a TikTok bio link, etc.).
 *
 * This file exposes a single POST route that:
 *   - takes the minimal lead shape (firstName, lastName, email, optional
 *     phone / ageGroup / locationId / notes)
 *   - does basic email validation
 *   - upserts by (organizationId, email) so a returning visitor doesn't
 *     create dupe leads
 *   - logs a FORM_SUBMISSION activity so the team can see the source +
 *     timestamp in the lead detail view
 *   - returns a slim success payload with no sensitive fields
 *
 * Anti-abuse:
 *   - Hooks into the existing apiLimiter (mounted globally in app.ts) so
 *     a single IP can't fire 10k requests
 *   - Honeypot field "website" — bots fill all visible inputs; if this
 *     field has any value we silently 200 without saving
 *   - No PII is echoed back; response is just { success: true }
 *
 * Future:
 *   - reCAPTCHA / Turnstile token verification
 *   - per-source rate limits (e.g. lower cap for /api/public/lead-intake
 *     specifically)
 *   - email/SMS auto-reply via campaign triggers
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { LeadActivityType, LeadSource, PipelineStage, Prisma } from '@prisma/client';

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/public/lead-intake
 * Body: { firstName, lastName, email, phone?, ageGroup?, locationId?,
 *         source?, notes?, sourceMetadata?, website? (honeypot) }
 */
router.post('/lead-intake', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as Record<string, unknown>;

    // Honeypot — silently 200 if a bot filled the trap field. We don't want
    // to leak that we detected it.
    if (typeof body.website === 'string' && body.website.trim().length > 0) {
      return res.json({ success: true });
    }

    const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
    const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!firstName || !lastName || !email) {
      throw ApiError.badRequest('firstName, lastName, and email are required');
    }
    if (!EMAIL_RE.test(email)) {
      throw ApiError.badRequest('Please enter a valid email address');
    }

    const phone = typeof body.phone === 'string' ? body.phone.trim() : null;
    const ageGroup = typeof body.ageGroup === 'string' ? body.ageGroup.trim() : null;
    const locationId = typeof body.locationId === 'string' ? body.locationId : null;
    const notes = typeof body.notes === 'string' ? body.notes.slice(0, 2000) : null;

    // Source — clamp to enum, default to WEBSITE since this endpoint is
    // primarily marketing-site driven.
    const sourceCandidate = typeof body.source === 'string' ? body.source : 'WEBSITE_FORM';
    const source = (Object.values(LeadSource) as string[]).includes(sourceCandidate)
      ? (sourceCandidate as LeadSource)
      : LeadSource.WEBSITE_FORM;

    // sourceMetadata — anything the form wants to attach (utm params,
    // referrer, page slug, etc.). Stored as JSON.
    const sourceMetadata = (body.sourceMetadata as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull;

    // Upsert by (organizationId, email)
    const existing = await prisma.lead.findFirst({
      where: { organizationId: 'ppl', email },
    });

    let leadId: string;
    if (existing) {
      const updated = await prisma.lead.update({
        where: { id: existing.id },
        data: {
          firstName: firstName || existing.firstName,
          lastName: lastName || existing.lastName,
          phone: phone ?? existing.phone,
          ageGroup: ageGroup ?? existing.ageGroup,
          locationId: locationId ?? existing.locationId,
          // Don't bump stage backwards if they're already deeper in the pipeline.
          // Only set NEW if they have no existing stage at all (shouldn't happen
          // but defensive).
          stage: existing.stage ?? PipelineStage.NEW,
          notes: notes ? `${existing.notes ?? ''}\n---\n${notes}`.slice(0, 8000) : existing.notes,
          source: existing.source ?? source,
          sourceMetadata,
          lastContactedAt: new Date(),
        },
      });
      leadId = updated.id;
    } else {
      const created = await prisma.lead.create({
        data: {
          organizationId: 'ppl',
          firstName,
          lastName,
          email,
          phone,
          ageGroup,
          locationId,
          stage: PipelineStage.NEW,
          source,
          notes,
          sourceMetadata,
        },
      });
      leadId = created.id;
    }

    // Log a FORM_SUBMISSION activity so the team can see the timeline
    await prisma.leadActivity.create({
      data: {
        leadId,
        type: LeadActivityType.FORM_SUBMISSION,
        body: notes || `Public form submission from ${source}`,
        metadata: sourceMetadata,
      },
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
