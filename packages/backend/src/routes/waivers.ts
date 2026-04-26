/**
 * Liability Waiver routes.
 *
 * Every athlete (parent-managed or self-managed) must have an active
 * signature against the CURRENT waiver version before they can be
 * booked. Admins can edit the waiver text + bump the version at any
 * time via /api/settings; existing signatures then become stale and
 * force re-sign.
 *
 * Routes:
 *   GET  /api/waivers/current                 — current waiver text + version (auth only)
 *   GET  /api/waivers/status                  — map of athleteId -> signed? for my family
 *   POST /api/waivers/sign                    — sign for a specific athlete
 *   GET  /api/waivers/signatures              — admin: list all signatures
 *   GET  /api/waivers/signatures/:athleteId   — admin: history for one athlete
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate, requireAdmin } from '../middleware/auth';
import { Role } from '@prisma/client';

const router = Router();

const param = (req: Request, key: string): string =>
  Array.isArray(req.params[key]) ? (req.params[key] as string[])[0] : (req.params[key] as string);

/**
 * Default waiver text — used only if OrgSettings.liabilityWaiverText is
 * empty. Admins should edit this via the admin settings page.
 *
 * This is a cleaned-up, 2026-current version of the public waiver
 * scraped from pitchingperformancelab.com/user-agreement. Major changes
 * vs. the website copy: effective date set to 2026, indemnification
 * tightened to exclude PPL gross negligence, photo/likeness clause
 * scoped to "promotional use" rather than perpetual unlimited license,
 * and the cancellation/payment sections moved out (they belong in the
 * membership terms surfaced at checkout, not on the safety waiver).
 *
 * Chad: review this text in /admin/waivers (or wherever
 * OrgSettings.liabilityWaiverText is exposed) and tweak before going
 * live for new athletes.
 */
const DEFAULT_WAIVER_TEXT = `PITCHING PERFORMANCE LAB, LLC
LIABILITY WAIVER & RELEASE OF CLAIMS

Effective for all training participation on or after the date of signature.

ASSUMPTION OF RISK
I understand that participation in baseball training — throwing, pitching, hitting, conditioning, and related physical activities at Pitching Performance Lab ("PPL") — involves inherent risks of injury, including but not limited to: strains, sprains, muscle pulls, tendon or ligament damage, fractures, contusions, concussions, overuse injuries, and in rare cases serious or permanent injury or death.

ON BEHALF OF MYSELF AND/OR THE MINOR ATHLETE NAMED IN THIS SIGNATURE, I VOLUNTARILY ASSUME THESE RISKS AND AGREE:

1. To follow all PPL coach instructions, safety rules, and facility policies.
2. To disclose any known medical conditions, injuries, or physical limitations that may be relevant to training, and to update PPL if those change.
3. To immediately report any injury, pain, or discomfort to PPL staff.
4. To permit PPL staff to obtain emergency medical care for the athlete if needed; I am financially responsible for such care.

WAIVER & RELEASE
I, FOR MYSELF AND ON BEHALF OF MY HEIRS, EXECUTORS, AND ASSIGNS, HEREBY RELEASE PITCHING PERFORMANCE LAB, LLC, ITS OWNERS, COACHES, EMPLOYEES, AGENTS, AND CONTRACTORS FROM ANY AND ALL CLAIMS, DEMANDS, OR CAUSES OF ACTION ARISING OUT OF OR RELATED TO MY (OR MY CHILD'S) PARTICIPATION IN PPL TRAINING, except where caused by PPL's gross negligence or willful misconduct. I understand this is a release of liability and assumption of risk and I sign it voluntarily.

INDEMNIFICATION
I AGREE TO INDEMNIFY AND HOLD PPL HARMLESS from any loss, liability, or expense (including reasonable attorney fees) arising out of my violation of this Agreement, except where caused by PPL's gross negligence or willful misconduct.

DISPUTES BETWEEN ATHLETES
In the event of any dispute between me and another PPL athlete, member, parent, or visitor, I release PPL from claims, demands, and damages arising out of that dispute.

PHOTO & LIKENESS RELEASE
I grant PPL a non-exclusive, royalty-free license to photograph and record the athlete during PPL training and to use those images and recordings for PPL's promotional, marketing, and advertising purposes (website, social media, printed materials). I may revoke this consent at any time in writing; PPL will discontinue new use within a reasonable time after revocation. I understand PPL is not required to remove materials already published prior to revocation.

PARENTAL CONSENT (FOR ATHLETES UNDER 18)
If I am signing on behalf of a minor child (under 18), I represent that I am the parent or legal guardian with authority to do so, and I accept these terms on the minor's behalf.

DURATION
This waiver remains in effect for the duration of my (or my child's) PPL membership or participation in any PPL training. PPL may update this waiver from time to time; I will be required to review and re-sign any material changes.

ELECTRONIC SIGNATURE
By typing my name below and clicking "I Agree," I acknowledge that I have read, understood, and accepted this waiver, and I am signing it as my legal electronic signature.`;

/**
 * GET /api/waivers/current
 * Returns the current master waiver text + version.
 */
