import { prisma } from '../utils/prisma';
import { notify } from './notificationService';
import {
  BookingStatus,
  NotificationType,
  NotificationChannel,
} from '@prisma/client';

/**
 * Send session reminders to clients with upcoming bookings.
 *
 * Called on a schedule (e.g., every 15 minutes).
 * Sends reminders for sessions starting in the next 1-2 hours
 * that haven't already been reminded.
 *
 * Uses the notification metadata to prevent duplicate reminders.
 */
export async function sendSessionReminders() {
  const now = new Date();

  // Window: sessions starting 1-2 hours from now
  const windowStart = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour out
  const windowEnd = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours out

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
      // Check if we already sent a reminder for this booking
      const existingReminder = await prisma.notification.findFirst({
        where: {
          userId: booking.clientId,
          type: NotificationType.BOOKING_REMINDER,
          metadata: {
            path: ['bookingId'],
            equals: booking.id,
          },
        },
      });

      if (existingReminder) continue; // Already reminded

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

      await notify({
        userId: booking.clientId,
        type: NotificationType.BOOKING_REMINDER,
        title: `Upcoming Session: ${session.title}`,
        body: `Your session "${session.title}" is coming up on ${dateStr} at ${timeStr} at ${locationStr}${roomStr}. See you there!`,
        channels: [NotificationChannel.EMAIL, NotificationChannel.SMS],
        metadata: {
          bookingId: booking.id,
          sessionId: session.id,
          startTime: session.startTime.toISOString(),
        },
      });

      sentCount++;
    }

    console.log(`[Reminders] Sent ${sentCount} session reminders`);
    return { sent: sentCount };
  } catch (error) {
    console.error('[Reminders] Error sending session reminders:', error);
    return { sent: 0, error: String(error) };
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
