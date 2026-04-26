/**
 * Lead scoring + member churn-risk scoring — Phase 2 (#16).
 *
 * Two related but distinct scoring functions:
 *
 *  computeLeadScore(leadId)  → 0-100, "how warm is this prospect?"
 *  computeChurnRisk(userId)  → 0-100, "how likely is this member to drop?"
 *
 * Each is recomputed nightly via a cron job (see cronService) and on-demand
 * when relevant events fire (lead stage change, payment failure, booking
 * cancel, etc.). Scores are persisted on the entity for fast filtering on
 * dashboards — `WHERE score >= 70 ORDER BY score DESC` returns "hot leads"
 * without recomputing.
 *
 * Formula evolution: as we collect more behavioral data (email opens,
 * page views, attendance trends), tweak the weights here. Keeping all the
 * scoring logic in one file means we can change rules without touching
 * route handlers.
 */

import { prisma } from '../utils/prisma';
import { BookingStatus, PaymentStatus } from '@prisma/client';

// ============================================================
// LEAD SCORING
// ============================================================

const LEAD_SCORE_WEIGHTS = {
  hasPhone: 5,
  hasOwner: 10,
  recentForm7Days: 30,
  recentForm30Days: 15,
  newLead7Days: 20,
  newLead30Days: 10,
  perStageProgressed: 10,
  perActivityLogged: 3,
  capActivityBonus: 15,
} as const;

const STAGE_DEPTH: Record<string, number> = {
  NEW: 0,
  CONTACTED: 1,
  QUALIFIED: 2,
  TRIAL_SCHEDULED: 3,
  TRIAL_COMPLETED: 4,
  PROPOSAL: 5,
  CLOSED_WON: 6,
  CLOSED_LOST: -1,
};

export async function computeLeadScore(leadId: string): Promise<number> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      activities: { orderBy: { createdAt: 'desc' }, take: 50 },
    },
  });
  if (!lead) return 0;

  // Closed-lost = 0, closed-won = stable 100 — both terminal.
  if (lead.stage === 'CLOSED_LOST') {
    await persistLeadScore(leadId, 0);
    return 0;
  }
  if (lead.stage === 'CLOSED_WON') {
    await persistLeadScore(leadId, 100);
    return 100;
  }

  let score = 0;
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  // Contact completeness
  if (lead.phone) score += LEAD_SCORE_WEIGHTS.hasPhone;
  if (lead.ownerUserId) score += LEAD_SCORE_WEIGHTS.hasOwner;

  // Recency of inbound interest — most recent FORM_SUBMISSION beats createdAt
  const lastForm = lead.activities.find((a) => a.type === 'FORM_SUBMISSION');
  const formAgeDays = lastForm ? (now - lastForm.createdAt.getTime()) / dayMs : Infinity;
  if (formAgeDays <= 7) score += LEAD_SCORE_WEIGHTS.recentForm7Days;
  else if (formAgeDays <= 30) score += LEAD_SCORE_WEIGHTS.recentForm30Days;

  const ageDays = (now - lead.createdAt.getTime()) / dayMs;
  if (ageDays <= 7) score += LEAD_SCORE_WEIGHTS.newLead7Days;
  else if (ageDays <= 30) score += LEAD_SCORE_WEIGHTS.newLead30Days;

  // Stage depth — every stage forward of NEW adds points
  const depth = STAGE_DEPTH[lead.stage] ?? 0;
  score += depth * LEAD_SCORE_WEIGHTS.perStageProgressed;

  // Engagement — count meaningful activities (excludes auto-generated)
  const activityBonus = Math.min(
    lead.activities.filter((a) => ['CALL', 'EMAIL_RECEIVED', 'EMAIL_SENT', 'NOTE', 'MEETING'].includes(a.type)).length *
      LEAD_SCORE_WEIGHTS.perActivityLogged,
    LEAD_SCORE_WEIGHTS.capActivityBonus
  );
  score += activityBonus;

  // Clamp to 0-100
  const final = Math.max(0, Math.min(100, Math.round(score)));
  await persistLeadScore(leadId, final);
  return final;
}

async function persistLeadScore(leadId: string, score: number): Promise<void> {
  await prisma.lead.update({
    where: { id: leadId },
    data: { score, scoreUpdatedAt: new Date() },
  });
}

/**
 * Recompute scores for every non-terminal lead. Called by the nightly cron
 * + manually from the admin dashboard "Recalculate" button.
 */
