import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate } from '../middleware/auth';
import Stripe from 'stripe';
import { config } from '../config';

const router = Router();

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

    // Determine onboarding status and fee requirement
    const isReturning = selection === 'returning';
    const isYouthGraduate = selection === 'youth_graduate';
    const hadFreeAssessment = selection === 'free_assessment';

    // Returning athletes don't pay the fee. Everyone else does.
    const onboardingStatus = isReturning ? 'RETURNING' : 'NEW';
    const feeStatus = isReturning ? 'NOT_APPLICABLE' : 'REQUIRED';

    const onboardingRecord = await prisma.onboardingRecord.create({
      data: {
        athleteId: athleteProfile.id,
        onboardingStatus,
        feeStatus,
        onboardingFeeCents: isReturning ? 0 : 30000,
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
      success_url: `${config.frontendUrl}/register?step=location&payment=success`,
      cancel_url: `${config.frontendUrl}/register?step=payment&payment=cancelled`,
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
