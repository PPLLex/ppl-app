/**
 * Startup-time membership-plan bootstrapping.
 *
 * Runs on every deploy after `prisma db push` (see start.sh). Idempotent:
 * upserts the canonical PPL plan catalog so schema changes (new fields,
 * split updates, new combo plans) propagate to production automatically.
 *
 * Lives in src/ (not scripts/) so the TypeScript build compiles it into
 * dist/ and it ships with the Railway Docker container. Same reason
 * bootstrapOrganizations.ts lives here.
 *
 * Canonical source of truth: must match packages/backend/prisma/seed.ts.
 * If you change one, change both. (Dev uses seed.ts; prod uses this file.)
 *
 * Revenue splits per plan — values in cents, must sum to priceCents.
 *   Pitching-only plans → 100% to PPL.
 *   Pitching + Hitting combo plans → split between PPL and HPL
 *     per Chad's 2026-04-23 pricing decision.
 */

import { prisma } from './utils/prisma';

interface PlanSeed {
  id: string;
  name: string;
  slug: string;
  ageGroup: string;
  sessionsPerWeek: number | null;
  priceCents: number;
  billingCycle: string;
  description: string;
  includesHitting: boolean;
  pairedWithPlanId: string | null;
  revenueSplits: Record<string, number>;
}

const PLANS: PlanSeed[] = [
  // ── PITCHING-ONLY — 100% PPL ────────────────────────────────────────────
  { id: 'plan-youth-1x',           name: 'Youth 1x/Week',              slug: 'youth-1x-week',              ageGroup: 'youth',   sessionsPerWeek: 1,    priceCents: 5500,  billingCycle: 'weekly',  description: 'One pitching session per week for ages 12 and under.',                      includesHitting: false, pairedWithPlanId: 'plan-youth-1x-hitting',           revenueSplits: { ppl: 5500 } },
  { id: 'plan-1x-pitching',        name: '1x/Week Pitching',           slug: '1x-week-pitching',           ageGroup: 'ms_hs',   sessionsPerWeek: 1,    priceCents: 7000,  billingCycle: 'weekly',  description: 'One pitching session per week for ages 13+.',                               includesHitting: false, pairedWithPlanId: 'plan-1x-pitching-hitting',        revenueSplits: { ppl: 7000 } },
  { id: 'plan-unlimited-pitching', name: 'Unlimited Pitching',         slug: 'unlimited-pitching',         ageGroup: 'ms_hs',   sessionsPerWeek: null, priceCents: 8500,  billingCycle: 'weekly',  description: 'Unlimited pitching training for ages 13+.',                                 includesHitting: false, pairedWithPlanId: 'plan-unlimited-pitching-hitting', revenueSplits: { ppl: 8500 } },
  { id: 'plan-unlimited-college',  name: 'Unlimited College Pitching', slug: 'unlimited-college-pitching', ageGroup: 'college', sessionsPerWeek: null, priceCents: 8500,  billingCycle: 'weekly',  description: 'Unlimited pitching training for college athletes.',                         includesHitting: false, pairedWithPlanId: 'plan-unlimited-college-hitting',  revenueSplits: { ppl: 8500 } },

  // ── PITCHING + HITTING COMBOS — PPL + HPL split ─────────────────────────
  { id: 'plan-youth-1x-hitting',           name: 'Youth 1x/Week + Hitting',      slug: 'youth-1x-week-hitting',          ageGroup: 'youth',   sessionsPerWeek: 1,    priceCents: 9000,  billingCycle: 'weekly', description: 'One pitching + hitting session per week for ages 12 and under.',            includesHitting: true,  pairedWithPlanId: 'plan-youth-1x',           revenueSplits: { ppl: 5000, hpl: 4000 } },
  { id: 'plan-1x-pitching-hitting',        name: '1x/Week Pitching + Hitting',   slug: '1x-week-pitching-hitting',       ageGroup: 'ms_hs',   sessionsPerWeek: 1,    priceCents: 10500, billingCycle: 'weekly', description: 'One pitching + hitting session per week for ages 13+.',                     includesHitting: true,  pairedWithPlanId: 'plan-1x-pitching',        revenueSplits: { ppl: 5750, hpl: 4750 } },
  { id: 'plan-unlimited-pitching-hitting', name: 'Unlimited Pitching + Hitting', slug: 'unlimited-pitching-hitting',     ageGroup: 'ms_hs',   sessionsPerWeek: null, priceCents: 12500, billingCycle: 'weekly', description: 'Unlimited pitching + hitting training for ages 13+.',                       includesHitting: true,  pairedWithPlanId: 'plan-unlimited-pitching', revenueSplits: { ppl: 6750, hpl: 5750 } },
  { id: 'plan-unlimited-college-hitting',  name: 'Unlimited College + Hitting',  slug: 'unlimited-college-hitting',      ageGroup: 'college', sessionsPerWeek: null, priceCents: 12500, billingCycle: 'weekly', description: 'Unlimited pitching + hitting training for college athletes.',               includesHitting: true,  pairedWithPlanId: 'plan-unlimited-college',  revenueSplits: { ppl: 6750, hpl: 5750 } },

  // ── PRO (MONTHLY billing, no hitting) — 100% PPL ────────────────────────
  { id: 'plan-pro-facility-access',      name: 'Pro — Facility Access',       slug: 'pro-facility-access',       ageGroup: 'pro', sessionsPerWeek: null, priceCents: 10000, billingCycle: 'monthly', description: 'Monthly self-directed facility access for pro athletes. No coaching sessions included.', includesHitting: false, pairedWithPlanId: null, revenueSplits: { ppl: 10000 } },
  { id: 'plan-pro-programming',          name: 'Pro — Programming',           slug: 'pro-programming',           ageGroup: 'pro', sessionsPerWeek: 0,    priceCents: 10000, billingCycle: 'monthly', description: 'Custom monthly programming delivered to you. No facility access.',                        includesHitting: false, pairedWithPlanId: null, revenueSplits: { ppl: 10000 } },
  { id: 'plan-pro-programming-access',   name: 'Pro — Programming + Access',  slug: 'pro-programming-access',    ageGroup: 'pro', sessionsPerWeek: null, priceCents: 17500, billingCycle: 'monthly', description: 'Custom monthly programming plus unlimited facility access.',                              includesHitting: false, pairedWithPlanId: null, revenueSplits: { ppl: 17500 } },
  { id: 'plan-pro-programming-training', name: 'Pro — Programming + Training', slug: 'pro-programming-training', ageGroup: 'pro', sessionsPerWeek: null, priceCents: 8500,  billingCycle: 'weekly',  description: 'Custom programming plus hands-on coaching sessions with PPL staff.',                       includesHitting: false, pairedWithPlanId: null, revenueSplits: { ppl: 8500 } },
];

