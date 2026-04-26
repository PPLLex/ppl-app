/**
 * Daily admin digest — Phase 2 launch feature (#121).
 *
 * Runs at 7 AM Eastern via cron. Emails Chad (or whoever's in
 * ADMIN_NOTIFICATION_EMAIL) a summary of yesterday's activity:
 *   - Bookings created / completed / no-show
 *   - New leads
 *   - Payment events (succeeded vs failed)
 *   - At-risk member count
 *   - Top 3 hottest leads to follow up on today
 *   - Today's session count + capacity
 */

import { prisma } from '../utils/prisma';
import { sendEmail, buildPPLEmail } from './emailService';
import { BookingStatus, PaymentStatus } from '@prisma/client';

export async function sendDailyAdminDigest(): Promise<{ sent: boolean; reason?: string }> {
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || 'cmart@pitchingperformancelab.com';

  // Yesterday's window (00:00 → 24:00 in server time — Railway is UTC; close
  // enough for an end-of-day summary that fires in the morning ET)
  const startOfYesterday = new Date();
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  startOfYesterday.setHours(0, 0, 0, 0);
  const endOfYesterday = new Date(startOfYesterday);
  endOfYesterday.setDate(endOfYesterday.getDate() + 1);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);

  const [
    bookingsCreated,
    bookingsCompleted,
    bookingsNoShow,
    newLeads,
    paymentsSucceeded,
    paymentsFailed,
    atRisk,
    todaySessions,
    hottestLeads,
  ] = await Promise.all([
    prisma.booking.count({
      where: {
        createdAt: { gte: startOfYesterday, lt: endOfYesterday },
      },
    }),
    prisma.booking.count({
      where: {
        status: BookingStatus.COMPLETED,
        session: { startTime: { gte: startOfYesterday, lt: endOfYesterday } },
      },
    }),
    prisma.booking.count({
      where: {
        status: BookingStatus.NO_SHOW,
        session: { startTime: { gte: startOfYesterday, lt: endOfYesterday } },
      },
    }),
    prisma.lead.count({
      where: { createdAt: { gte: startOfYesterday, lt: endOfYesterday } },
    }),
    prisma.payment.aggregate({
      where: {
        status: PaymentStatus.SUCCEEDED,
        createdAt: { gte: startOfYesterday, lt: endOfYesterday },
      },
      _count: { _all: true },
      _sum: { amountCents: true },
    }),
    prisma.payment.count({
      where: {
        status: PaymentStatus.FAILED,
        createdAt: { gte: startOfYesterday, lt: endOfYesterday },
      },
    }),
    prisma.user.count({
      where: { role: 'CLIENT', isActive: true, churnRiskScore: { gte: 50 } },
    }),
    prisma.session.findMany({
      where: { startTime: { gte: startOfToday, lt: endOfToday }, isActive: true },
      select: { maxCapacity: true, _count: { select: { bookings: { where: { status: { in: ['CONFIRMED', 'COMPLETED'] } } } } } },
    }),
    prisma.lead.findMany({
      where: {
        organizationId: 'ppl',
        stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] },
        score: { gte: 60 },
      },
      orderBy: [{ score: 'desc' }, { updatedAt: 'desc' }],
      take: 3,
      select: { id: true, firstName: true, lastName: true, email: true, score: true, stage: true },
    }),
  ]);

  const totalCapacity = todaySessions.reduce((sum, s) => sum + s.maxCapacity, 0);
  const totalBooked = todaySessions.reduce((sum, s) => sum + s._count.bookings, 0);
  const utilization = totalCapacity > 0 ? Math.round((totalBooked / totalCapacity) * 100) : 0;
  const revenueDollars = ((paymentsSucceeded._sum.amountCents ?? 0) / 100).toFixed(2);

  const dateLabel = startOfYesterday.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const html = buildPPLEmail(`Daily Digest — ${dateLabel}`, `
    <p style="margin:0 0 6px;color:#1a1a1a;font-size:15px;">Yesterday's snapshot, plus what to watch today.</p>

    <h3 style="margin:24px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#1a1a1a;">Bookings</h3>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">
      <tr>
        <td style="padding:6px 0;color:#374151;">Created</td>
        <td style="padding:6px 0;text-align:right;font-weight:700;color:#1a1a1a;">${bookingsCreated}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;color:#374151;">Completed</td>
        <td style="padding:6px 0;text-align:right;font-weight:700;color:#95c83c;">${bookingsCompleted}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;color:#374151;">No-shows</td>
        <td style="padding:6px 0;text-align:right;font-weight:700;color:${bookingsNoShow > 0 ? '#cc0000' : '#1a1a1a'};">${bookingsNoShow}</td>
      </tr>
    </table>

    <h3 style="margin:24px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#1a1a1a;">Sales</h3>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">
      <tr>
        <td style="padding:6px 0;color:#374151;">New leads</td>
        <td style="padding:6px 0;text-align:right;font-weight:700;color:${newLeads > 0 ? '#95c83c' : '#1a1a1a'};">${newLeads}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;color:#374151;">Payments collected</td>
        <td style="padding:6px 0;text-align:right;font-weight:700;color:#1a1a1a;">${paymentsSucceeded._count._all} ($${revenueDollars})</td>
      </tr>
      <tr>
        <td style="padding:6px 0;color:#374151;">Failed payments</td>
        <td style="padding:6px 0;text-align:right;font-weight:700;color:${paymentsFailed > 0 ? '#cc0000' : '#1a1a1a'};">${paymentsFailed}</td>
      </tr>
    </table>

    <h3 style="margin:24px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#1a1a1a;">Today</h3>
    <p style="margin:0 0 4px;color:#374151;font-size:14px;">
      <strong style="color:#1a1a1a;">${todaySessions.length} sessions</strong> on the books ·
      <strong style="color:#1a1a1a;">${utilization}%</strong> utilization (${totalBooked} of ${totalCapacity} seats)
    </p>
    <p style="margin:0;color:#374151;font-size:14px;">
      <strong style="color:${atRisk > 0 ? '#cc0000' : '#1a1a1a'};">${atRisk}</strong> members flagged at-risk (churn score ≥ 50)
    </p>

    ${hottestLeads.length > 0 ? `
      <h3 style="margin:24px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#1a1a1a;">Hot leads to follow up today</h3>
      ${hottestLeads.map((l) => `
        <div style="padding:10px 12px;background:#f8f8f8;border-left:4px solid #95c83c;border-radius:6px;margin-bottom:8px;">
          <div style="font-weight:700;color:#1a1a1a;font-size:14px;">${l.firstName} ${l.lastName}</div>
          <div style="font-size:12px;color:#666;">${l.email} · score ${l.score} · ${l.stage}</div>
        </div>
      `).join('')}
    ` : ''}

    <p style="margin:24px 0 0;font-size:12px;color:#666;text-align:center;">
      Auto-generated daily at 7 AM ET. <a href="${process.env.PUBLIC_API_URL ?? ''}/admin" style="color:#95c83c;">Open dashboard →</a>
    </p>
  `);

  const ok = await sendEmail({
    to: adminEmail,
    subject: `PPL Daily Digest — ${dateLabel}`,
    html,
    text: `Yesterday: ${bookingsCreated} bookings created, ${bookingsCompleted} completed, ${bookingsNoShow} no-shows, ${newLeads} new leads, ${paymentsSucceeded._count._all} payments ($${revenueDollars}), ${paymentsFailed} failed payments. Today: ${todaySessions.length} sessions, ${utilization}% utilization, ${atRisk} at-risk members.`,
  });

  console.log(`[dailyDigest] sent=${ok} to=${adminEmail}`);
  return { sent: ok };
}
