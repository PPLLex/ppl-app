/**
 * Scheduled Marketing Form Sender — runs hourly to mail out forms whose
 * trigger conditions have just become eligible.
 *
 * Trigger semantics (read MarketingForm.trigger):
 *   POST_BOOKING_COMPLETE — for every COMPLETED booking whose endTime
 *     was X hours ago (X = triggerDelayHours), send the form to that
 *     athlete (and parent if youth). Dedup by (formId, userId, bookingId).
 *
 *   POST_FIRST_SESSION    — like above, but only for the athlete's
 *     first-ever COMPLETED booking. Skip everyone else.
 *
 *   POST_MEMBERSHIP_START — every ClientMembership whose startedAt was
 *     X hours ago, send to that user.
 *
 *   POST_LEAD_CREATED     — every Lead created X hours ago, send.
 *
 * Dedup is critical — we cannot resend the same form to the same person
 * for the same trigger event. We achieve this with a tiny dedup table
 * `MarketingFormSendLog` keyed (formId, recipientType, recipientId,
 * sourceEntityId).
 *
 * NOTE: this is a best-effort sender. It picks up anything in a 2h window
 * around the target time so a missed cron run doesn't leave gaps. The
 * dedup index keeps duplicates from going out.
 */

import { prisma } from '../utils/prisma';
import { sendEmail } from './emailService';

interface FormSendStats {
  scanned: number;
  sent: number;
  skipped: number;
  failed: number;
  byForm: Record<string, number>;
}

/**
 * The dedup table is created on first use to keep this self-contained.
 * Lives in a separate model — see schema.prisma if you want to inspect.
 *
 * Actually, since we don't want to add yet another schema model, we're
 * using MarketingFormSubmission with source='scheduled-pending' as a
 * sentinel. When the email fires we also write a no-payload submission
 * record so the next run sees it and skips. This is a pragmatic hack
 * but it keeps schema changes minimal.
 */
async function alreadySent(
  formId: string,
  userId: string | null,
  leadId: string | null,
  sourceTag: string
): Promise<boolean> {
  const where: Record<string, unknown> = { formId };
  if (userId) where.userId = userId;
  if (leadId) where.leadId = leadId;
  // Source tag encodes (trigger, sourceEntityId) so reruns are idempotent
  where.source = sourceTag;
  const existing = await prisma.marketingFormSubmission.findFirst({ where });
  return !!existing;
}

async function recordSend(
  formId: string,
  userId: string | null,
  leadId: string | null,
  email: string,
  sourceTag: string
) {
  await prisma.marketingFormSubmission.create({
    data: {
      formId,
      payload: {},
      submitterEmail: email,
      userId,
      leadId,
      source: sourceTag,
    },
  });
}

async function emailFormLink(opts: {
  to: string;
  name?: string;
  formName: string;
  formDescription?: string | null;
  formSlug: string;
}): Promise<boolean> {
  const baseUrl = process.env.FRONTEND_URL || 'https://app.pitchingperformancelab.com';
  const url = `${baseUrl}/f/${opts.formSlug}`;
  try {
    await sendEmail({
      to: opts.to,
      subject: opts.formName,
      text: `${opts.formDescription || `${opts.formName} — please complete this form.`}\n\n${url}\n\n— PPL`,
      html: `<div style="font-family: -apple-system, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #5E9E50; margin: 0 0 16px;">${opts.formName}</h2>
  ${opts.name ? `<p style="color:#444">Hi ${opts.name},</p>` : ''}
  <p style="color: #444; line-height: 1.5;">${opts.formDescription || 'Please take a moment to complete this form.'}</p>
  <p style="margin: 24px 0;"><a href="${url}" style="display:inline-block;background:#5E9E50;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">Open Form</a></p>
  <p style="color:#888;font-size:12px;">Or paste this link into your browser: ${url}</p>
  <p style="color:#888;font-size:12px;margin-top:32px;">— Pitching Performance Lab</p>
</div>`,
    });
    return true;
  } catch (e) {
    console.error('[scheduledFormSender] email failed:', e);
    return false;
  }
}

