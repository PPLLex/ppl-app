/**
 * Referral program (#134) — refer a friend, both get a free week.
 *
 * Reward = 7 booking credits added to BOTH parties when the referee
 * makes their first qualifying paid purchase. Tracks via the Referral
 * model with PENDING / REWARDED / EXPIRED states.
 *
 * Public surface:
 *   getOrCreateReferralCode(userId)    Lazily mint a code for a user.
 *   recordReferral(refereeId, code)    Called from registration flow.
 *   awardReferralIfPending(refereeId)  Called from payment.succeeded.
 *   expireStaleReferrals()             Called from a daily cron.
 */

import crypto from 'node:crypto';
import { prisma } from '../utils/prisma';
import { sendEmail } from './emailService';

const REWARD_CREDITS = 7;
const EXPIRY_DAYS = 90;

/**
 * Generate a short, human-friendly code: PPL-XXXX-XXXX (uppercase
 * alphanumeric, no confusables like 0/O or 1/I).
 */
function generateCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = (n: number) =>
    Array.from({ length: n }, () =>
      alphabet[crypto.randomInt(0, alphabet.length)]
    ).join('');
  return `PPL-${pick(4)}-${pick(4)}`;
}

/**
 * Get a user's referral code, generating one if they don't have one yet.
 * Race-safe via @unique index — retry on collision.
 */
export async function getOrCreateReferralCode(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { referralCode: true },
  });
  if (user?.referralCode) return user.referralCode;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    try {
      const updated = await prisma.user.update({
        where: { id: userId },
        data: { referralCode: code },
        select: { referralCode: true },
      });
      return updated.referralCode!;
    } catch (e) {
      // Unique violation → another concurrent generator got the same code,
      // or the user already had one assigned. Re-read and retry.
      const refreshed = await prisma.user.findUnique({
        where: { id: userId },
        select: { referralCode: true },
      });
      if (refreshed?.referralCode) return refreshed.referralCode;
      // else keep trying with a new code
      void e;
    }
  }
  throw new Error('Could not generate a unique referral code after 5 attempts');
}

/**
 * Look up a code → returns the referrer user, or null if the code is
 * unknown / belongs to no one.
 */
export async function findReferrerByCode(
  code: string
): Promise<{ id: string; fullName: string } | null> {
  const user = await prisma.user.findUnique({
    where: { referralCode: code.trim().toUpperCase() },
    select: { id: true, fullName: true },
  });
  return user;
}

/**
 * Called during registration once we have the new user's ID. Idempotent —
 * if the referee already has a Referral row, returns it without changes.
 */
export async function recordReferral(
  refereeId: string,
  rawCode: string
): Promise<{ ok: boolean; reason?: string }> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { ok: false, reason: 'empty code' };

  const referrer = await findReferrerByCode(code);
  if (!referrer) return { ok: false, reason: 'unknown code' };
  if (referrer.id === refereeId) return { ok: false, reason: 'self-referral' };

  // Already have a referral row?
  const existing = await prisma.referral.findUnique({ where: { refereeId } });
  if (existing) return { ok: false, reason: 'already-referred' };

  const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  await prisma.referral.create({
    data: {
      referrerId: referrer.id,
      refereeId,
      referralCodeUsed: code,
      expiresAt,
    },
  });
  return { ok: true };
}

/**
 * Issue 7 booking credits to a user via the credit transaction ledger.
 * The credits will land in their next available WeeklyCredit pool, or
 * if no membership exists, they're booked as a positive ledger entry
 * that the booking flow can spend down.
 */
async function grantFreeWeekCredits(userId: string, source: string): Promise<void> {
  await prisma.creditTransaction.create({
    data: {
      clientId: userId,
      transactionType: 'refund', // Existing enum value used for "added back"
      amount: REWARD_CREDITS,
      notes: `Referral reward (${source}) — free week, ${REWARD_CREDITS} credits`,
    },
  });
  // If the user has an active membership, also add the credits to their
  // current week's pool so they're immediately spendable.
  const now = new Date();
  const wc = await prisma.weeklyCredit.findFirst({
    where: {
      clientId: userId,
      weekStartDate: { lte: now },
      weekEndDate: { gte: now },
    },
  });
  if (wc) {
    await prisma.weeklyCredit.update({
      where: { id: wc.id },
      data: { creditsTotal: wc.creditsTotal + REWARD_CREDITS },
    });
  }
}

