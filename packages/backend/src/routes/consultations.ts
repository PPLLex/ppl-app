/**
 * Consultation calendar — Phase 2 (#20).
 *
 * Two surfaces:
 *
 *   ADMIN (auth + ADMIN/COORDINATOR/CONTENT_MARKETING_ADMIN):
 *     GET    /api/consultations                       list slots + bookings
 *     POST   /api/consultations/slots                 create one slot
 *     POST   /api/consultations/slots/bulk            generate slots for a date range
 *     PATCH  /api/consultations/slots/:id             reassign host / move time
 *     DELETE /api/consultations/slots/:id             remove an unbooked slot
 *
 *   PUBLIC (no auth — for prospects):
 *     GET    /api/consultations/public/available      next 14 days of open slots
 *     POST   /api/consultations/public/book           book a slot (creates Lead)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate } from '../middleware/auth';
import { requireAnyRole } from '../services/roleService';
import {
  ConsultationSlotStatus,
  LeadActivityType,
  LeadSource,
  Prisma,
  Role,
  WorkflowTrigger,
} from '@prisma/client';
import { emitTrigger } from '../services/workflowEngine';
import { sendEmail, buildPPLEmail } from '../services/emailService';
import { config } from '../config';

const router = Router();

function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ============================================================
// PUBLIC ENDPOINTS — no auth, mounted before the auth middleware below
// ============================================================

/**
 * GET /api/consultations/public/available?days=14
 * Returns AVAILABLE slots in the next N days (default 14, max 60).
 */
router.get('/public/available', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days ?? 14), 1), 60);
    const now = new Date();
    const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const slots = await prisma.consultationSlot.findMany({
      where: {
        status: ConsultationSlotStatus.AVAILABLE,
        startTime: { gte: now, lte: end },
        organizationId: 'ppl',
      },
      orderBy: { startTime: 'asc' },
      select: {
        id: true,
        startTime: true,
        durationMinutes: true,
        location: { select: { id: true, name: true } },
        host: { select: { id: true, fullName: true } },
      },
      take: 500,
    });
    res.json({ success: true, data: slots });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/consultations/public/book
 * Body: { slotId, name, email, phone?, notes?, ageGroup?, locationId? }
 *
 * Books a slot. Atomically: marks slot BOOKED, upserts a Lead by email,
 * creates ConsultationBooking, fires LEAD_CREATED workflow trigger,
 * emails confirmation to prospect + heads-up to assigned host (if any).
 */
