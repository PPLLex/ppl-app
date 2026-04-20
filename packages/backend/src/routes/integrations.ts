import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireStaffOrAdmin } from '../middleware/auth';
import { config } from '../config';
import { Role } from '@prisma/client';

const router = Router();

/**
 * GET /api/integrations/health
 * Admin only: test connectivity to Stripe, SMTP, and Twilio.
 */
router.get('/health', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    if (user.role !== Role.ADMIN) {
      return res.status(403).json({ success: false, message: 'Admin only' });
    }

    const results = {
      stripe: await checkStripe(),
      email: await checkEmail(),
      twilio: await checkTwilio(),
    };

    res.json({ success: true, data: results });
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

async function checkTwilio(): Promise<{ status: string; message?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!sid || !token || !from) {
    return { status: 'not_configured', message: 'Twilio credentials not fully set' };
  }

  try {
    const twilio = (await import('twilio')).default;
    const client = twilio(sid, token);

    // Fetch account info to verify credentials
    const account = await client.api.accounts(sid).fetch();
    return {
      status: 'connected',
      message: `Account: ${account.friendlyName} | From: ${from}`,
    };
  } catch (err: any) {
    return {
      status: 'error',
      message: err.message || 'Twilio connection failed',
    };
  }
}

export default router;
