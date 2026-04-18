import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate, requireAdmin } from '../middleware/auth';
import crypto from 'crypto';

const router = Router();

function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ============================================================
// SCHOOL TEAMS CRUD
// ============================================================

/**
 * GET /api/schools
 * Admin: list all partner school teams.
 */
router.get('/', authenticate, requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const schools = await prisma.schoolTeam.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { athletes: true, invoices: true, contracts: true } },
        primaryLocation: { select: { id: true, name: true } },
      },
    });

    res.json({ data: schools });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/schools/:id
 * Admin: get school team detail with athletes, invoices, contracts.
 */
router.get('/:id', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const school = await prisma.schoolTeam.findUnique({
      where: { id },
      include: {
        primaryLocation: { select: { id: true, name: true } },
        athletes: {
          include: {
            user: { select: { id: true, fullName: true, email: true, phone: true, isActive: true } },
          },
        },
        invoices: { orderBy: { createdAt: 'desc' } },
        contracts: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!school) throw new ApiError(404, 'School team not found');
    res.json({ data: school });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/schools
 * Admin: create a new partner school team.
 */
router.post('/', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      name,
      coachName,
      coachEmail,
      coachPhone,
      paymentContactName,
      paymentContactEmail,
      primaryLocationId,
      brandLogoUrl,
      brandColors,
      totalAnnualBudget,
    } = req.body;

    if (!name) throw new ApiError(400, 'School/team name is required');

    // Generate unique slug
    let baseSlug = slugify(name);
    let slug = baseSlug;
    let attempt = 0;
    while (await prisma.schoolTeam.findUnique({ where: { slug } })) {
      attempt++;
      slug = `${baseSlug}-${attempt}`;
    }

    const signupUrl = `/join/team/${slug}`;

    const school = await prisma.schoolTeam.create({
      data: {
        name,
        slug,
        signupUrl,
        coachName: coachName || null,
        coachEmail: coachEmail || null,
        coachPhone: coachPhone || null,
        paymentContactName: paymentContactName || null,
        paymentContactEmail: paymentContactEmail || null,
        primaryLocationId: primaryLocationId || null,
        brandLogoUrl: brandLogoUrl || null,
        brandColors: brandColors || null,
        totalAnnualBudget: totalAnnualBudget ? parseInt(totalAnnualBudget) : null,
      },
    });

    res.status(201).json({ data: school });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/schools/:id
 * Admin: update a partner school team.
 */
router.put('/:id', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const {
      name,
      coachName,
      coachEmail,
      coachPhone,
      paymentContactName,
      paymentContactEmail,
      primaryLocationId,
      brandLogoUrl,
      brandColors,
      totalAnnualBudget,
      isActive,
    } = req.body;

    const existing = await prisma.schoolTeam.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, 'School team not found');

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (coachName !== undefined) data.coachName = coachName;
    if (coachEmail !== undefined) data.coachEmail = coachEmail;
    if (coachPhone !== undefined) data.coachPhone = coachPhone;
    if (paymentContactName !== undefined) data.paymentContactName = paymentContactName;
    if (paymentContactEmail !== undefined) data.paymentContactEmail = paymentContactEmail;
    if (primaryLocationId !== undefined) data.primaryLocationId = primaryLocationId || null;
    if (brandLogoUrl !== undefined) data.brandLogoUrl = brandLogoUrl;
    if (brandColors !== undefined) data.brandColors = brandColors;
    if (totalAnnualBudget !== undefined) data.totalAnnualBudget = totalAnnualBudget ? parseInt(totalAnnualBudget) : null;
    if (isActive !== undefined) data.isActive = isActive;

    const school = await prisma.schoolTeam.update({ where: { id }, data });
    res.json({ data: school });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// COACH INVITE
// ============================================================

/**
 * POST /api/schools/:id/invite-coach
 * Admin: generate invite link and send to coach.
 */
router.post('/:id/invite-coach', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const school = await prisma.schoolTeam.findUnique({ where: { id } });
    if (!school) throw new ApiError(404, 'School team not found');
    if (!school.coachEmail) throw new ApiError(400, 'Coach email is required before sending invite');

    // Generate a secure invite token
    const coachInviteToken = crypto.randomBytes(32).toString('hex');

    const updated = await prisma.schoolTeam.update({
      where: { id },
      data: {
        coachInviteToken,
        coachInviteStatus: 'SENT',
        coachInviteSentAt: new Date(),
      },
    });

    // TODO: Send actual email to coach with the invite link
    // The link would be: /join/team/{slug}/roster?token={coachInviteToken}
    const inviteLink = `/join/team/${school.slug}/roster?token=${coachInviteToken}`;

    res.json({
      data: updated,
      inviteLink,
      message: `Invite ready for ${school.coachEmail}`,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// COACH ROSTER SUBMISSION (PUBLIC — no auth required)
// ============================================================

/**
 * GET /api/schools/roster/:token
 * Public: validate coach invite token and return school info.
 */
router.get('/roster/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = param(req, 'token');
    const school = await prisma.schoolTeam.findUnique({
      where: { coachInviteToken: token },
      select: {
        id: true,
        name: true,
        slug: true,
        brandLogoUrl: true,
        brandColors: true,
        coachName: true,
        coachInviteStatus: true,
        rosterSubmittedAt: true,
      },
    });

    if (!school) throw new ApiError(404, 'Invalid or expired invite link');
    if (school.coachInviteStatus === 'EXPIRED') throw new ApiError(410, 'This invite has expired');

    res.json({ data: school });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/schools/roster/:token
 * Public: coach submits athlete roster. Creates user accounts and sends invites.
 */
router.post('/roster/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = param(req, 'token');
    const { athletes } = req.body; // [{ firstName, lastName, email, phone }]

    if (!athletes || !Array.isArray(athletes) || athletes.length === 0) {
      throw new ApiError(400, 'At least one athlete is required');
    }

    const school = await prisma.schoolTeam.findUnique({
      where: { coachInviteToken: token },
    });

    if (!school) throw new ApiError(404, 'Invalid or expired invite link');
    if (school.coachInviteStatus === 'EXPIRED') throw new ApiError(410, 'This invite has expired');

    const created: string[] = [];
    const skipped: string[] = [];

    for (const athlete of athletes) {
      const { firstName, lastName, email, phone } = athlete;
      if (!firstName || !lastName || !email) {
        skipped.push(`${firstName || '?'} ${lastName || '?'} — missing required fields`);
        continue;
      }

      // Check if user already exists
      const existingUser = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
      if (existingUser) {
        skipped.push(`${firstName} ${lastName} — email already registered`);
        continue;
      }

      // Create User + AthleteProfile + OnboardingRecord in a transaction
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: email.toLowerCase(),
            fullName: `${firstName} ${lastName}`,
            phone: phone || null,
            role: 'CLIENT',
            accountType: 'PARTNER_SCHOOL',
            authProvider: 'email',
          },
        });

        await tx.clientProfile.create({
          data: {
            userId: user.id,
            trainingPreference: 'REMOTE',
          },
        });

        await tx.athleteProfile.create({
          data: {
            userId: user.id,
            schoolTeamId: school.id,
            relationToParent: 'TEAM_MEMBER',
            firstName,
            lastName,
            trainingDeliveryPref: 'REMOTE',
          },
        });

        // Create onboarding record — partner school athletes don't pay onboarding fee
        await tx.onboardingRecord.create({
          data: {
            athleteId: (await tx.athleteProfile.findUnique({ where: { userId: user.id } }))!.id,
            onboardingStatus: 'PARTNER_SCHOOL',
            feeStatus: 'NOT_APPLICABLE',
          },
        });
      });

      created.push(`${firstName} ${lastName}`);
    }

    // Mark roster as submitted
    await prisma.schoolTeam.update({
      where: { id: school.id },
      data: {
        coachInviteStatus: 'ACCEPTED',
        rosterSubmittedAt: new Date(),
      },
    });

    // TODO: Send branded invite emails to each created athlete

    res.json({
      data: {
        created: created.length,
        skipped: skipped.length,
        createdNames: created,
        skippedReasons: skipped,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// INVOICES
// ============================================================

/**
 * POST /api/schools/:id/invoices
 * Admin: create an invoice for a school team.
 */
router.post('/:id/invoices', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schoolTeamId = param(req, 'id');
    const { description, totalCents, dueDate, periodStart, periodEnd, notes } = req.body;

    if (!totalCents || totalCents <= 0) throw new ApiError(400, 'Invoice amount is required');

    const school = await prisma.schoolTeam.findUnique({ where: { id: schoolTeamId } });
    if (!school) throw new ApiError(404, 'School team not found');

    const invoice = await prisma.schoolInvoice.create({
      data: {
        schoolTeamId,
        description: description || null,
        totalCents: parseInt(totalCents),
        dueDate: dueDate ? new Date(dueDate) : null,
        periodStart: periodStart ? new Date(periodStart) : null,
        periodEnd: periodEnd ? new Date(periodEnd) : null,
        notes: notes || null,
      },
    });

    res.status(201).json({ data: invoice });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/schools/:schoolId/invoices/:invoiceId
 * Admin: update invoice (change status, mark paid, etc.)
 */
router.put('/:schoolId/invoices/:invoiceId', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invoiceId = param(req, 'invoiceId');
    const { status, paidCents, description, totalCents, dueDate, notes } = req.body;

    const existing = await prisma.schoolInvoice.findUnique({ where: { id: invoiceId } });
    if (!existing) throw new ApiError(404, 'Invoice not found');

    const data: Record<string, unknown> = {};
    if (status !== undefined) {
      const validStatuses = ['DRAFT', 'SENT', 'PAID', 'OVERDUE', 'VOID'];
      if (!validStatuses.includes(status)) throw new ApiError(400, 'Invalid status');
      data.status = status;
      if (status === 'SENT' && !existing.sentAt) data.sentAt = new Date();
      if (status === 'PAID') data.paidAt = new Date();
    }
    if (paidCents !== undefined) data.paidCents = parseInt(paidCents);
    if (description !== undefined) data.description = description;
    if (totalCents !== undefined) data.totalCents = parseInt(totalCents);
    if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;
    if (notes !== undefined) data.notes = notes;

    const invoice = await prisma.schoolInvoice.update({ where: { id: invoiceId }, data });
    res.json({ data: invoice });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// CONTRACTS
// ============================================================

/**
 * POST /api/schools/:id/contracts
 * Admin: create a contract for a school team.
 */
router.post('/:id/contracts', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schoolTeamId = param(req, 'id');
    const { title, terms, startDate, endDate, totalValueCents } = req.body;

    if (!title || !terms || !startDate || !endDate) {
      throw new ApiError(400, 'Title, terms, start date, and end date are required');
    }

    const school = await prisma.schoolTeam.findUnique({ where: { id: schoolTeamId } });
    if (!school) throw new ApiError(404, 'School team not found');

    // Generate a signing link token
    const signatureToken = crypto.randomBytes(32).toString('hex');

    const contract = await prisma.schoolContract.create({
      data: {
        schoolTeamId,
        title,
        terms,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        totalValueCents: totalValueCents ? parseInt(totalValueCents) : null,
        signatureToken,
      },
    });

    res.status(201).json({ data: contract });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/schools/:schoolId/contracts/:contractId
 * Admin: update contract status, send, etc.
 */
router.put('/:schoolId/contracts/:contractId', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const contractId = param(req, 'contractId');
    const { status, title, terms, startDate, endDate, totalValueCents } = req.body;

    const existing = await prisma.schoolContract.findUnique({ where: { id: contractId } });
    if (!existing) throw new ApiError(404, 'Contract not found');

    const data: Record<string, unknown> = {};
    if (status !== undefined) {
      const valid = ['DRAFT', 'SENT', 'SIGNED', 'EXPIRED', 'VOIDED'];
      if (!valid.includes(status)) throw new ApiError(400, 'Invalid status');
      data.status = status;
      if (status === 'SENT' && !existing.sentAt) data.sentAt = new Date();
    }
    if (title !== undefined) data.title = title;
    if (terms !== undefined) data.terms = terms;
    if (startDate !== undefined) data.startDate = new Date(startDate);
    if (endDate !== undefined) data.endDate = new Date(endDate);
    if (totalValueCents !== undefined) data.totalValueCents = totalValueCents ? parseInt(totalValueCents) : null;

    const contract = await prisma.schoolContract.update({ where: { id: contractId }, data });
    res.json({ data: contract });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/schools/contracts/:token
 * Public: view contract details via the signature token.
 */
router.get('/contracts/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = param(req, 'token');

    const contract = await prisma.schoolContract.findUnique({
      where: { signatureToken: token },
      include: { schoolTeam: { select: { name: true, brandColors: true, brandLogoUrl: true } } },
    });

    if (!contract) throw new ApiError(404, 'Invalid contract link');

    res.json({
      data: {
        id: contract.id,
        title: contract.title,
        terms: contract.terms,
        startDate: contract.startDate,
        endDate: contract.endDate,
        totalValueCents: contract.totalValueCents,
        status: contract.status,
        signedByName: contract.signedByName,
        signedAt: contract.signedAt,
        schoolTeam: contract.schoolTeam,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/schools/contracts/:token/sign
 * Public: sign a contract via the signature token.
 */
router.post('/contracts/:token/sign', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = param(req, 'token');
    const { signedByName, signedByEmail } = req.body;

    if (!signedByName || !signedByEmail) {
      throw new ApiError(400, 'Name and email are required to sign');
    }

    const contract = await prisma.schoolContract.findUnique({
      where: { signatureToken: token },
      include: { schoolTeam: { select: { name: true } } },
    });

    if (!contract) throw new ApiError(404, 'Invalid contract link');
    if (contract.status === 'SIGNED') throw new ApiError(400, 'Contract already signed');
    if (contract.status === 'VOIDED') throw new ApiError(400, 'Contract has been voided');
    if (contract.status === 'EXPIRED') throw new ApiError(400, 'Contract has expired');

    const updated = await prisma.schoolContract.update({
      where: { id: contract.id },
      data: {
        status: 'SIGNED',
        signedByName,
        signedByEmail: signedByEmail.toLowerCase(),
        signedAt: new Date(),
      },
    });

    res.json({
      data: updated,
      message: `Contract signed by ${signedByName}`,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