/**
 * Called from the Stripe payment.succeeded handler when a referee makes
 * their first paid purchase. Looks up the PENDING referral row, awards
 * both parties, sends celebratory emails. Idempotent — does nothing if
 * the referral is already REWARDED or EXPIRED.
 */
export async function awardReferralIfPending(
  refereeId: string
): Promise<{ awarded: boolean }> {
  const referral = await prisma.referral.findUnique({
    where: { refereeId },
    include: {
      referrer: { select: { id: true, fullName: true, email: true } },
      referee: { select: { id: true, fullName: true, email: true } },
    },
  });
  if (!referral) return { awarded: false };
  if (referral.status !== 'PENDING') return { awarded: false };
  if (referral.expiresAt < new Date()) {
    await prisma.referral.update({
      where: { id: referral.id },
      data: { status: 'EXPIRED' },
    });
    return { awarded: false };
  }

  // Mark first to prevent double-award races. Anyone else hitting this
  // at the same time will see status !== PENDING and bail.
  const claim = await prisma.referral.updateMany({
    where: { id: referral.id, status: 'PENDING' },
    data: { status: 'REWARDED', rewardedAt: new Date() },
  });
  if (claim.count !== 1) return { awarded: false };

  await Promise.all([
    grantFreeWeekCredits(referral.referrerId, `referred ${referral.referee.fullName}`),
    grantFreeWeekCredits(referral.refereeId, `joined via referral`),
  ]);

  // Celebratory emails (best-effort, non-blocking)
  void Promise.all([
    sendEmail({
      to: referral.referrer.email,
      subject: `🎉 ${referral.referee.fullName} joined PPL — you got a free week!`,
      text: `${referral.referrer.fullName},\n\n${referral.referee.fullName} just signed up using your referral code and made their first payment. You've both earned ${REWARD_CREDITS} free booking credits — they'll show up in your next available week.\n\nThanks for spreading the word.\n\n— PPL`,
      html: `<div style="font-family:-apple-system,sans-serif;max-width:540px;margin:0 auto;padding:24px"><h2 style="color:#5E9E50">🎉 You earned a free week!</h2><p>${referral.referrer.fullName},</p><p><strong>${referral.referee.fullName}</strong> just signed up using your referral code and made their first payment. You've both earned <strong>${REWARD_CREDITS} free booking credits</strong> — they'll show up in your next available week.</p><p>Thanks for spreading the word.</p><p style="color:#888;font-size:12px;margin-top:32px">— Pitching Performance Lab</p></div>`,
    }),
    sendEmail({
      to: referral.referee.email,
      subject: `🎉 Welcome to PPL — your free week is on us`,
      text: `${referral.referee.fullName},\n\nThanks for joining PPL through ${referral.referrer.fullName}'s referral. You've both earned ${REWARD_CREDITS} free booking credits to get started.\n\nLet's go.\n\n— PPL`,
      html: `<div style="font-family:-apple-system,sans-serif;max-width:540px;margin:0 auto;padding:24px"><h2 style="color:#5E9E50">🎉 Welcome to PPL!</h2><p>${referral.referee.fullName},</p><p>Thanks for joining through <strong>${referral.referrer.fullName}</strong>'s referral. You've both earned <strong>${REWARD_CREDITS} free booking credits</strong> to get started.</p><p>Let's go.</p><p style="color:#888;font-size:12px;margin-top:32px">— Pitching Performance Lab</p></div>`,
    }),
  ]).catch((e) => console.error('[referrals] reward email failed:', e));

  return { awarded: true };
}

/**
 * Daily cron — mark every PENDING referral whose 90-day window has
 * elapsed as EXPIRED so they don't sit in the queue forever.
 */
export async function expireStaleReferrals(): Promise<{ expired: number }> {
  const result = await prisma.referral.updateMany({
    where: { status: 'PENDING', expiresAt: { lt: new Date() } },
    data: { status: 'EXPIRED' },
  });
  return { expired: result.count };
}