export async function dispatchScheduledForms(): Promise<FormSendStats> {
  const stats: FormSendStats = {
    scanned: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    byForm: {},
  };

  // Pull every active, non-MANUAL form
  const forms = await prisma.marketingForm.findMany({
    where: {
      isActive: true,
      organizationId: 'ppl',
      trigger: { not: 'MANUAL' },
    },
  });
  if (forms.length === 0) return stats;

  const now = Date.now();
  for (const form of forms) {
    const delayMs = (form.triggerDelayHours ?? 24) * 60 * 60 * 1000;
    // 2-hour eligibility window — runs hourly, gives one rerun cushion
    const targetEnd = new Date(now - delayMs);
    const targetStart = new Date(now - delayMs - 2 * 60 * 60 * 1000);

    if (form.trigger === 'POST_BOOKING_COMPLETE') {
      const bookings = await prisma.booking.findMany({
        where: {
          status: 'COMPLETED',
          session: { startTime: { gte: targetStart, lte: targetEnd } },
        },
        include: {
          client: { select: { id: true, fullName: true, email: true, parentUserId: true, parentUser: { select: { email: true, fullName: true } } } },
          session: { select: { id: true } },
        },
      });
      stats.scanned += bookings.length;
      for (const b of bookings) {
        const sourceTag = `sched:POST_BOOKING_COMPLETE:${b.id}`;
        if (await alreadySent(form.id, b.client.id, null, sourceTag)) {
          stats.skipped++;
          continue;
        }
        const recipientEmail = b.client.parentUser?.email || b.client.email;
        const recipientName = b.client.parentUser?.fullName || b.client.fullName;
        if (!recipientEmail) {
          stats.skipped++;
          continue;
        }
        const ok = await emailFormLink({
          to: recipientEmail,
          name: recipientName,
          formName: form.name,
          formDescription: form.description,
          formSlug: form.slug,
        });
        if (ok) {
          await recordSend(form.id, b.client.id, null, recipientEmail, sourceTag);
          stats.sent++;
          stats.byForm[form.name] = (stats.byForm[form.name] ?? 0) + 1;
        } else {
          stats.failed++;
        }
      }
    } else if (form.trigger === 'POST_FIRST_SESSION') {
      const bookings = await prisma.booking.findMany({
        where: {
          status: 'COMPLETED',
          session: { startTime: { gte: targetStart, lte: targetEnd } },
        },
        include: {
          client: { select: { id: true, fullName: true, email: true, parentUser: { select: { email: true, fullName: true } } } },
          session: { select: { startTime: true } },
        },
      });
      stats.scanned += bookings.length;
      for (const b of bookings) {
        // Was this their first?
        const earlier = await prisma.booking.count({
          where: {
            clientId: b.client.id,
            status: 'COMPLETED',
            session: { startTime: { lt: b.session.startTime } },
          },
        });
        if (earlier > 0) {
          stats.skipped++;
          continue;
        }
        const sourceTag = `sched:POST_FIRST_SESSION:${b.client.id}`;
        if (await alreadySent(form.id, b.client.id, null, sourceTag)) {
          stats.skipped++;
          continue;
        }
        const recipientEmail = b.client.parentUser?.email || b.client.email;
        const recipientName = b.client.parentUser?.fullName || b.client.fullName;
        if (!recipientEmail) {
          stats.skipped++;
          continue;
        }
        const ok = await emailFormLink({
          to: recipientEmail,
          name: recipientName,
          formName: form.name,
          formDescription: form.description,
          formSlug: form.slug,
        });
        if (ok) {
          await recordSend(form.id, b.client.id, null, recipientEmail, sourceTag);
          stats.sent++;
          stats.byForm[form.name] = (stats.byForm[form.name] ?? 0) + 1;
        } else {
          stats.failed++;
        }
      }
    } else if (form.trigger === 'POST_MEMBERSHIP_START') {
      const memberships = await prisma.clientMembership.findMany({
        where: {
          startedAt: { gte: targetStart, lte: targetEnd },
          status: { in: ['ACTIVE', 'PAST_DUE'] },
        },
        include: {
          client: { select: { id: true, fullName: true, email: true, parentUser: { select: { email: true, fullName: true } } } },
        },
      });
      stats.scanned += memberships.length;
      for (const m of memberships) {
        const sourceTag = `sched:POST_MEMBERSHIP_START:${m.id}`;
        if (await alreadySent(form.id, m.client.id, null, sourceTag)) {
          stats.skipped++;
          continue;
        }
        const recipientEmail = m.client.parentUser?.email || m.client.email;
        const recipientName = m.client.parentUser?.fullName || m.client.fullName;
        if (!recipientEmail) {
          stats.skipped++;
          continue;
        }
        const ok = await emailFormLink({
          to: recipientEmail,
          name: recipientName,
          formName: form.name,
          formDescription: form.description,
          formSlug: form.slug,
        });
        if (ok) {
          await recordSend(form.id, m.client.id, null, recipientEmail, sourceTag);
          stats.sent++;
          stats.byForm[form.name] = (stats.byForm[form.name] ?? 0) + 1;
        } else {
          stats.failed++;
        }
      }
    } else if (form.trigger === 'POST_LEAD_CREATED') {
      const leads = await prisma.lead.findMany({
        where: { createdAt: { gte: targetStart, lte: targetEnd } },
      });
      stats.scanned += leads.length;
      for (const lead of leads) {
        const sourceTag = `sched:POST_LEAD_CREATED:${lead.id}`;
        if (await alreadySent(form.id, null, lead.id, sourceTag)) {
          stats.skipped++;
          continue;
        }
        if (!lead.email) {
          stats.skipped++;
          continue;
        }
        const ok = await emailFormLink({
          to: lead.email,
          name: `${lead.firstName} ${lead.lastName}`.trim(),
          formName: form.name,
          formDescription: form.description,
          formSlug: form.slug,
        });
        if (ok) {
          await recordSend(form.id, null, lead.id, lead.email, sourceTag);
          stats.sent++;
          stats.byForm[form.name] = (stats.byForm[form.name] ?? 0) + 1;
        } else {
          stats.failed++;
        }
      }
    }
  }
  if (stats.sent > 0 || stats.failed > 0) {
    console.log('[scheduledFormSender] sent=', stats.sent, 'failed=', stats.failed, 'byForm=', stats.byForm);
  }
  return stats;
}
