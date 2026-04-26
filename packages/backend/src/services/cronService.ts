import { sendSessionReminders, sendDailyStaffSchedule } from './reminderService';
import { generateSessionsFromTemplates } from './scheduleGenerator';
import { runDailyPaymentRetries } from './paymentRetryService';
import { getEasternHour, getEasternDay } from './stripeService';
import { recomputeAllLeadScores, recomputeAllChurnRisks } from './scoringService';
import { pollGoogleReviews } from './reviewMonitor';
import { resumeDueWorkflowRuns } from './workflowEngine';
import { sendDailyAdminDigest } from './dailyDigest';
import { dispatchScheduledForms } from './scheduledFormSender';
import { expireStaleReferrals } from './referralService';

interface CronJob {
  name: string;
  intervalMs: number;
  handler: () => Promise<any>;
  lastRun?: Date;
  enabled: boolean;
}

const jobs: CronJob[] = [
  {
    name: 'Session Reminders',
    intervalMs: 15 * 60 * 1000, // Every 15 minutes
    handler: sendSessionReminders,
    enabled: true,
  },
  {
    name: 'Daily Staff Schedule',
    intervalMs: 60 * 60 * 1000, // Every hour (checks if it's morning)
    handler: async () => {
      // Eastern time — Railway runs in UTC but PPL operates on Eastern hours.
      const hour = getEasternHour();
      // Only run between 6-8 AM Eastern
      if (hour >= 6 && hour <= 8) {
        return sendDailyStaffSchedule();
      }
      return { skipped: true, reason: `Not morning hours (ET hour ${hour})` };
    },
    enabled: true,
  },
  {
    name: 'Daily Payment Retry',
    intervalMs: 60 * 60 * 1000, // Check every hour, only runs once at 9 AM Eastern
    handler: async () => {
      // Eastern time — matches the Stripe billing anchor (Mon/Thu 9 AM ET).
      // Running retries at 9 AM ET means fresh retries of any Mon/Thu bills
      // that just declined, plus daily retries on all still-PAST_DUE accounts
      // (per Chad 2026-04-23: retry every day until resolved or cancelled).
      const hour = getEasternHour();
      if (hour === 9) {
        return runDailyPaymentRetries();
      }
      return { skipped: true, reason: `Not 9 AM ET (currently ${hour})` };
    },
    enabled: true,
  },
  {
    name: 'Auto-Generate Sessions from Templates',
    intervalMs: 6 * 60 * 60 * 1000, // Every 6 hours
    handler: async () => {
      // Only run on Sunday evenings Eastern to prep the next 2 weeks
      const easternDay = getEasternDay();
      const easternHour = getEasternHour();
      if (easternDay === 0 && easternHour >= 18) {
        return generateSessionsFromTemplates(2);
      }
      return { skipped: true, reason: 'Not Sunday evening ET' };
    },
    enabled: true,
  },
  {
    name: 'Nightly Lead + Churn Scoring',
    intervalMs: 60 * 60 * 1000, // Every hour, only runs at 2 AM Eastern
    handler: async () => {
      const hour = getEasternHour();
      if (hour !== 2) return { skipped: true, reason: `Not 2 AM ET (currently ${hour})` };
      const [leads, churn] = await Promise.all([
        recomputeAllLeadScores(),
        recomputeAllChurnRisks(),
      ]);
      return { leadsUpdated: leads.updated, churnUpdated: churn.updated };
    },
    enabled: true,
  },
  {
    name: 'Daily Admin Digest',
    intervalMs: 60 * 60 * 1000, // hourly check; only fires at 7 AM ET
    handler: async () => {
      const hour = getEasternHour();
      if (hour !== 7) return { skipped: true, reason: `Not 7 AM ET (currently ${hour})` };
      return sendDailyAdminDigest();
    },
    enabled: true,
  },
  {
    name: 'Workflow Worker (resume WAITING runs)',
    intervalMs: 60 * 1000, // every minute — WAIT step granularity
    handler: resumeDueWorkflowRuns,
    enabled: true,
  },
  {
    // Scheduled form sender — fires hourly, picks up bookings/leads/
    // memberships whose trigger window has just elapsed (#133)
    name: 'Scheduled Marketing Form Sender',
    intervalMs: 60 * 60 * 1000,
    handler: dispatchScheduledForms,
    enabled: true,
  },
  {
    // Daily — mark PENDING referrals past their 90-day expiry as EXPIRED
    name: 'Expire Stale Referrals',
    intervalMs: 60 * 60 * 1000, // Hourly check; only fires at 3 AM ET
    handler: async () => {
      const hour = getEasternHour();
      if (hour !== 3) return { skipped: true, reason: `Not 3 AM ET (currently ${hour})` };
      return expireStaleReferrals();
    },
    enabled: true,
  },
  {
    name: 'Google Reviews Poll',
    intervalMs: 60 * 60 * 1000, // Hourly check; only fires at 8 AM ET
    handler: async () => {
      const hour = getEasternHour();
      if (hour !== 8) return { skipped: true, reason: `Not 8 AM ET (currently ${hour})` };
      return pollGoogleReviews();
    },
    enabled: true,
  },
];

const intervals: ReturnType<typeof setInterval>[] = [];

/**
 * Start all cron jobs. Call this after the server starts.
 */
export function startCronJobs() {
  console.log('[Cron] Starting scheduled jobs...');

  for (const job of jobs) {
    if (!job.enabled) {
      console.log(`[Cron] ${job.name}: DISABLED`);
      continue;
    }

    // Run once on startup after a short delay
    setTimeout(async () => {
      try {
        console.log(`[Cron] Running initial: ${job.name}`);
        await job.handler();
        job.lastRun = new Date();
      } catch (error) {
        console.error(`[Cron] ${job.name} initial run failed:`, error);
      }
    }, 10000); // 10s after startup

    // Schedule recurring
    const interval = setInterval(async () => {
      try {
        console.log(`[Cron] Running: ${job.name}`);
        await job.handler();
        job.lastRun = new Date();
      } catch (error) {
        console.error(`[Cron] ${job.name} failed:`, error);
      }
    }, job.intervalMs);

    intervals.push(interval);
    console.log(`[Cron] ${job.name}: every ${job.intervalMs / 60000}min`);
  }
}

/**
 * Stop all cron jobs. Call on graceful shutdown.
 */
export function stopCronJobs() {
  console.log('[Cron] Stopping scheduled jobs...');
  intervals.forEach(clearInterval);
  intervals.length = 0;
}

/**
 * Get status of all cron jobs (for admin health checks).
 */
export function getCronStatus() {
  return jobs.map((j) => ({
    name: j.name,
    intervalMs: j.intervalMs,
    enabled: j.enabled,
    lastRun: j.lastRun?.toISOString() || null,
  }));
}