// Canonical plan IDs — everything else in the DB becomes isActive=false.
const CANONICAL_IDS = new Set(PLANS.map((p) => p.id));

function validateSplits(p: PlanSeed) {
  const sum = Object.values(p.revenueSplits).reduce((a, b) => a + b, 0);
  if (sum !== p.priceCents) {
    throw new Error(
      `[bootstrap-plans] revenueSplits for ${p.id} sum to ${sum} but priceCents is ${p.priceCents}`
    );
  }
}

export async function bootstrapMembershipPlans(): Promise<void> {
  console.log('[bootstrap-plans] Upserting canonical membership plan catalog…');
  // Cast to any to stay resilient if `prisma generate` lags in sandbox builds.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p: any = prisma;

  // Validate before touching the DB.
  for (const plan of PLANS) validateSplits(plan);

  // Soft-retire any legacy plans not in the canonical list so old
  // ClientMembership rows still resolve their FK.
  try {
    const legacy = await p.membershipPlan.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    for (const row of legacy) {
      if (!CANONICAL_IDS.has(row.id)) {
        await p.membershipPlan.update({
          where: { id: row.id },
          data: { isActive: false },
        });
        console.log(`  ↻ retired legacy plan: ${row.id}`);
      }
    }
  } catch (err) {
    console.error(
      '[bootstrap-plans] legacy-retire pass failed:',
      err instanceof Error ? err.message : err
    );
    // Don't throw — upsert pass below still runs.
  }

  for (const plan of PLANS) {
    try {
      const data = {
        name: plan.name,
        slug: plan.slug,
        ageGroup: plan.ageGroup,
        sessionsPerWeek: plan.sessionsPerWeek,
        priceCents: plan.priceCents,
        billingCycle: plan.billingCycle,
        description: plan.description,
        includesHitting: plan.includesHitting,
        pairedWithPlanId: plan.pairedWithPlanId,
        revenueSplits: plan.revenueSplits,
        isActive: true,
      };
      await p.membershipPlan.upsert({
        where: { id: plan.id },
        create: { id: plan.id, ...data },
        update: data,
      });
      console.log(`  ✓ ${plan.id}`);
    } catch (err) {
      console.error(
        `  ✗ ${plan.id} — ${err instanceof Error ? err.message : err}`
      );
      // Don't throw — one bad plan shouldn't block server startup.
    }
  }
  console.log('[bootstrap-plans] Done.');
}
