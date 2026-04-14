import { config } from '../config';

/**
 * Email sending service.
 *
 * For now, uses a simple SMTP approach via nodemailer.
 * Can be swapped for SendGrid, SES, etc. later.
 *
 * In development mode, emails are logged to console instead of sent.
 */

interface EmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Send an email. In development, logs to console.
 * In production, uses configured SMTP/service.
 */
export async function sendEmail(options: EmailOptions): Promise<boolean> {
  const { to, subject, text, html } = options;

  if (config.nodeEnv === 'development') {
    console.log('\n📧 [DEV EMAIL]');
    console.log(`   To: ${to}`);
    console.log(`   Subject: ${subject}`);
    console.log(`   Body: ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`);
    console.log('');
    return true;
  }

  try {
    // Production: use nodemailer with SMTP
    // This is a lazy import so nodemailer isn't required in dev
    const nodemailer = await import('nodemailer');

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || '"Pitching Performance Lab" <noreply@pitchingperformancelab.com>',
      to,
      subject,
      text,
      html: html || undefined,
    });

    console.log(`Email sent to ${to}: ${subject}`);
    return true;
  } catch (error) {
    console.error('Failed to send email:', error);
    return false;
  }
}

// =============================================================================
// Branded Email Templates
// =============================================================================

interface BookingEmailData {
  athleteName: string;
  sessionTitle: string;
  date: string;
  time: string;
  coach?: string;
  room?: string;
  location?: string;
}

interface PaymentEmailData {
  athleteName: string;
  planName: string;
  amount: string;
  status: 'succeeded' | 'failed';
  failureReason?: string;
  creditsRestored?: boolean;
}

interface ReminderEmailData {
  athleteName: string;
  sessionTitle: string;
  date: string;
  time: string;
  coach?: string;
  room?: string;
  hoursUntil: number;
}

const greenBtn = `display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#5B8C2A,#95C83C);color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;`;
const detailRow = (label: string, value: string) =>
  `<tr><td style="padding:6px 0;color:#888;font-size:13px;width:100px;">${label}</td><td style="padding:6px 0;color:#F5F5F5;font-size:14px;">${value}</td></tr>`;

/** Booking confirmation email */
export function buildBookingConfirmationEmail(data: BookingEmailData): string {
  const details = [
    detailRow('Session', data.sessionTitle),
    detailRow('Date', data.date),
    detailRow('Time', data.time),
    data.coach ? detailRow('Coach', data.coach) : '',
    data.room ? detailRow('Room', data.room) : '',
    data.location ? detailRow('Location', data.location) : '',
  ].join('');

  return buildPPLEmail('Session Booked!', `
    <p style="margin:0 0 16px;color:#CCC;">Hey ${data.athleteName.split(' ')[0]}, you're all set!</p>
    <div style="background:#1A1A1A;border-radius:8px;padding:16px;margin:0 0 20px;border:1px solid #2A2A2A;">
      <table cellpadding="0" cellspacing="0" style="width:100%;">${details}</table>
    </div>
    <p style="font-size:13px;color:#888;margin:0;">
      Need to cancel? You can cancel up to the cutoff time from your account.
    </p>
  `);
}

/** Booking cancellation email */
export function buildBookingCancellationEmail(data: BookingEmailData & { creditRestored?: boolean }): string {
  return buildPPLEmail('Session Cancelled', `
    <p style="margin:0 0 16px;color:#CCC;">Hey ${data.athleteName.split(' ')[0]}, your session has been cancelled.</p>
    <div style="background:#1A1A1A;border-radius:8px;padding:16px;margin:0 0 20px;border:1px solid #2A2A2A;">
      <table cellpadding="0" cellspacing="0" style="width:100%;">
        ${detailRow('Session', data.sessionTitle)}
        ${detailRow('Was on', `${data.date} at ${data.time}`)}
      </table>
    </div>
    ${data.creditRestored ? `<p style="color:#95C83C;font-size:14px;margin:0 0 16px;">Your booking credit has been restored to your account.</p>` : ''}
    <p style="font-size:13px;color:#888;margin:0;">
      Want to rebook? Check the schedule for available sessions.
    </p>
  `);
}

