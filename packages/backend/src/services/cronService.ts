import { sendSessionReminders, sendDailyStaffSchedule } from './reminderService';
import { generateSessionsFromTemplates } from './scheduleGenerator';
import { runDailyPaymentRetries } from './paymentRetryService';

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
      const hour = new Date().getHours();
      // Only run between 6-8 AM
      if (hour >= 6 && hour <= 8) {
        return sendDailyStaffSchedule();
      }
      return { skipped: true, reason: 'Not morning hours' };
    },
    enabled: true,
  },
  {
    name: 'Daily Payment Retry',
    intervalMs: 60 * 60 * 1000, // Check every hour, only runs once at 9 AM
    handler: async () => {
      const hour = new Date().getHours();
      // Only run at 9 AM — retry all failed payments daily
      if (hour === 9) {
        return runDailyPaymentRetries();
      }
      return { skipped: true, reason: 'Not 9 AM' };
    },
    enabled: true,
  },
  {
    name: 'Auto-Generate Sessions from Templates',
    intervalMs: 6 * 60 * 60 * 1000, // Every 6 hours
    handler: async () => {
      // Only run on Sunday evenings to prep the next 2 weeks
      const now = new Date();
      if (now.getDay() === 0 && now.getHours() >= 18) {
        return generateSessionsFromTemplates(2);
      }
      return { skipped: true, reason: 'Not Sunday evening' };
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
