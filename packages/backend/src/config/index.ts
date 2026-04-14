import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
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
};

/**
 * Validate required secrets exist in production.
 * Call this at server startup.
 */
export function validateProductionConfig() {
  if (!config.isProduction) return;

  const missing: string[] = [];

  if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
  if (config.jwt.secret === 'dev-secret') missing.push('JWT_SECRET');
  if (!config.stripe.secretKey || config.stripe.secretKey.startsWith('sk_test')) {
    console.warn('⚠️  Using Stripe TEST key in production. Switch to sk_live_ for real payments.');
  }
  if (!config.stripe.webhookSecret || config.stripe.webhookSecret === 'whsec_placeholder') {
    missing.push('STRIPE_WEBHOOK_SECRET');
  }

  if (missing.length > 0) {
    console.error('❌ Missing required production environment variables:');
    missing.forEach((key) => console.error(`   - ${key}`));
    console.error('\nSee .env.production.example for reference.');
    process.exit(1);
  }

  console.log('✅ Production config validated');
}