/** Session reminder email */
export function buildSessionReminderEmail(data: ReminderEmailData): string {
  return buildPPLEmail('Session Reminder', `
    <p style="margin:0 0 16px;color:#CCC;">Hey ${data.athleteName.split(' ')[0]}, just a reminder — you have a session ${data.hoursUntil <= 1 ? 'in about an hour' : `in ${data.hoursUntil} hours`}!</p>
    <div style="background:#1A1A1A;border-radius:8px;padding:16px;margin:0 0 20px;border:1px solid #2A2A2A;">
      <table cellpadding="0" cellspacing="0" style="width:100%;">
        ${detailRow('Session', data.sessionTitle)}
        ${detailRow('Time', data.time)}
        ${data.coach ? detailRow('Coach', data.coach) : ''}
        ${data.room ? detailRow('Room', data.room) : ''}
      </table>
    </div>
    <p style="font-size:13px;color:#888;margin:0;">See you soon!</p>
  `);
}

/** Payment success email */
export function buildPaymentSuccessEmail(data: PaymentEmailData): string {
  return buildPPLEmail('Payment Received', `
    <p style="margin:0 0 16px;color:#CCC;">Hey ${data.athleteName.split(' ')[0]}, your payment went through!</p>
    <div style="background:#1A1A1A;border-radius:8px;padding:16px;margin:0 0 20px;border:1px solid #2A2A2A;">
      <table cellpadding="0" cellspacing="0" style="width:100%;">
        ${detailRow('Plan', data.planName)}
        ${detailRow('Amount', data.amount)}
        ${detailRow('Status', '<span style="color:#95C83C;">Paid</span>')}
      </table>
    </div>
    ${data.creditsRestored ? `<p style="color:#95C83C;font-size:14px;margin:0 0 16px;">Your weekly credits have been refreshed. Time to book some sessions!</p>` : ''}
  `);
}

/** Payment failed email */
export function buildPaymentFailedEmail(data: PaymentEmailData): string {
  return buildPPLEmail('Payment Failed', `
    <p style="margin:0 0 16px;color:#CCC;">Hey ${data.athleteName.split(' ')[0]}, your payment didn't go through.</p>
    <div style="background:#1A1A1A;border-radius:8px;padding:16px;margin:0 0 20px;border:1px solid #333;border-left:4px solid #E53E3E;">
      <table cellpadding="0" cellspacing="0" style="width:100%;">
        ${detailRow('Plan', data.planName)}
        ${detailRow('Amount', data.amount)}
        ${detailRow('Status', '<span style="color:#E53E3E;">Failed</span>')}
        ${data.failureReason ? detailRow('Reason', data.failureReason) : ''}
      </table>
    </div>
    <p style="color:#E53E3E;font-size:14px;margin:0 0 20px;">
      Your booking credits have been paused until your payment is resolved.
    </p>
    <p style="font-size:13px;color:#888;margin:0;">
      Please update your payment method from your account to continue booking sessions.
    </p>
  `);
}

/** Welcome email for new registrations */
export function buildWelcomeEmail(name: string, locationName: string): string {
  return buildPPLEmail('Welcome to PPL!', `
    <p style="margin:0 0 16px;color:#CCC;font-size:16px;">Hey ${name.split(' ')[0]}, welcome to the Pitching Performance Lab family!</p>
    <p style="margin:0 0 20px;color:#CCC;">You're all set up at <strong style="color:#F5F5F5;">${locationName}</strong>. Here's what to do next:</p>
    <div style="background:#1A1A1A;border-radius:8px;padding:20px;margin:0 0 20px;border:1px solid #2A2A2A;">
      <p style="margin:0 0 12px;color:#F5F5F5;font-weight:600;">Getting Started</p>
      <p style="margin:0 0 8px;color:#CCC;font-size:14px;">1. Choose a membership plan from your dashboard</p>
      <p style="margin:0 0 8px;color:#CCC;font-size:14px;">2. Browse and book your first session</p>
      <p style="margin:0;color:#CCC;font-size:14px;">3. Show up and get to work!</p>
    </div>
    <p style="font-size:13px;color:#888;margin:0;">Questions? Send us a message from your account.</p>
  `);
}

/**
 * Build a simple branded HTML email wrapper.
 */
export function buildPPLEmail(title: string, body: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#0A0A0A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0A0A0A;padding:20px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <!-- Header -->
          <tr>
            <td style="padding:24px 32px;text-align:center;">
              <span style="font-size:24px;font-weight:800;color:#95C83C;">PPL</span>
              <br>
              <span style="font-size:12px;color:#888;letter-spacing:0.05em;">PITCHING PERFORMANCE LAB</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="background-color:#141414;border-radius:12px;padding:32px;border:1px solid #2A2A2A;">
              <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#F5F5F5;">${title}</h1>
              <div style="color:#CCC;font-size:15px;line-height:1.6;">
                ${body}
              </div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;text-align:center;">
              <p style="font-size:12px;color:#666;margin:0;">
                Pitching Performance Lab &middot; pitchingperformancelab.com
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}
