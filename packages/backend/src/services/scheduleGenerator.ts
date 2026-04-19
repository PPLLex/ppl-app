import { prisma } from '../utils/prisma';
import { SessionType } from '@prisma/client';

/**
 * Generate sessions from active schedule templates for all locations.
 * Called by the cron job on Sunday evenings.
 *
 * @param weeksAhead How many weeks of sessions to generate (default 2)
 * @returns Summary of what was created
 */
export async function generateSessionsFromTemplates(weeksAhead = 2) {
  const locations = await prisma.location.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });

  let totalCreated = 0;
  const results: Array<{ locationName: string; created: number }> = [];

  for (const location of locations) {
    const templates = await prisma.scheduleTemplate.findMany({
      where: { locationId: location.id, isActive: true },
    });

    if (templates.length === 0) continue;

    const sessionsToCreate: Array<Record<string, unknown>> = [];
    const now = new Date();

    for (let weekOffset = 0; weekOffset < weeksAhead; weekOffset++) {
      for (const tmpl of templates) {
        const targetDate = new Date(now);
        const currentDay = targetDate.getDay();
        const diff = tmpl.dayOfWeek - currentDay + weekOffset * 7;
        targetDate.setDate(targetDate.getDate() + diff);
        targetDate.setHours(tmpl.startHour, tmpl.startMinute, 0, 0);

        // Skip dates in the past
        if (targetDate <= now) continue;

        const endDate = new Date(targetDate);
        endDate.setMinutes(endDate.getMinutes() + tmpl.durationMinutes);

        // Check for duplicate
        const existing = await prisma.session.findFirst({
          where: {
            locationId: tmpl.locationId,
            title: tmpl.title,
            sessionType: tmpl.sessionType as SessionType,
            startTime: targetDate,
          },
        });

        if (!existing) {
          sessionsToCreate.push({
            locationId: tmpl.locationId,
            roomId: tmpl.roomId,
            coachId: tmpl.coachId,
            title: tmpl.title,
            sessionType: tmpl.sessionType,
            startTime: targetDate,
            endTime: endDate,
            maxCapacity: tmpl.maxCapacity,
            registrationCutoffHours: tmpl.registrationCutoffHours,
            cancellationCutoffHours: tmpl.cancellationCutoffHours,
          });
        }
      }
    }

    if (sessionsToCreate.length > 0) {
      const result = await prisma.session.createMany({ data: sessionsToCreate as any });
      totalCreated += result.count;
      results.push({ locationName: location.name, created: result.count });
    }
  }

  console.log(`[ScheduleGenerator] Created ${totalCreated} sessions across ${results.length} location(s)`);
  return { totalCreated, results };
}
