import { config } from '../config';

/**
 * SMS sending service via Twilio.
 *
 * In development mode, messages are logged to console.
 * In production, sends via Twilio API.
 *
 * Estimated cost: ~$0.0079/message, ~$10-15/month for 100 members.
 */

interface SmsOptions {
  to: string;
  body: string;
}

/**
 * Send an SMS. In development, logs to console.
 */
export async function sendSms(options: SmsOptions): Promise<boolean> {
  const { to, body } = options;

  // Normalize phone number (ensure +1 prefix for US)
  const normalizedPhone = normalizePhone(to);
  if (!normalizedPhone) {
    console.warn(`Invalid phone number: ${to}`);
    return false;
  }

  if (config.nodeEnv === 'development') {
    console.log('\n📱 [DEV SMS]');
    console.log(`   To: ${normalizedPhone}`);
    console.log(`   Body: ${body}`);
    console.log('');
    return true;
  }

  if (!config.twilio.accountSid || !config.twilio.authToken || !config.twilio.phoneNumber) {
    console.warn('Twilio not configured, skipping SMS');
    return false;
  }

  try {
    // Lazy import so Twilio isn't required in dev
    const twilio = await import('twilio');
    const client = twilio.default(config.twilio.accountSid, config.twilio.authToken);

    const message = await client.messages.create({
      body,
      from: config.twilio.phoneNumber,
      to: normalizedPhone,
    });

    console.log(`SMS sent to ${normalizedPhone}: SID ${message.sid}`);
    return true;
  } catch (error) {
    console.error('Failed to send SMS:', error);
    return false;
  }
}

/**
 * Normalize a phone number to E.164 format (+1XXXXXXXXXX for US).
 */
function normalizePhone(phone: string): string | null {
  // Strip all non-digits
  const digits = phone.replace(/\D/g, '');

  // US phone: 10 digits or 11 starting with 1
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits[0] === '1') {
    return `+${digits}`;
  }
  // Already has country code
  if (digits.length > 10) {
    return `+${digits}`;
  }

  return null;
}