router.post('/public/book', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as Record<string, unknown>;
    const slotId = typeof body.slotId === 'string' ? body.slotId : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim() : null;
    const notes = typeof body.notes === 'string' ? body.notes.slice(0, 1000) : null;
    const ageGroup = typeof body.ageGroup === 'string' ? body.ageGroup : null;
    const locationId = typeof body.locationId === 'string' ? body.locationId : null;

    if (!slotId || !name || !email) {
      throw ApiError.badRequest('slotId, name, and email are required');
    }
    if (!EMAIL_RE.test(email)) throw ApiError.badRequest('Please enter a valid email address');

    // Single transaction: re-check slot is still AVAILABLE then atomically
    // book it. Two parents racing for the same slot → second one fails
    // cleanly with a 409.
    const result = await prisma.$transaction(async (tx) => {
      const slot = await tx.consultationSlot.findUnique({
        where: { id: slotId },
        include: { host: { select: { id: true, fullName: true, email: true } } },
      });
      if (!slot) throw ApiError.notFound('Slot not found');
      if (slot.status !== ConsultationSlotStatus.AVAILABLE) {
        throw ApiError.conflict('That slot was just booked by someone else — pick another time.');
      }

      // Upsert Lead by (org, email)
      const [firstName, ...rest] = name.split(' ');
      const lastName = rest.join(' ') || firstName;
      const existingLead = await tx.lead.findFirst({
        where: { organizationId: 'ppl', email },
      });
      const lead = existingLead
        ? await tx.lead.update({
            where: { id: existingLead.id },
            data: {
              firstName: firstName || existingLead.firstName,
              lastName: lastName || existingLead.lastName,
              phone: phone ?? existingLead.phone,
              ageGroup: ageGroup ?? existingLead.ageGroup,
              locationId: locationId ?? existingLead.locationId,
              lastContactedAt: new Date(),
            },
          })
        : await tx.lead.create({
            data: {
              organizationId: 'ppl',
              firstName: firstName || 'Prospect',
              lastName: lastName || '',
              email,
              phone,
              ageGroup,
              locationId,
              source: LeadSource.WEBSITE_FORM,
              stage: 'ASSESSMENT_BOOKED' as const,
            },
          });

      // Mark slot booked + create the booking row
      await tx.consultationSlot.update({
        where: { id: slotId },
        data: { status: ConsultationSlotStatus.BOOKED },
      });
      const booking = await tx.consultationBooking.create({
        data: {
          slotId,
          leadId: lead.id,
          name,
          email,
          phone,
          notes,
        },
      });

      // Activity entry on the Lead so admins see the timeline
      await tx.leadActivity.create({
        data: {
          leadId: lead.id,
          type: LeadActivityType.MEETING,
          content: `Consult booked for ${slot.startTime.toISOString()}${notes ? ` — Notes: ${notes}` : ''}`,
          metadata: { slotId, bookingId: booking.id } as Prisma.InputJsonValue,
        },
      });

      return { slot, booking, lead, host: slot.host };
    });

    // Workflow trigger — non-blocking
    emitTrigger(WorkflowTrigger.LEAD_CREATED, 'lead', result.lead.id, { source: 'CONSULTATION' });

    // Confirmation email to prospect (don't block on failure)
    void sendConsultationConfirmEmail({
      to: email,
      name,
      startTime: result.slot.startTime,
      durationMinutes: result.slot.durationMinutes,
      hostName: result.host?.fullName ?? null,
    }).catch((e) => console.error('[consult] confirm email failed:', e));

    // Heads-up to assigned host
    if (result.host?.email) {
      const hostHtml = buildPPLEmail('New Consult Booked', `
        <p style="margin:0 0 12px;">${name} just booked a free consult.</p>
        <p style="margin:0 0 12px;font-size:14px;color:#374151;">
          <strong>When:</strong> ${result.slot.startTime.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}<br>
          <strong>Duration:</strong> ${result.slot.durationMinutes} min<br>
          <strong>Email:</strong> <a href="mailto:${email}">${email}</a><br>
          ${phone ? `<strong>Phone:</strong> ${phone}<br>` : ''}
          ${notes ? `<strong>Notes:</strong> ${notes}` : ''}
        </p>
        <p style="margin:0;font-size:13px;color:#666;">Lead profile: <a href="${config.frontendUrl}/admin/crm/${result.lead.id}">${config.frontendUrl}/admin/crm/${result.lead.id}</a></p>
      `);
      void sendEmail({
        to: result.host.email,
        subject: `New consult booked: ${name} — ${result.slot.startTime.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`,
        html: hostHtml,
        text: `${name} booked a consult on ${result.slot.startTime.toISOString()}. Email: ${email}${phone ? ' Phone: ' + phone : ''}${notes ? ' Notes: ' + notes : ''}`,
      }).catch((e) => console.error('[consult] host email failed:', e));
    }

    res.status(201).json({
      success: true,
      data: {
        bookingId: result.booking.id,
        slotStart: result.slot.startTime,
        durationMinutes: result.slot.durationMinutes,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// AUTHENTICATED ADMIN ENDPOINTS
// ============================================================

router.use(
  authenticate,
  requireAnyRole(Role.ADMIN, Role.COORDINATOR, Role.CONTENT_MARKETING_ADMIN, Role.CONTENT_MARKETING)
);

router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const slots = await prisma.consultationSlot.findMany({
      where: { organizationId: 'ppl' },
      orderBy: { startTime: 'asc' },
      include: {
        host: { select: { id: true, fullName: true } },
        location: { select: { id: true, name: true } },
        booking: true,
      },
      take: 500,
    });
    res.json({ success: true, data: slots });
  } catch (err) {
    next(err);
  }
});

router.post('/slots', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { startTime, durationMinutes, hostUserId, locationId, internalNote } =
      req.body as Record<string, unknown>;
    if (!startTime || typeof startTime !== 'string') throw ApiError.badRequest('startTime required');
    const dt = new Date(startTime);
    if (isNaN(dt.getTime())) throw ApiError.badRequest('Invalid startTime');

    const slot = await prisma.consultationSlot.create({
      data: {
        organizationId: 'ppl',
        startTime: dt,
        durationMinutes: typeof durationMinutes === 'number' ? durationMinutes : 15,
        hostUserId: typeof hostUserId === 'string' ? hostUserId : null,
        locationId: typeof locationId === 'string' ? locationId : null,
        internalNote: typeof internalNote === 'string' ? internalNote : null,
      },
    });
    res.status(201).json({ success: true, data: slot });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/consultations/slots/bulk
 * Body: {
 *   startDate: '2026-05-01',
 *   endDate: '2026-05-07',
 *   weekdays: [1,2,3,4,5],   // 0=Sun, 6=Sat
 *   times: ['09:00','09:30',...],
 *   durationMinutes: 15,
 *   hostUserId?: string,
 *   locationId?: string
 * }
 * Bulk-generates slots and skips any (startTime, hostUserId) duplicates.
 */
router.post('/slots/bulk', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as Record<string, unknown>;
    const startDate = new Date(String(body.startDate));
    const endDate = new Date(String(body.endDate));
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw ApiError.badRequest('startDate and endDate required (YYYY-MM-DD)');
    }
    const weekdays = Array.isArray(body.weekdays) ? (body.weekdays as number[]) : [1, 2, 3, 4, 5];
    const times = Array.isArray(body.times) ? (body.times as string[]) : [];
    if (times.length === 0) throw ApiError.badRequest('times array required (e.g. ["09:00","09:30"])');
    const durationMinutes = typeof body.durationMinutes === 'number' ? body.durationMinutes : 15;
    const hostUserId = typeof body.hostUserId === 'string' ? body.hostUserId : null;
    const locationId = typeof body.locationId === 'string' ? body.locationId : null;

    const created: Array<{ id: string; startTime: Date }> = [];
    let skipped = 0;
    const cursor = new Date(startDate);
    cursor.setHours(0, 0, 0, 0);
    while (cursor <= endDate) {
      if (weekdays.includes(cursor.getDay())) {
        for (const t of times) {
          const [hh, mm] = t.split(':').map(Number);
          if (Number.isNaN(hh) || Number.isNaN(mm)) continue;
          const slotTime = new Date(cursor);
          slotTime.setHours(hh, mm, 0, 0);
          try {
            const slot = await prisma.consultationSlot.create({
              data: {
                organizationId: 'ppl',
                startTime: slotTime,
                durationMinutes,
                hostUserId,
                locationId,
              },
              select: { id: true, startTime: true },
            });
            created.push(slot);
          } catch {
            skipped++; // unique constraint hit
          }
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    res.status(201).json({ success: true, data: { created: created.length, skipped } });
  } catch (err) {
    next(err);
  }
});

router.delete('/slots/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slot = await prisma.consultationSlot.findUnique({
      where: { id: param(req, 'id') },
      include: { booking: true },
    });
    if (!slot) throw ApiError.notFound('Slot not found');
    if (slot.booking) {
      throw ApiError.badRequest('Cannot delete a booked slot — cancel the booking first.');
    }
    await prisma.consultationSlot.delete({ where: { id: slot.id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

async function sendConsultationConfirmEmail(args: {
  to: string;
  name: string;
  startTime: Date;
  durationMinutes: number;
  hostName: string | null;
}) {
  const dateStr = args.startTime.toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const html = buildPPLEmail(`Your Consult is Booked`, `
    <p style="margin:0 0 14px;font-size:15px;color:#1a1a1a;">Hey ${args.name.split(' ')[0]},</p>
    <p style="margin:0 0 18px;font-size:14.5px;color:#374151;line-height:1.65;">
      You're booked for a free ${args.durationMinutes}-minute consultation${args.hostName ? ` with ${args.hostName}` : ''}.
    </p>
    <div style="background:#f8f8f8;border:1px solid #e8e8e8;border-radius:8px;padding:18px;text-align:center;margin:0 0 20px;">
      <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;">When</div>
      <div style="font-size:18px;font-weight:800;color:#95c83c;line-height:1.2;">${dateStr}</div>
    </div>
    <p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.65;">
      We'll call the number you provided. If you need to reschedule, just reply to this email.
    </p>
    <p style="margin:0;font-size:12px;color:#666;">— Pitching Performance Lab</p>
  `);
  await sendEmail({
    to: args.to,
    subject: `Consult booked — ${args.startTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${args.startTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`,
    html,
    text: `Your free consultation is booked for ${dateStr}${args.hostName ? ' with ' + args.hostName : ''}. We'll call the number you provided.`,
  });
}

export default router;
