import { prisma } from '../utils/prisma';
import { notify } from './notificationService';
import { buildSessionReminderEmail } from './emailService';
import {
  BookingStatus,
  NotificationType,
  NotificationChannel,
} from '@prisma/client';

/**
 * Send session reminders to clients with upcoming bookings.
 *
 * Called on a 15-minute schedule from cronService. Now fires TWO
 * windows in a single pass:
 *   - "kind: 24h" — sessions starting 23-25 hours from now (next-day heads-up)
 *   - "kind: 2h"  — sessions starting 1-2 hours from now (about-to-go reminder)
 *
 * Each (bookingId, kind) pair is sent at most once. We dedupe via the
 * notification metadata.kind field rather than per-booking, so a booking
 * can legitimately receive both the 24h AND 2h reminders.
 */
export async function sendSessionReminders() {
  const now = new Date();
  // Run both windows; aggregate counts.
  const [r24, r2] = await Promise.all([
    sendReminderWindow({
      now,
      kind: '24h',
      windowStart: new Date(now.getTime() + 23 * 60 * 60 * 1000),
      windowEnd: new Date(now.getTime() + 25 * 60 * 60 * 1000),
    }),
    sendReminderWindow({
      now,
      kind: '2h',
      windowStart: new Date(now.getTime() + 60 * 60 * 1000),
      windowEnd: new Date(now.getTime() + 2 * 60 * 60 * 1000),
    }),
  ]);
  return { sent24h: r24.sent, sent2h: r2.sent, sent: r24.sent + r2.sent };
}

async function sendReminderWindow(args: {
  now: Date;
  kind: '24h' | '2h';
  windowStart: Date;
  windowEnd: Date;
}): Promise<{ sent: number }> {
  const { now, kind, windowStart, windowEnd } = args;
  try {
    // Find confirmed bookings for sessions in the reminder window
    const upcomingBookings = await prisma.booking.findMany({
      where: {
        status: BookingStatus.CONFIRMED,
        session: {
          startTime: {
            gte: windowStart,
            lte: windowEnd,
          },
        },
      },
      include: {
        session: {
          include: {
            location: { select: { name: true, address: true } },
            room: { select: { name: true } },
          },
        },
        client: { select: { id: true, fullName: true } },
      },
    });

    if (upcomingBookings.length === 0) return { sent: 0 };

    let sentCount = 0;

    for (const booking of upcomingBookings) {
      // Dedupe per (bookingId, kind) — a single booking should get the
      // 24h reminder once AND the 2h reminder once, but never the same
      // window twice.
      const existingReminder = await prisma.notification.findFirst({
        where: {
          userId: booking.clientId,
          type: NotificationType.BOOKING_REMINDER,
          AND: [
            { metadata: { path: ['bookingId'], equals: booking.id } },
            { metadata: { path: ['kind'], equals: kind } },
          ],
        },
      });

      if (existingReminder) continue; // Already reminded for this window

      const session = booking.session;
      const startTime = new Date(session.startTime);
      const timeStr = startTime.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      const dateStr = startTime.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });

      const locationStr = session.location?.name || 'PPL';
      const roomStr = session.room ? ` — ${session.room.name}` : '';

      const hoursUntil = Math.max(
        1,
        Math.round((startTime.getTime() - now.getTime()) / (60 * 60 * 1000))
      );
      const reminderHtml = buildSessionReminderEmail({
        athleteName: booking.client.fullName || 'Athlete',
        sessionTitle: session.title,
        date: dateStr,
        time: timeStr,
        coach: undefined,
        room: session.room?.name,
        hoursUntil,
      });

      const titlePrefix = kind === '24h' ? 'Tomorrow' : 'Coming Up';
      await notify({
        userId: booking.clientId,
        type: NotificationType.BOOKING_REMINDER,
        title: `${titlePrefix}: ${session.title}`,
        body:
          kind === '24h'
            ? `Reminder: you have "${session.title}" tomorrow at ${timeStr} at ${locationStr}${roomStr}.`
            : `"${session.title}" starts in about ${hoursUntil}h at ${locationStr}${roomStr}. See you there!`,
        channels: [NotificationChannel.EMAIL, NotificationChannel.SMS],
        metadata: {
          bookingId: booking.id,
          sessionId: session.id,
          startTime: session.startTime.toISOString(),
          kind,
        },
        emailHtml: reminderHtml,
      });

      sentCount++;
    }

    console.log(`[Reminders] Sent ${sentCount} session reminders [${kind}]`);
    return { sent: sentCount };
  } catch (error) {
    console.error(`[Reminders] Error sending ${kind} session reminders:`, error);
    return { sent: 0 };
  }
}

/**
 * Send daily schedule summaries to staff.
 * Called once per morning (e.g., 7 AM).
 */
export async function sendDailyStaffSchedule() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  try {
    // Get all staff with their location assignments
    const staffMembers = await prisma.user.findMany({
      where: { role: 'STAFF', isActive: true },
      include: {
        staffLocations: {
          include: { location: { select: { id: true, name: true } } },
        },
      },
    });

    let sentCount = 0;

    for (const staff of staffMembers) {
      const locationIds = staff.staffLocations.map((sl: any) => sl.location.id);
      if (locationIds.length === 0) continue;

      // Get today's sessions at their locations
      const sessions = await prisma.session.findMany({
        where: {
          locationId: { in: locationIds },
          startTime: { gte: today, lt: tomorrow },
        },
        include: {
          _count: { select: { bookings: { where: { status: BookingStatus.CONFIRMED } } } },
          room: { select: { name: true } },
          location: { select: { name: true } },
        },
        orderBy: { startTime: 'asc' },
      });

      if (sessions.length === 0) continue;

      const sessionLines = sessions.map((s: any) => {
        const time = new Date(s.startTime).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });
        return `${time} — ${s.title} (${s._count.bookings}/${s.maxCapacity}) at ${s.location?.name}${s.room ? `, ${s.room.name}` : ''}`;
      });

      await notify({
        userId: staff.id,
        type: NotificationType.SCHEDULE_CHANGED,
        title: `Today's Schedule — ${sessions.length} session${sessions.length > 1 ? 's' : ''}`,
        body: sessionLines.join('\n'),
        channels: [NotificationChannel.EMAIL],
        metadata: { type: 'daily_schedule', date: today.toISOString() },
      });

      sentCount++;
    }

    console.log(`[DailySchedule] Sent ${sentCount} daily schedule emails`);
    return { sent: sentCount };
  } catch (error) {
    console.error('[DailySchedule] Error:', error);
    return { sent: 0, error: String(error) };
  }
}
