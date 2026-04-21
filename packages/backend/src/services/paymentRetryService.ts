import { prisma } from '../utils/prisma';
import { retryPayment } from './stripeService';
import { notify } from './notificationService';
import { createAuditLog } from './auditService';
import {
  MembershipStatus,
  PaymentStatus,
  NotificationType,
  NotificationChannel,
} from '@prisma/client';

// ============================================================
// DAILY PAYMENT RETRY SERVICE
// ============================================================

/**
 * Retry all PAST_DUE memberships daily.
 * Notifies location coordinators (not all staff) on each attempt result.
 * Tracks consecutive failures and weeks of failed payments.
 */
export async function runDailyPaymentRetries(): Promise<{
  total: number;
  succeeded: number;
  failed: number;
  results: Array<{ membershipId: string; clientName: string; success: boolean }>;
}> {
  console.log('[PaymentRetry] Starting daily retry run...');

  // Find all PAST_DUE memberships
  const pastDueMemberships = await prisma.clientMembership.findMany({
    where: { status: MembershipStatus.PAST_DUE },
    include: {
      plan: true,
      client: {
        select: {
          id: true,
          fullName: true,
          email: true,
          athleteProfile: { select: { ageGroup: true } },
        },
      },
      location: { select: { id: true, name: true } },
    },
  });

  if (pastDueMemberships.length === 0) {
    console.log('[PaymentRetry] No PAST_DUE memberships to retry.');
    return { total: 0, succeeded: 0, failed: 0, results: [] };
  }

  console.log(`[PaymentRetry] Retrying ${pastDueMemberships.length} PAST_DUE memberships...`);

  const results: Array<{ membershipId: string; clientName: string; success: boolean }> = [];
  let succeeded = 0;
  let failed = 0;

  for (const membership of pastDueMemberships) {
    const clientName = membership.client.fullName;
    const locationName = membership.location.name;
    const planName = membership.plan.name;
    const ageGroup = membership.client.athleteProfile?.ageGroup || membership.plan.ageGroup;

    try {
      const success = await retryPayment(membership.id);

      if (success) {
        succeeded++;
        results.push({ membershipId: membership.id, clientName, success: true });

        console.log(`[PaymentRetry] SUCCESS: ${clientName} (${planName})`);

        // Notify coordinators at this location about the successful retry
        await notifyLocationCoordinators({
          locationId: membership.locationId,
          ageGroup,
          type: NotificationType.PAYMENT_SUCCEEDED,
          title: `Payment Recovered: ${clientName}`,
          body: `Auto-retry succeeded for ${clientName} (${planName} at ${locationName}). Their account will be restored automatically.`,
          metadata: { membershipId: membership.id, clientId: membership.clientId, retryResult: 'success' },
        });
      } else {
        failed++;
        results.push({ membershipId: membership.id, clientName, success: false });

        // Calculate how long this has been failing
        const failureInfo = await getFailureInfo(membership.id);

        console.log(`[PaymentRetry] FAILED: ${clientName} (${planName}) — ${failureInfo.failedWeeks} training week(s)`);

        // Notify coordinators at this location about the failed retry
        await notifyLocationCoordinators({
          locationId: membership.locationId,
          ageGroup,
          type: NotificationType.PAYMENT_FAILED,
          title: `Payment Still Failing: ${clientName}`,
          body: `Auto-retry failed for ${clientName} (${planName} at ${locationName}). This has been going on for ${failureInfo.failedWeeks} training week(s) (${failureInfo.consecutiveFailures} consecutive failed attempts). Account remains frozen.`,
          metadata: {
            membershipId: membership.id,
            clientId: membership.clientId,
            retryResult: 'failed',
            consecutiveFailures: failureInfo.consecutiveFailures,
            failedWeeks: failureInfo.failedWeeks,
          },
        });
      }
    } catch (error) {
      failed++;
      results.push({ membershipId: membership.id, clientName, success: false });
      console.error(`[PaymentRetry] ERROR retrying ${clientName}:`, error);
    }
  }

  console.log(`[PaymentRetry] Completed: ${succeeded} succeeded, ${failed} failed out of ${pastDueMemberships.length} total`);

  // Also notify admins with a summary if there are any results
  if (pastDueMemberships.length > 0) {
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', isActive: true },
      select: { id: true },
    });

    const summaryBody = [
      `Daily Payment Retry Summary:`,
      `• ${pastDueMemberships.length} past-due memberships retried`,
      `• ${succeeded} succeeded (accounts restored)`,
      `• ${failed} still failing`,
      '',
      ...results.filter(r => !r.success).map(r => `  ✗ ${r.clientName} — still failing`),
      ...results.filter(r => r.success).map(r => `  ✓ ${r.clientName} — recovered`),
    ].join('\n');

    for (const admin of admins) {
      await notify({
        userId: admin.id,
        type: NotificationType.PAYMENT_FAILED,
        title: `Daily Retry: ${succeeded} recovered, ${failed} still failing`,
        body: summaryBody,
        channels: [NotificationChannel.EMAIL],
        metadata: { retryDate: new Date().toISOString(), total: pastDueMemberships.length, succeeded, failed },
      });
    }
  }

  return { total: pastDueMemberships.length, succeeded, failed, results };
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Get failure info for a membership — consecutive failures + weeks failing.
 */