export async function recomputeAllLeadScores(): Promise<{ updated: number }> {
  const leads = await prisma.lead.findMany({
    where: {
      organizationId: 'ppl',
      stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] },
    },
    select: { id: true },
  });
  let updated = 0;
  for (const l of leads) {
    try {
      await computeLeadScore(l.id);
      updated++;
    } catch (err) {
      console.error(`[scoring] lead ${l.id}:`, err);
    }
  }
  return { updated };
}

// ============================================================
// CHURN RISK
// ============================================================

const CHURN_WEIGHTS = {
  pastDueMembership: 30,
  perFailedPayment30d: 10,
  capFailedPayment: 30,
  perWeekSinceLastBooking: 5,
  capDaysSinceBookingPenalty: 50,
  perCancellation30d: 5,
  capCancellationPenalty: 20,
  bookingDropOff50pct: 20,
} as const;

export async function computeChurnRisk(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      clientMemberships: {
        where: { status: { in: ['ACTIVE', 'PAST_DUE'] } },
        select: { status: true },
      },
    },
  });
  if (!user) return 0;
  // Only score active CLIENTS — staff/admins/etc don't churn from the gym.
  if (user.role !== 'CLIENT' || !user.isActive) {
    await persistChurnScore(userId, 0);
    return 0;
  }

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const day30Ago = new Date(now - 30 * dayMs);
  const day60Ago = new Date(now - 60 * dayMs);

  let score = 0;

  // Past-due membership = strong signal
  if (user.clientMemberships.some((m) => m.status === 'PAST_DUE')) {
    score += CHURN_WEIGHTS.pastDueMembership;
  }

  // Failed payments in last 30 days
  const failedRecent = await prisma.payment.count({
    where: {
      clientId: userId,
      status: PaymentStatus.FAILED,
      createdAt: { gte: day30Ago },
    },
  });
  score += Math.min(
    failedRecent * CHURN_WEIGHTS.perFailedPayment30d,
    CHURN_WEIGHTS.capFailedPayment
  );

  // Days since last completed booking
  const lastCompletedBooking = await prisma.booking.findFirst({
    where: { clientId: userId, status: BookingStatus.COMPLETED },
    orderBy: { session: { startTime: 'desc' } },
    include: { session: { select: { startTime: true } } },
  });
  if (lastCompletedBooking?.session) {
    const daysSince = (now - lastCompletedBooking.session.startTime.getTime()) / dayMs;
    const weekPenalty = Math.floor(daysSince / 7) * CHURN_WEIGHTS.perWeekSinceLastBooking;
    score += Math.min(weekPenalty, CHURN_WEIGHTS.capDaysSinceBookingPenalty);
  } else {
    // No completed booking ever = max booking-recency penalty
    score += CHURN_WEIGHTS.capDaysSinceBookingPenalty;
  }

  // Cancellations in last 30 days
  const cancels = await prisma.booking.count({
    where: {
      clientId: userId,
      status: BookingStatus.CANCELLED,
      cancelledAt: { gte: day30Ago },
    },
  });
  score += Math.min(
    cancels * CHURN_WEIGHTS.perCancellation30d,
    CHURN_WEIGHTS.capCancellationPenalty
  );

  // Booking frequency drop-off — last 30d vs prior 30d
  const [recentBookings, priorBookings] = await Promise.all([
    prisma.booking.count({
      where: {
        clientId: userId,
        status: { in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED] },
        session: { startTime: { gte: day30Ago } },
      },
    }),
    prisma.booking.count({
      where: {
        clientId: userId,
        status: { in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED] },
        session: { startTime: { gte: day60Ago, lt: day30Ago } },
      },
    }),
  ]);
  if (priorBookings > 0 && recentBookings < priorBookings * 0.5) {
    score += CHURN_WEIGHTS.bookingDropOff50pct;
  }

  const final = Math.max(0, Math.min(100, Math.round(score)));
  await persistChurnScore(userId, final);
  return final;
}

async function persistChurnScore(userId: string, score: number): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { churnRiskScore: score, churnScoreUpdatedAt: new Date() },
  });
}

/**
 * Recompute churn risk for every active client. Called by nightly cron.
 */
export async function recomputeAllChurnRisks(): Promise<{ updated: number }> {
  const clients = await prisma.user.findMany({
    where: { role: 'CLIENT', isActive: true },
    select: { id: true },
  });
  let updated = 0;
  for (const c of clients) {
    try {
      await computeChurnRisk(c.id);
      updated++;
    } catch (err) {
      console.error(`[scoring] churn user ${c.id}:`, err);
    }
  }
  return { updated };
}