router.get('/current', authenticate, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settings: any = await prisma.orgSettings.findUnique({ where: { id: 'ppl' } });
    const text = (settings?.liabilityWaiverText || '').trim() || DEFAULT_WAIVER_TEXT;
    const version = settings?.liabilityWaiverVersion || '2026-04-26';
    res.json({ success: true, data: { text, version } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/waivers/status
 * For CLIENT accounts: returns { athletes: [{ athleteProfileId, athleteName, signed, signedAt? }] }
 * covering every athlete this user is responsible for (their own
 * AthleteProfile + any children in their Family).
 *
 * Admin / staff can pass ?userId=<id> to check on behalf of another user.
 */
router.get('/status', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw ApiError.unauthorized();

    // Resolve target user
    let targetUserId = req.user.userId;
    if (typeof req.query.userId === 'string' && req.query.userId) {
      if (req.user.role !== Role.ADMIN && req.user.role !== Role.STAFF) {
        throw ApiError.forbidden('Only admins can query other users');
      }
      targetUserId = req.query.userId;
    }

    // Collect athlete profiles: the user's own (if any) + all athletes in their family.
    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      include: {
        athleteProfile: true,
        family: { include: { athletes: true } },
      },
    });
    if (!user) throw ApiError.notFound('User not found');

    const profiles: Array<{ id: string; firstName: string; lastName: string }> = [];
    if (user.athleteProfile) {
      profiles.push({
        id: user.athleteProfile.id,
        firstName: user.athleteProfile.firstName,
        lastName: user.athleteProfile.lastName,
      });
    }
    if (user.family?.athletes) {
      for (const a of user.family.athletes) {
        if (!profiles.find((p) => p.id === a.id)) {
          profiles.push({ id: a.id, firstName: a.firstName, lastName: a.lastName });
        }
      }
    }

    if (profiles.length === 0) {
      res.json({ success: true, data: { athletes: [], currentVersion: null } });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settings: any = await prisma.orgSettings.findUnique({ where: { id: 'ppl' } });
    const currentVersion = settings?.liabilityWaiverVersion || '2026-04-26';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p: any = prisma;
    const sigs = await p.liabilityWaiverSignature.findMany({
      where: {
        athleteProfileId: { in: profiles.map((p) => p.id) },
        waiverVersion: currentVersion,
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sigMap = new Map<string, any>(sigs.map((s: any) => [s.athleteProfileId, s]));

    const athletes = profiles.map((p) => {
      const sig = sigMap.get(p.id);
      return {
        athleteProfileId: p.id,
        athleteName: `${p.firstName} ${p.lastName}`.trim(),
        signed: !!sig,
        signedAt: sig ? sig.signedAt : null,
        signedBy: sig ? sig.signedByName : null,
      };
    });

    res.json({ success: true, data: { athletes, currentVersion } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/waivers/sign
 * Body: { athleteProfileId, signedByName }
 *
 * Only the parent (Family.parentUserId) or the athlete themselves can
 * sign. Creates an immutable signature row at the current version.
 */
router.post('/sign', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw ApiError.unauthorized();
    const { athleteProfileId, signedByName } = req.body;
    if (!athleteProfileId || typeof athleteProfileId !== 'string') {
      throw ApiError.badRequest('athleteProfileId is required');
    }
    if (!signedByName || typeof signedByName !== 'string' || signedByName.trim().length < 2) {
      throw ApiError.badRequest('signedByName is required (type your full name)');
    }

    const athlete = await prisma.athleteProfile.findUnique({
      where: { id: athleteProfileId },
      include: { family: true, user: true },
    });
    if (!athlete) throw ApiError.notFound('Athlete not found');

    // Authorization: allow if signer is the athlete themselves, the
    // parent of the athlete's family, or admin/staff (concierge signing).
    const signerId = req.user.userId;
    const isSelf = athlete.userId === signerId;
    const isParent = athlete.family?.parentUserId === signerId;
    const isAdmin = req.user.role === Role.ADMIN || req.user.role === Role.STAFF;
    if (!isSelf && !isParent && !isAdmin) {
      throw ApiError.forbidden('You are not authorized to sign for this athlete');
    }

    // Load current waiver text + version so we snapshot at signing time
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settings: any = await prisma.orgSettings.findUnique({ where: { id: 'ppl' } });
    const text = (settings?.liabilityWaiverText || '').trim() || DEFAULT_WAIVER_TEXT;
    const version = settings?.liabilityWaiverVersion || '2026-04-26';

    const athleteName = `${athlete.firstName} ${athlete.lastName}`.trim();
    const ipAddress =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      null;
    const userAgent = (req.headers['user-agent'] as string | undefined) || null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p: any = prisma;
    // Upsert: if someone already signed this version, we keep the first
    // signature (idempotent), otherwise create new.
    const existing = await p.liabilityWaiverSignature.findUnique({
      where: {
        athleteProfileId_waiverVersion: { athleteProfileId, waiverVersion: version },
      },
    });
    if (existing) {
      res.json({ success: true, data: existing });
      return;
    }

    const row = await p.liabilityWaiverSignature.create({
      data: {
        athleteProfileId,
        signedByUserId: signerId,
        signedByName: signedByName.trim(),
        athleteName,
        waiverVersion: version,
        waiverText: text,
        ipAddress,
        userAgent,
      },
    });
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/waivers/signatures
 * Admin: list all signatures, newest first. Optional ?athleteProfileId= filter.
 */
router.get('/signatures', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const athleteProfileId = typeof req.query.athleteProfileId === 'string' ? req.query.athleteProfileId : undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p: any = prisma;
    const rows = await p.liabilityWaiverSignature.findMany({
      where: athleteProfileId ? { athleteProfileId } : {},
      orderBy: { signedAt: 'desc' },
      take: 500,
    });
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/waivers/signatures/:athleteId
 * Admin: full signature history for one athlete.
 */
router.get('/signatures/:athleteId', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const athleteProfileId = param(req, 'athleteId');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p: any = prisma;
    const rows = await p.liabilityWaiverSignature.findMany({
      where: { athleteProfileId },
      orderBy: { signedAt: 'desc' },
    });
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

export default router;