async function getFailureInfo(membershipId: string): Promise<{
  consecutiveFailures: number;
  failedWeeks: number;
  firstFailedAt: Date | null;
}> {
  // Count consecutive failed payments (no success in between)
  const recentPayments = await prisma.payment.findMany({
    where: { membershipId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { status: true, createdAt: true },
  });

  let consecutiveFailures = 0;
  for (const payment of recentPayments) {
    if (payment.status === PaymentStatus.FAILED || payment.status === PaymentStatus.RETRYING) {
      consecutiveFailures++;
    } else {
      break; // Hit a successful payment, stop counting
    }
  }

  // Find the date of the first failure in this streak
  const firstFailedPayment = recentPayments[consecutiveFailures - 1];
  const firstFailedAt = firstFailedPayment?.createdAt || null;

  // Calculate weeks of failure
  let failedWeeks = 0;
  if (firstFailedAt) {
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    failedWeeks = Math.max(1, Math.ceil((Date.now() - firstFailedAt.getTime()) / msPerWeek));
  }

  return { consecutiveFailures, failedWeeks, firstFailedAt };
}

/**
 * Notify coordinators (OWNER + COORDINATOR role) at a specific location.
 * Scoped by location and optionally age group.
 * Does NOT notify coaches or general staff — only coordinators.
 */
export async function notifyLocationCoordinators(params: {
  locationId: string;
  ageGroup?: string | null;
  type: NotificationType;
  title: string;
  body: string;
  metadata?: Record<string, any>;
}) {
  const { locationId, ageGroup, type, title, body, metadata } = params;

  // Find all OWNER and COORDINATOR staff at this location
  const coordinators = await prisma.staffLocation.findMany({
    where: {
      locationId,
      locationRole: { in: ['OWNER', 'COORDINATOR'] },
      staff: { isActive: true },
    },
    select: {
      staff: { select: { id: true, fullName: true } },
    },
  });

  if (coordinators.length === 0) {
    // Fall back to admins if no coordinators at this location
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', isActive: true },
      select: { id: true },
    });
    for (const admin of admins) {
      await notify({
        userId: admin.id,
        type,
        title,
        body: body + (ageGroup ? ` (Age group: ${ageGroup})` : ''),
        channels: [NotificationChannel.EMAIL, NotificationChannel.PUSH],
        metadata: { ...metadata, ageGroup },
      });
    }
    return;
  }

  for (const { staff } of coordinators) {
    await notify({
      userId: staff.id,
      type,
      title,
      body: body + (ageGroup ? ` (Age group: ${ageGroup})` : ''),
      channels: [NotificationChannel.EMAIL, NotificationChannel.PUSH],
      metadata: { ...metadata, ageGroup },
    });
  }
}

/**
 * Get all PAST_DUE memberships with failure details for admin dashboard.
 */
export async function getFailedPaymentsDashboard(): Promise<Array<{
  membershipId: string;
  clientName: string;
  clientEmail: string;
  planName: string;
  locationName: string;
  ageGroup: string | null;
  consecutiveFailures: number;
  failedWeeks: number;
  firstFailedAt: Date | null;
  lastFailureReason: string | null;
}>> {
  const pastDueMemberships = await prisma.clientMembership.findMany({
    where: { status: MembershipStatus.PAST_DUE },
    include: {
      plan: true,
      client: {
        select: {
          id: true,
          fullName: true,
          email: true,
          athleteProfile: { select: { ageGroup: true } },
        },
      },
      location: { select: { name: true } },
    },
    orderBy: { updatedAt: 'asc' }, // Longest-failing first
  });

  const results = [];

  for (const membership of pastDueMemberships) {
    const failureInfo = await getFailureInfo(membership.id);

    // Get the latest failure reason
    const lastFailedPayment = await prisma.payment.findFirst({
      where: { membershipId: membership.id, status: PaymentStatus.FAILED },
      orderBy: { createdAt: 'desc' },
      select: { failureReason: true },
    });

    results.push({
      membershipId: membership.id,
      clientName: membership.client.fullName,
      clientEmail: membership.client.email,
      planName: membership.plan.name,
      locationName: membership.location.name,
      ageGroup: membership.client.athleteProfile?.ageGroup || membership.plan.ageGroup,
      consecutiveFailures: failureInfo.consecutiveFailures,
      failedWeeks: failureInfo.failedWeeks,
      firstFailedAt: failureInfo.firstFailedAt,
      lastFailureReason: lastFailedPayment?.failureReason || null,
    });
  }

  return results;
}
