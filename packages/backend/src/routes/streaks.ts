/**
 * Streak indicators (#U22 / PREMIUM_AUDIT).
 *
 * Computes the consecutive-week training streak for the calling user
 * (or, with ?athleteId=, a specific athlete the caller is responsible for).
 *
 * "Week" = ISO week starting Monday. A week counts toward the streak if
 * it contains at least one COMPLETED Booking. The current week always
 * counts as either "in progress" (no bookings yet) or "alive" (>=1
 * booking) — we never break the streak just because today is Monday and
 * the user hasn't trained THIS week yet.
 *
 *   GET /api/streaks/me                — current user / their first athlete
 *   GET /api/streaks/me?athleteId=...  — specific kid in the family
 *
 * Returns:
 *   {
 *     currentWeeks: 4,       // consecutive weeks with >=1 completed session
 *     longestWeeks: 7,       // best run for this athlete, all-time
 *     thisWeekCompleted: 2,  // how many sessions this week so far
 *     lastSessionAt: '...',  // most recent completed session ISO date
 *   }
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate } from '../middleware/auth';

const router = Router();

/**
 * Resolve the right athlete user id for the caller. If athleteId is
 * supplied, verify the caller is allowed to see them (own family or
 * the athlete themselves). If not supplied, use the caller's own
 * AthleteProfile, falling back to the first kid in their family.
 */
async function resolveAthleteUserId(
  callerUserId: string,
  athleteId?: string
): Promise<string | null> {
  if (athleteId) {
    const profile = await prisma.athleteProfile.findUnique({
      where: { id: athleteId },
      include: { family: { select: { parentUserId: true } } },
    });
    if (!profile) return null;
    const isSelf = profile.userId === callerUserId;
    const isParent = profile.family?.parentUserId === callerUserId;
    if (!isSelf && !isParent) return null;
    return profile.userId;
  }

  // Default: caller's own profile, else first kid in their family.
  const me = await prisma.user.findUnique({
    where: { id: callerUserId },
    include: {
      athleteProfile: true,
      family: { include: { athletes: { orderBy: { createdAt: 'asc' } } } },
    },
  });
  if (!me) return null;
  if (me.athleteProfile) return callerUserId;
  if (me.family?.athletes && me.family.athletes.length > 0) {
    return me.family.athletes[0].userId;
  }
  return null;
}

/**
 * Returns the ISO Monday for a given Date. (Date-of-week: 1=Mon … 7=Sun.)
 */
function isoWeekStart(d: Date): Date {
  const day = d.getUTCDay() || 7; // Sunday → 7
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - (day - 1));
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}

router.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const callerId = req.user!.userId;
    const athleteId = typeof req.query.athleteId === 'string' ? req.query.athleteId : undefined;
    const userId = await resolveAthleteUserId(callerId, athleteId);
    if (!userId) {
      // No athlete profile yet — return zeros so the widget can render
      // a neutral empty state instead of erroring.
      res.json({
        success: true,
        data: { currentWeeks: 0, longestWeeks: 0, thisWeekCompleted: 0, lastSessionAt: null },
      });
      return;
    }

    // Fetch the most recent ~80 completed bookings (~1.5 years of weekly
    // training) ordered by session start. Anything older isn't going to
    // affect the streak math.
    const bookings = await prisma.booking.findMany({
      where: { userId, status: 'COMPLETED' },
      include: { session: { select: { startTime: true } } },
      orderBy: { session: { startTime: 'desc' } },
      take: 80,
    });

    if (bookings.length === 0) {
      res.json({
        success: true,
        data: { currentWeeks: 0, longestWeeks: 0, thisWeekCompleted: 0, lastSessionAt: null },
      });
      return;
    }

    // Bucket bookings by ISO-week-start.
    const weekKeys = new Set<number>();
    for (const b of bookings) {
      if (!b.session?.startTime) continue;
      weekKeys.add(isoWeekStart(b.session.startTime).getTime());
    }

    const today = new Date();
    const thisWeekStart = isoWeekStart(today).getTime();
    const lastWeekStart = thisWeekStart - 7 * 24 * 60 * 60 * 1000;

    // Current streak: walk back week-by-week from THIS week. The current
    // week is grace — if it has bookings, it counts; if not, we start
    // counting from last week so a streak doesn't "break" on Monday.
    let currentWeeks = 0;
    let cursor = weekKeys.has(thisWeekStart) ? thisWeekStart : lastWeekStart;
    while (weekKeys.has(cursor)) {
      currentWeeks++;
      cursor -= 7 * 24 * 60 * 60 * 1000;
    }

    // Longest streak: scan all unique week keys, find the longest run
    // of consecutive 7-day-spaced entries.
    const sortedWeeks = Array.from(weekKeys).sort((a, b) => a - b);
    let longestWeeks = 1;
    let runLen = 1;
    for (let i = 1; i < sortedWeeks.length; i++) {
      if (sortedWeeks[i] - sortedWeeks[i - 1] === 7 * 24 * 60 * 60 * 1000) {
        runLen++;
        if (runLen > longestWeeks) longestWeeks = runLen;
      } else {
        runLen = 1;
      }
    }
    if (currentWeeks > longestWeeks) longestWeeks = currentWeeks;

    // This-week count
    const thisWeekCompleted = bookings.filter(
      (b) =>
        b.session?.startTime &&
        isoWeekStart(b.session.startTime).getTime() === thisWeekStart
    ).length;

    res.json({
      success: true,
      data: {
        currentWeeks,
        longestWeeks,
        thisWeekCompleted,
        lastSessionAt: bookings[0]?.session?.startTime ?? null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Tiny tree-shake guard — keep ApiError reachable in case future routes
// need it.
void ApiError;

export default router;
