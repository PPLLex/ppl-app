import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate } from '../middleware/auth';
import { createAuditLog } from '../services/auditService';
import {
  sendEmail,
  buildReturningAthleteAlertEmail,
  buildOnboardingFeeRequestEmail,
} from '../services/emailService';
import { LocationRole, Role } from '@prisma/client';
import Stripe from 'stripe';
import { config } from '../config';

const router = Router();

function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

// Initialize Stripe (will be null if key not configured yet)
const stripe = config.stripe.secretKey
  ? new Stripe(config.stripe.secretKey, { apiVersion: '2024-04-10' as Stripe.LatestApiVersion })
  : null;

/**
 * POST /api/onboarding/status
 * Set the athlete's onboarding status (new vs returning) and create their OnboardingRecord.
 * Called during registration after the user selects their status.
 *
 * Body: { selection: "new" | "returning" | "youth_graduate" | "free_assessment" }
 */
router.post('/status', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { selection } = req.body;

    const validSelections = ['new', 'returning', 'youth_graduate', 'free_assessment'];
    if (!selection || !validSelections.includes(selection)) {
      throw ApiError.badRequest(
        'Please select your athlete status: new, returning, youth_graduate, or free_assessment'
      );
    }

    // Get the user's athlete profile — auto-create if it doesn't exist.
    //
    // The /register endpoint only creates a User row; we lazily materialize
    // the AthleteProfile when the athlete first hits this onboarding step.
    // That keeps registration simple and also means existing clients who
    // paid the $300 onboarding fee BEFORE the app existed can sign up for
    // the app and pick "returning" on this screen — we'll create their
    // profile on the fly and mark the fee as NOT_APPLICABLE so they don't
    // get double-charged.
    let athleteProfile = await prisma.athleteProfile.findUnique({
      where: { userId },
      include: { onboardingRecord: true },
    });

    if (!athleteProfile) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { fullName: true },
      });
      if (!user) throw ApiError.notFound('User account not found.');

      // Split fullName into first/last. If it's a single word, fall back to
      // "Athlete" for the last name so we satisfy the non-null constraint.
      const nameParts = (user.fullName || '').trim().split(/\s+/).filter(Boolean);
      const firstName = nameParts[0] || 'Athlete';
      const lastName = nameParts.slice(1).join(' ') || 'Athlete';

      const created = await prisma.athleteProfile.create({
        data: { userId, firstName, lastName },
      });
      athleteProfile = { ...created, onboardingRecord: null };
    }

    // If they already have an onboarding record, return it
    if (athleteProfile.onboardingRecord) {
      return res.json({
        success: true,
        data: {
          onboardingRecord: athleteProfile.onboardingRecord,
          requiresPayment: athleteProfile.onboardingRecord.feeStatus === 'REQUIRED',
        },
      });
    }

    // Determine onboarding status and fee requirement.
    //
    // ONLY self-reported "new" athletes pay the $300 onboarding fee.
    // Three paths bypass the fee:
    //   - returning       — already onboarded in a past enrollment
    //   - youth_graduate  — aged up from the Youth program; the Youth
    //                       program onboarding fee already covers them
    //   - free_assessment — invited for a complimentary trial or team
    //                       assessment, which is our sales funnel
    const isReturning = selection === 'returning';
    const isYouthGraduate = selection === 'youth_graduate';
    const hadFreeAssessment = selection === 'free_assessment';
    const bypassFee = isReturning || isYouthGraduate || hadFreeAssessment;

    const onboardingStatus = isReturning ? 'RETURNING' : 'NEW';
    const feeStatus = bypassFee ? 'NOT_APPLICABLE' : 'REQUIRED';

    const onboardingRecord = await prisma.onboardingRecord.create({
      data: {
        athleteId: athleteProfile.id,
        onboardingStatus,
        feeStatus,
        onboardingFeeCents: bypassFee ? 0 : 30000,
        isYouthGraduate,
        hadFreeAssessment,
        selfReportedStatus: selection,
        qualifyingAnswers: {
          selection,
          trainedBefore: isReturning,
          isYouthGraduate,
          hadFreeAssessment,
          submittedAt: new Date().toISOString(),
        },
      },
    });

    // If this was a "returning" self-selection, alert admins + coordinators at
    // the athlete's home location so they can verify and decide whether to
    // charge the $300 fee anyway. Fire-and-forget — don't block the registration
    // response on email delivery.
    if (isReturning) {
      notifyReturningAthleteSignup({
        userId,
        athleteProfileId: athleteProfile.id,
        onboardingRecordId: onboardingRecord.id,
      }).catch((err) =>
        console.error('[onboarding] returning-athlete alert failed:', err)
      );
    }

    res.status(201).json({
      success: true,
      data: {
        onboardingRecord,
        requiresPayment: feeStatus === 'REQUIRED',
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Fire the returning-athlete alert email to admins + coordinators at the
 * athlete's home location. Non-blocking; logs errors but doesn't throw.
 */
async function notifyReturningAthleteSignup(args: {
  userId: string;
  athleteProfileId: string;
  onboardingRecordId: string;
}) {
  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: {
      fullName: true,
      email: true,
      phone: true,
      homeLocationId: true,
      homeLocation: { select: { id: true, name: true } },
    },
  });
  if (!user) return;

  // Who to notify:
  //   - All ADMINs globally
  //   - All staff with PITCHING_COORDINATOR or YOUTH_COORDINATOR at the
  //     athlete's home location
  const [admins, coordinators] = await Promise.all([
    prisma.user.findMany({
      where: { role: Role.ADMIN },
      select: { id: true, fullName: true, email: true },
    }),
    user.homeLocationId
      ? prisma.staffLocation.findMany({
          where: {
            locationId: user.homeLocationId,
            roles: {
              hasSome: [LocationRole.PITCHING_COORDINATOR, LocationRole.YOUTH_COORDINATOR],
            },
          },
          select: {
            staff: { select: { id: true, fullName: true, email: true, role: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  // Dedupe by email (an admin who's also a coordinator would otherwise get two).
  const recipientsMap = new Map<
    string,
    { id: string; fullName: string; email: string }
  >();
  for (const a of admins) recipientsMap.set(a.email, a);
  for (const c of coordinators) {
    if (c.staff && !recipientsMap.has(c.staff.email)) {
      recipientsMap.set(c.staff.email, {
        id: c.staff.id,
        fullName: c.staff.fullName,
        email: c.staff.email,
      });
    }
  }
  const recipients = Array.from(recipientsMap.values());

  const reviewUrl = `${config.frontendUrl}/admin/onboarding-reviews`;
  const locationName = user.homeLocation?.name || 'Unassigned';

  await Promise.allSettled(
    recipients.map((r) =>
      sendEmail({
        to: r.email,
        subject: `Returning athlete needs review — ${user.fullName}`,
        text:
          `A new signup claims to be a returning PPL athlete — the $300 onboarding fee was ` +
          `skipped. Please review at ${reviewUrl} and decide whether to charge the fee. ` +
          `Only one admin can charge (atomic claim — no double-billing).`,
        html: buildReturningAthleteAlertEmail({
          recipientFirstName: r.fullName.split(' ')[0],
          athleteName: user.fullName,
          athleteEmail: user.email,
          athletePhone: user.phone,
          locationName,
          reviewUrl,
        }),
      })
    )
  );
}

/**
 * GET /api/onboarding/admin/pending-reviews
 * Admin/staff-only: list of returning athletes whose onboarding fee has been
 * skipped (feeStatus=NOT_APPLICABLE based on self-reported returning status)
 * and hasn't been reviewed/charged yet. Use this to populate the admin UI.
 */
router.get(
  '/admin/pending-reviews',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.user!.role !== 'ADMIN' && req.user!.role !== 'STAFF') {
        throw ApiError.forbidden('Admin or staff access required');
      }

      // Returning athletes whose onboarding record is still in the
      // NOT_APPLICABLE fee state — meaning no one has acted on them yet.
      const records = await prisma.onboardingRecord.findMany({
        where: {
          feeStatus: 'NOT_APPLICABLE',
          onboardingStatus: 'RETURNING',
        },
        include: {
          athlete: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              user: {
                select: {
                  id: true,
                  fullName: true,
                  email: true,
                  phone: true,
                  createdAt: true,
                  homeLocation: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const data = records.map((r) => ({
        onboardingRecordId: r.id,
        athleteProfileId: r.athleteId,
        createdAt: r.createdAt,
        selfReportedStatus: r.selfReportedStatus,
        athlete: {
          id: r.athlete.user.id,
          fullName: r.athlete.user.fullName,
          email: r.athlete.user.email,
          phone: r.athlete.user.phone,
          createdAt: r.athlete.user.createdAt,
          location: r.athlete.user.homeLocation,
        },
      }));

      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/onboarding/admin/charge-fee/:recordId
 * Admin-only: flip a returning athlete's NOT_APPLICABLE fee to REQUIRED and
 * email them a pay link. ATOMIC — uses an updateMany with a where-clause
 * filter so only one admin's click succeeds. Subsequent clicks see 409.
 */
router.post(
  '/admin/charge-fee/:recordId',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.user!.role !== 'ADMIN') {
        throw ApiError.forbidden('Only admins can charge the onboarding fee');
      }

      const recordId = param(req, 'recordId');
      const { note } = req.body as { note?: string };

      // Atomic claim: updateMany returns count — if 0, someone else already
      // acted on this record (or it was never in the right state).
      const claim = await prisma.onboardingRecord.updateMany({
        where: {
          id: recordId,
          feeStatus: 'NOT_APPLICABLE',
          onboardingStatus: 'RETURNING',
        },
        data: {
          feeStatus: 'REQUIRED',
          onboardingFeeCents: 30000,
        },
      });

      if (claim.count === 0) {
        throw ApiError.conflict(
          'This onboarding fee has already been processed by another admin — no action taken.'
        );
      }

      // Load the athlete for the email
      const record = await prisma.onboardingRecord.findUnique({
        where: { id: recordId },
        include: {
          athlete: {
            select: {
              user: { select: { id: true, fullName: true, email: true } },
            },
          },
        },
      });

      if (record?.athlete?.user) {
        const u = record.athlete.user;
        const loginUrl = `${config.frontendUrl}/login?next=${encodeURIComponent('/register?step=payment')}`;
        sendEmail({
          to: u.email,
          subject: 'Complete your PPL onboarding — $300 fee',
          text:
            `Hey ${u.fullName.split(' ')[0]}, we need to collect the one-time $300 ` +
            `PPL onboarding fee before your account is activated. Log in to pay: ${loginUrl}` +
            (note ? `\n\nNote from PPL: ${note}` : ''),
          html: buildOnboardingFeeRequestEmail({
            athleteFirstName: u.fullName.split(' ')[0],
            loginUrl,
            note: note || null,
          }),
        }).catch((err) =>
          console.error('[onboarding] fee-request email failed:', err)
        );
      }

      await createAuditLog({
        action: 'ONBOARDING_FEE_CHARGED_BY_ADMIN',
        userId: req.user!.userId,
        resourceType: 'OnboardingRecord',
        resourceId: recordId,
        changes: {
          athleteUserId: record?.athlete?.user?.id,
          athleteEmail: record?.athlete?.user?.email,
          feeStatus: 'NOT_APPLICABLE → REQUIRED',
          note: note || null,
        },
      });

      res.json({
        success: true,
        message: `Fee marked as required. ${record?.athlete?.user?.fullName || 'Athlete'} has been emailed a pay link.`,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/onboarding/checkout
 * Create a Stripe Checkout Session for the $300 onboarding fee.
 * Called after the athlete selects "new" status.
 */
router.post('/checkout', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;

    if (!stripe) {
      throw ApiError.internal('Payment processing is not configured yet. Please contact PPL staff.');
    }

    // Get athlete profile with onboarding record
    const athleteProfile = await prisma.athleteProfile.findUnique({
      where: { userId },
      include: {
        onboardingRecord: true,
        user: { select: { email: true, fullName: true } },
      },
    });

    if (!athleteProfile) {
      throw ApiError.notFound('Athlete profile not found.');
    }

    if (!athleteProfile.onboardingRecord) {
      throw ApiError.badRequest('Please select your athlete status first.');
    }

    const record = athleteProfile.onboardingRecord;

    if (record.feeStatus === 'PAID' || record.feeStatus === 'NOT_APPLICABLE' || record.feeStatus === 'WAIVED') {
      return res.json({
        success: true,
        data: { alreadyPaid: true, feeStatus: record.feeStatus },
      });
    }

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: athleteProfile.user.email,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'PPL Onboarding Fee',
              description: 'One-time onboarding fee for new Pitching Performance Lab athletes',
            },
            unit_amount: record.onboardingFeeCents,
          },
          quantity: 1,
        },
      ],
      metadata: {
        type: 'onboarding_fee',
        athleteProfileId: athleteProfile.id,
        onboardingRecordId: record.id,
        userId,
      },
      // success_url MUST match the frontend's getInitialStep() check:
      // /register detects `step=after-fee` + `payment=success` and jumps to
      // step 4 (location/training preference). Previously this was
      // `step=location` which the frontend didn't recognize → user bounced
      // back to step 1 after paying. See audit issue #2.
      success_url: `${config.frontendUrl}/register?step=after-fee&payment=success`,
      cancel_url: `${config.frontendUrl}/register?step=after-fee&payment=cancelled`,
    });

    // Update the onboarding record with the checkout session ID
    await prisma.onboardingRecord.update({
      where: { id: record.id },
      data: {
        stripeCheckoutId: session.id,
        feeStatus: 'PROCESSING',
      },
    });

    res.json({
      success: true,
      data: { checkoutUrl: session.url },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/onboarding/confirm-payment
 * Called after Stripe redirect to verify payment went through.
 * Also called by the Stripe webhook for belt-and-suspenders reliability.
 */
router.post('/confirm-payment', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;

    const athleteProfile = await prisma.athleteProfile.findUnique({
      where: { userId },
      include: { onboardingRecord: true },
    });

    if (!athleteProfile?.onboardingRecord) {
      throw ApiError.notFound('Onboarding record not found.');
    }

    const record = athleteProfile.onboardingRecord;

    // If already paid, just confirm
    if (record.feeStatus === 'PAID') {
      return res.json({ success: true, data: { paid: true } });
    }

    // Verify with Stripe if we have a checkout session
    if (stripe && record.stripeCheckoutId) {
      const session = await stripe.checkout.sessions.retrieve(record.stripeCheckoutId);

      if (session.payment_status === 'paid') {
        await prisma.onboardingRecord.update({
          where: { id: record.id },
          data: {
            feeStatus: 'PAID',
            stripePaymentId: session.payment_intent as string,
            completedAt: new Date(),
          },
        });

        return res.json({ success: true, data: { paid: true } });
      }
    }

    res.json({ success: true, data: { paid: false, feeStatus: record.feeStatus } });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/onboarding/me
 * Get the current user's onboarding status.
 */
router.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;

    const athleteProfile = await prisma.athleteProfile.findUnique({
      where: { userId },
      include: { onboardingRecord: true },
    });

    res.json({
      success: true,
      data: {
        hasProfile: !!athleteProfile,
        onboardingRecord: athleteProfile?.onboardingRecord || null,
        // Expose the source-of-truth ageGroup so the /register resume-flow
        // can preload playingLevel and filter plans correctly. See audit #11.
        ageGroup: athleteProfile?.ageGroup || null,
        requiresPayment: athleteProfile?.onboardingRecord?.feeStatus === 'REQUIRED',
        isComplete:
          athleteProfile?.onboardingRecord?.feeStatus === 'PAID' ||
          athleteProfile?.onboardingRecord?.feeStatus === 'NOT_APPLICABLE' ||
          athleteProfile?.onboardingRecord?.feeStatus === 'WAIVED',
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/onboarding/admin/waive-fee
 * Admin-only: manually waive the onboarding fee for an athlete.
 */
router.post('/admin/waive-fee', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.user!.role !== 'ADMIN') {
      throw ApiError.forbidden('Only admins can waive onboarding fees');
    }

    const { athleteProfileId } = req.body;
    if (!athleteProfileId) {
      throw ApiError.badRequest('athleteProfileId is required');
    }

    const record = await prisma.onboardingRecord.findUnique({
      where: { athleteId: athleteProfileId },
    });

    if (!record) {
      throw ApiError.notFound('Onboarding record not found');
    }

    const updated = await prisma.onboardingRecord.update({
      where: { id: record.id },
      data: {
        feeStatus: 'WAIVED',
        completedAt: new Date(),
      },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

export default router;
