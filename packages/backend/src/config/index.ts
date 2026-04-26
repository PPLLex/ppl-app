import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret',
    // Short-lived access JWT (#S9). The 14-day refresh token issued
    // alongside login lets the frontend silently re-mint these without
    // the user noticing. JWT_EXPIRES_IN env var can override (e.g. for
    // load-testing or local debugging).
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  },

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
  },

  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '"Pitching Performance Lab" <noreply@pitchingperformancelab.com>',
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
  },

  apple: {
    clientId: process.env.APPLE_CLIENT_ID || '',
    teamId: process.env.APPLE_TEAM_ID || '',
    keyId: process.env.APPLE_KEY_ID || '',
    privateKey: (process.env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  },

  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  },
};

/**
 * Validate required secrets exist in production.
 * Call this at server startup.
 */
export function validateProductionConfig() {
  if (!config.isProduction) return;

  const critical: string[] = [];
  const warnings: string[] = [];

  if (!process.env.DATABASE_URL) critical.push('DATABASE_URL');
  if (config.jwt.secret === 'dev-secret') critical.push('JWT_SECRET');

  if (!config.stripe.secretKey || config.stripe.secretKey.startsWith('sk_test')) {
    warnings.push('Using Stripe TEST key in production.');
  }
  if (!config.stripe.webhookSecret || config.stripe.webhookSecret === 'whsec_placeholder') {
    warnings.push('STRIPE_WEBHOOK_SECRET is missing or placeholder.');
  }
  if (!config.twilio.accountSid || !config.twilio.authToken) {
    warnings.push('Twilio credentials missing.');
  }
  if (!config.smtp.user || !config.smtp.pass) {
    warnings.push('SMTP credentials missing.');
  }
  if (!config.firebase.projectId || !config.firebase.clientEmail || !config.firebase.privateKey) {
    warnings.push('Firebase credentials missing — push notifications disabled.');
  }

  if (warnings.length > 0) {
    console.warn('Production warnings:');
    warnings.forEach((w) => console.warn('   - ' + w));
  }

  if (critical.length > 0) {
    console.error('Missing CRITICAL production environment variables:');
    critical.forEach((key) => console.error('   - ' + key));
    // Use setTimeout to allow stderr to flush before exiting
    setTimeout(() => process.exit(1), 500);
    throw new Error(`Missing critical env vars: ${critical.join(', ')}`);
  }

  console.log('Production config validated');
}
