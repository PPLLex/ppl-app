import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { NotificationType, NotificationChannel, NotificationStatus, Role } from '@prisma/client';
import { sendEmail, buildPPLEmail } from './emailService';
import { sendSms } from './smsService';
import { sendPush } from './pushService';

interface NotifyParams {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  channels?: NotificationChannel[];
  metadata?: Record<string, unknown>;
}

/**
 * Create a notification and attempt to send it immediately.
 * Stores in DB for history, and dispatches via email/SMS.
 */
export async function notify(params: NotifyParams) {
  const channels = params.channels || [NotificationChannel.EMAIL, NotificationChannel.SMS, NotificationChannel.PUSH];

  // Look up user's contact info
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { email: true, phone: true },
  });

  if (!user) {
    console.error(`Cannot notify user ${params.userId}: user not found`);
    return;
  }

  try {
    for (const channel of channels) {
      // Create the notification record
      const notification = await prisma.notification.create({
        data: {
          userId: params.userId,
          type: params.type,
          title: params.title,
          body: params.body,
          channel,
          metadata: params.metadata ? (params.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
        },
      });

      // Attempt to send immediately
      let sent = false;

      if (channel === NotificationChannel.EMAIL && user.email) {
        sent = await sendEmail({
          to: user.email,
          subject: params.title,
          text: params.body,
          html: buildPPLEmail(params.title, params.body.replace(/\n/g, '<br>')),
        });
      } else if (channel === NotificationChannel.SMS && user.phone) {
        // SMS gets a shorter version — strip HTML, keep it under 160 chars if possible
        const smsBody = `PPL: ${params.body}`.substring(0, 320);
        sent = await sendSms({ to: user.phone, body: smsBody });
      } else if (channel === NotificationChannel.PUSH) {
        sent = await sendPush(params.userId, {
          title: params.title,
          body: params.body,
          data: {
            type: params.type,
            ...(params.metadata ? Object.fromEntries(
              Object.entries(params.metadata).map(([k, v]) => [k, String(v)])
            ) : {}),
          },
        });
      }

      // Update notification status
      if (sent) {
        await prisma.notification.update({
          where: { id: notification.id },
          data: { status: NotificationStatus.SENT, sentAt: new Date() },
        });
      }
      // If not sent, it stays PENDING for potential retry later
    }
  } catch (error) {
    console.error('Notification send failed:', error);
  }
}

/**
 * Notify all admins about a schedule change made by a staff member.
 */
export async function notifyAdminsOfScheduleChange(
  staffId: string,
  staffName: string,
  action: string,
  sessionTitle: string,
  details: string
) {
  const admins = await prisma.user.findMany({
    where: { role: Role.ADMIN, isActive: true },
    select: { id: true },
  });

  const title = `Schedule Change: ${sessionTitle}`;
  const body = `${staffName} ${action}: ${details}`;

  for (const admin of admins) {
    await notify({
      userId: admin.id,
      type: NotificationType.SCHEDULE_CHANGED,
      title,
      body,
      channels: [NotificationChannel.EMAIL],
      metadata: { staffId, action, sessionTitle },
    });
  }
}
