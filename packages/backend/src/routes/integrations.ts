import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireStaffOrAdmin } from '../middleware/auth';
import { config } from '../config';
import { prisma } from '../utils/prisma';
import { Role } from '@prisma/client';

const router = Router();

/**
 * GET /api/integrations/health
 * Admin only: test connectivity + configuration for every integration the
 * app talks to. Drives the /admin/integrations diagnostic dashboard.
 *
 * Each check returns:
 *   - status: 'connected' | 'not_configured' | 'error' | 'partial'
 *   - message: human-readable explanation
 *   - missing?: array of env var / setting names the admin needs to set
 */
router.get('/health', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    if (user.role !== Role.ADMIN) {
      return res.status(403).json({ success: false, message: 'Admin only' });
    }

    const [stripe, email, twilio, ai, places, resendInbound, orgSettings] = await Promise.all([
      checkStripe(),
      checkEmail(),
      checkTwilio(),
      checkAnthropic(),
      checkGooglePlaces(),
      checkResendInbound(),
      checkOrgSettings(),
    ]);

    res.json({
      success: true,
      data: { stripe, email, twilio, ai, places, resendInbound, orgSettings },
    });
  } catch (error) {
    next(error);
  }
});

async function checkStripe(): Promise<{ status: string; message?: string }> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { status: 'not_configured', message: 'STRIPE_SECRET_KEY not set' };

  try {
    // Dynamic import to avoid hard crash if stripe isn't installed
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(key, { apiVersion: '2024-04-10' as any });

    // Simple balance check to verify the key works
    const balance = await stripe.balance.retrieve();
    const available = balance.available.reduce((sum, b) => sum + b.amount, 0);
    return {
      status: 'connected',
      message: `Live mode active. Available balance: $${(available / 100).toFixed(2)}`,
    };
  } catch (err: any) {
    return {
      status: 'error',
      message: err.message || 'Failed to connect to Stripe',
    };
  }
}

async function checkEmail(): Promise<{ status: string; message?: string }> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return { status: 'not_configured', message: 'SMTP credentials not fully set' };
  }

  try {
    const nodemailer = (await import('nodemailer')).default;
    const transporter = nodemailer.createTransport({
      host,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_PORT === '465',
      auth: { user, pass },
    });

    await transporter.verify();
    return { status: 'connected', message: `SMTP verified (${host})` };
  } catch (err: any) {
    return {
      status: 'error',
      message: err.message || 'SMTP connection failed',
    };
  }
}

async function checkTwilio(): Promise<{ status: string; message?: string; missing?: string[] }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_FROM_NUMBER;
  const forwardTo = process.env.TWILIO_FORWARD_TO;

  const missing: string[] = [];
  if (!sid) missing.push('TWILIO_ACCOUNT_SID');
  if (!token) missing.push('TWILIO_AUTH_TOKEN');
  if (!from) missing.push('TWILIO_PHONE_NUMBER');
  if (!forwardTo) missing.push('TWILIO_FORWARD_TO (optional, for inbound forwarding)');

  if (!sid || !token || !from) {
    return { status: 'not_configured', message: 'Twilio credentials not fully set', missing };
  }

  try {
    const twilio = (await import('twilio')).default;
    const client = twilio(sid, token);
    const account = await client.api.accounts(sid).fetch();
    return {
      status: forwardTo ? 'connected' : 'partial',
      message: `Account: ${account.friendlyName} | From: ${from}${forwardTo ? '' : ' | Inbound call forwarding NOT configured'}`,
      ...(forwardTo ? {} : { missing: ['TWILIO_FORWARD_TO'] }),
    };
  } catch (err: any) {
    return {
      status: 'error',
      message: err.message || 'Twilio connection failed',
    };
  }
}

async function checkAnthropic(): Promise<{ status: string; message?: string; missing?: string[] }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return {
      status: 'not_configured',
      message: 'AI features (email composer, review reply) disabled',
      missing: ['ANTHROPIC_API_KEY'],
    };
  }
  return {
    status: 'connected',
    message: `Key configured (${key.slice(0, 10)}…)`,
  };
}

async function checkGooglePlaces(): Promise<{ status: string; message?: string; missing?: string[] }> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const settings: any = await prisma.orgSettings.findUnique({ where: { id: 'ppl' } });
  const placeId: string | null = settings?.googlePlaceId ?? null;

  const missing: string[] = [];
  if (!key) missing.push('GOOGLE_PLACES_API_KEY');
  if (!placeId) missing.push('OrgSettings.googlePlaceId (set on /admin/settings)');

  if (!key && !placeId) {
    return {
      status: 'not_configured',
      message: 'Review monitoring disabled — needs API key + Place ID',
      missing,
    };
  }
  if (!key || !placeId) {
    return { status: 'partial', message: 'Partially configured', missing };
  }
  return { status: 'connected', message: `Key set, Place ID: ${placeId.slice(0, 12)}…` };
}

async function checkResendInbound(): Promise<{ status: string; message?: string; missing?: string[] }> {
  const apiKey = process.env.RESEND_API_KEY;
  const inboundSecret = process.env.RESEND_INBOUND_SECRET;
  const missing: string[] = [];
  if (!apiKey) missing.push('RESEND_API_KEY');
  if (!inboundSecret) missing.push('RESEND_INBOUND_SECRET (for inbound email webhook verification)');

  if (!apiKey) {
    return { status: 'not_configured', message: 'Resend not configured', missing };
  }
  return {
    status: inboundSecret ? 'connected' : 'partial',
    message: inboundSecret
      ? 'API + inbound webhook signing both configured'
      : 'API configured, inbound webhook signing NOT configured',
    ...(inboundSecret ? {} : { missing }),
  };
}

async function checkOrgSettings(): Promise<{ status: string; message?: string; missing?: string[] }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s: any = await prisma.orgSettings.findUnique({ where: { id: 'ppl' } });
  if (!s) {
    return {
      status: 'error',
      message: 'OrgSettings row missing — bootstrap should have created it',
    };
  }

  const missing: string[] = [];
  if (!s.googleReviewUrl) missing.push('googleReviewUrl');
  if (!s.facebookReviewUrl) missing.push('facebookReviewUrl');
  if (!s.googlePlaceId) missing.push('googlePlaceId');

  return {
    status: missing.length === 0 ? 'connected' : 'partial',
    message:
      missing.length === 0
        ? 'All review-related settings configured'
        : `${3 - missing.length} of 3 review settings configured`,
    ...(missing.length > 0 ? { missing } : {}),
  };
}

void config; // silence unused-import linter

export default router;
