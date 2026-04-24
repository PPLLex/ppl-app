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
 *
 * Deliverability-hardening this does at the code layer:
 *   - From:        "Pitching Performance Lab" <info@pitchingperformancelab.com>
 *                  (a real, monitored mailbox — better than noreply@ for
 *                  Gmail's reputation scoring)
 *   - Reply-To:    info@pitchingperformancelab.com so replies route to a
 *                  human instead of bouncing off a noreply inbox
 *   - envelope.from (return-path) matches the authenticated SMTP user so
 *                  SPF alignment is satisfied when the user is a Google
 *                  Workspace account with SPF configured
 *   - X-PPL-Email  headers identify the email type for debugging without
 *                  leaking PII
 *
 * Sender-side DNS requirements (done outside this code, once, by Chad):
 *   SPF     v=spf1 include:_spf.google.com ~all
 *   DKIM    enable in Google Admin → Apps → Google Workspace → Gmail →
 *           Authenticate email → Generate new record → publish TXT
 *   DMARC   v=DMARC1; p=none; rua=mailto:postmaster@pitchingperformancelab.com
 *           (start with p=none to monitor, tighten to quarantine/reject
 *           after a few weeks of clean DMARC reports)
 *   Google Workspace Send-As alias: add info@pitchingperformancelab.com as
 *   a Send-As in the SMTP-authenticating Gmail account so the From header
 *   is authorized.
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

  const fromHeader =
    process.env.SMTP_FROM ||
    '"Pitching Performance Lab" <info@pitchingperformancelab.com>';
  const replyTo =
    process.env.SMTP_REPLY_TO || 'info@pitchingperformancelab.com';

  // ───────────────────────────────────────────────────────────
  // Primary transport: Resend (when RESEND_API_KEY is set).
  //
  // Benefits over Gmail SMTP:
  //   - No 2,000/day Google Workspace cap
  //   - Dedicated sender reputation + better inbox placement
  //   - Inbound routing (replies → our /api/webhooks/inbound-email)
  //   - Webhook events (delivered, bounced, complained, opened, clicked)
  //
  // Falls back to nodemailer SMTP when RESEND_API_KEY is unset so the
  // migration can happen on Chad's schedule without a big-bang cutover.
  // ───────────────────────────────────────────────────────────
  // Attempt Resend first. If Resend fails (domain not yet verified,
  // API outage, transient error) we FALL THROUGH to the nodemailer
  // SMTP path below rather than swallowing the send. This makes the
  // Resend migration zero-downtime: we can flip RESEND_API_KEY on in
  // Railway even while DNS is still propagating, and every email keeps
  // landing via Gmail SMTP until Resend is green.
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    try {
      const { Resend } = await import('resend');
      const resend = new Resend(resendKey);
      const { error } = await resend.emails.send({
        from: fromHeader,
        to,
        subject,
        text,
        html: html || undefined,
        replyTo,
        headers: {
          'X-PPL-App': 'ppl-app',
          'X-PPL-Env': config.nodeEnv,
        },
      });
      if (!error) {
        console.log(`Email sent via Resend to ${to}: ${subject}`);
        return true;
      }
      console.warn(
        `Resend send failed — falling back to SMTP. Reason: ${JSON.stringify(error)}`
      );
      // fall through to SMTP
    } catch (err) {
      console.warn(
        'Resend transport error — falling back to SMTP:',
        err instanceof Error ? err.message : err
      );
      // fall through to SMTP
    }
  }

  // ───────────────────────────────────────────────────────────
  // Fallback transport: nodemailer + Gmail SMTP (legacy).
  // ───────────────────────────────────────────────────────────
  try {
    const nodemailer = await import('nodemailer');
    const smtpUser = process.env.SMTP_USER;

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: {
        user: smtpUser,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: fromHeader,
      to,
      subject,
      text,
      html: html || undefined,
      replyTo,
      envelope: smtpUser ? { from: smtpUser, to } : undefined,
      headers: {
        'X-PPL-App': 'ppl-app',
        'X-PPL-Env': config.nodeEnv,
      },
    });

    console.log(`Email sent via SMTP to ${to}: ${subject}`);
    return true;
  } catch (error) {
    console.error('SMTP send failed:', error);
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


/**
 * Build a coach invite email for partner schools.
 */
export function buildCoachInviteEmail(
  coachName: string,
  schoolName: string,
  password: string,
  loginUrl: string,
): string {
  return buildPPLEmail('Coach Portal Access', `
    <p style="margin:0 0 16px;color:#CCC;">Hey ${coachName.split(' ')[0]},</p>
    <p style="margin:0 0 16px;color:#CCC;">You've been added as a coach for <strong style="color:#F5F5F5;">${schoolName}</strong> on Pitching Performance Lab's platform.</p>
    <p style="margin:0 0 16px;color:#CCC;">Here are your login credentials:</p>
    <table style="margin:0 0 20px;border-collapse:collapse;">
      <tr><td style="padding:4px 12px 4px 0;color:#888;">Email:</td><td style="color:#F5F5F5;">${coachName}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#888;">Password:</td><td style="color:#F5F5F5;">${password}</td></tr>
    </table>
    <p style="margin:0 0 20px;text-align:center;">
      <a href="${loginUrl}/auth/coach-login" style="display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#5B8C2A,#95C83C);color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">Log In to Coach Portal</a>
    </p>
    <p style="font-size:13px;color:#888;margin:0;">Please change your password after your first login.</p>
  `);
}

/**
 * Returning-athlete review alert.
 *
 * Sent to admins and location coordinators when someone self-selects
 * "I've trained at PPL before" during registration. The idea: staff know
 * immediately, can cross-check Swift records, and decide whether to waive
 * the $300 fee (default) or charge it (if they blatantly lied). The charge
 * action is atomic — only one admin's click can succeed.
 */
export function buildReturningAthleteAlertEmail(data: {
  recipientFirstName: string;
  athleteName: string;
  athleteEmail: string;
  athletePhone: string | null;
  locationName: string;
  reviewUrl: string;
}): string {
  return buildPPLEmail('Returning athlete needs review', `
    <p style="margin:0 0 16px;color:#CCC;">Hey ${data.recipientFirstName},</p>
    <p style="margin:0 0 16px;color:#CCC;">
      A new signup just claimed they're a returning PPL athlete — the $300 onboarding fee
      has been skipped based on their self-report. Please cross-check and decide whether to
      charge the fee anyway.
    </p>
    <div style="background:#1A1A1A;border-radius:8px;padding:16px;margin:0 0 20px;border:1px solid #2A2A2A;">
      <table cellpadding="0" cellspacing="0" style="width:100%;">
        ${detailRow('Name', data.athleteName)}
        ${detailRow('Email', data.athleteEmail)}
        ${data.athletePhone ? detailRow('Phone', data.athletePhone) : ''}
        ${detailRow('Location', data.locationName)}
      </table>
    </div>
    <div style="background:#1A1A1A;border-radius:8px;padding:16px;margin:0 0 20px;border:1px solid #333;border-left:4px solid #E7A23E;">
      <p style="margin:0;color:#CCC;font-size:13px;">
        <strong style="color:#F5F5F5;">Only one admin can charge the fee.</strong>
        Once someone clicks "Charge $300" below, that action is locked — any other admin
        who clicks will see a "already processed" message, so you can't accidentally
        double-charge if several people review the same signup.
      </p>
    </div>
    <p style="margin:0 0 20px;text-align:center;">
      <a href="${data.reviewUrl}" style="${greenBtn}">Review &amp; decide</a>
    </p>
    <p style="font-size:13px;color:#888;margin:0;">
      Not sure? Clicking the button opens the review page in the admin app — it doesn't
      charge anything by itself. You'll see a dedicated button there with a final confirm.
    </p>
  `);
}

/**
 * Email the athlete a "please pay the onboarding fee" link after an admin has
 * decided to charge them. Includes the sign-in + payment link.
 */
export function buildOnboardingFeeRequestEmail(data: {
  athleteFirstName: string;
  loginUrl: string;
  note?: string | null;
}): string {
  return buildPPLEmail('One quick thing before we get started', `
    <p style="margin:0 0 16px;color:#CCC;">Hey ${data.athleteFirstName},</p>
    <p style="margin:0 0 16px;color:#CCC;">
      Welcome to PPL. We need to collect the one-time $300 onboarding fee before your
      account is fully activated. This is a one-time charge — you won't see it again.
    </p>
    ${data.note ? `<p style="margin:0 0 16px;color:#AAA;font-style:italic;">${data.note}</p>` : ''}
    <p style="margin:0 0 20px;text-align:center;">
      <a href="${data.loginUrl}" style="${greenBtn}">Log in and pay</a>
    </p>
    <p style="font-size:13px;color:#888;margin:0;">
      Questions? Just reply to this email or contact us at info@pitchingperformancelab.com.
    </p>
  `);
}

/**
 * Staff reinstate / welcome notification.
 *
 * Sent when an existing user is (re)added to the staff roster via
 * POST /api/staff/invite's reinstate branch. Different from an invite email —
 * the person already has a working login, so we're just telling them they're
 * back on the team, showing their assigned locations/roles, and nudging them
 * to finish their profile (photo + phone).
 */
export function buildStaffReinstateEmail(data: {
  fullName: string;
  assignments: { locationName: string; roleLabels: string[] }[];
  loginUrl: string;
  profileUrl: string;
  needsPhone: boolean;
  needsAvatar: boolean;
}): string {
  const locationRows = data.assignments
    .map(
      (a) =>
        detailRow(
          a.locationName,
          `<span style="color:#95C83C;">${a.roleLabels.join(', ')}</span>`
        )
    )
    .join('');

  const profileTodos: string[] = [];
  if (data.needsAvatar) profileTodos.push('Add a profile photo');
  if (data.needsPhone) profileTodos.push('Add a phone number');

  const todoBlock = profileTodos.length
    ? `
    <div style="background:#1A1A1A;border-radius:8px;padding:20px;margin:0 0 20px;border:1px solid #2A2A2A;border-left:4px solid #95C83C;">
      <p style="margin:0 0 12px;color:#F5F5F5;font-weight:600;">A couple of things to wrap up</p>
      ${profileTodos
        .map(
          (t) =>
            `<p style="margin:0 0 6px;color:#CCC;font-size:14px;">&middot; ${t}</p>`
        )
        .join('')}
      <p style="margin:12px 0 0;text-align:center;">
        <a href="${data.profileUrl}" style="${greenBtn}">Finish my profile</a>
      </p>
    </div>`
    : '';

  return buildPPLEmail('Welcome to the PPL staff', `
    <p style="margin:0 0 16px;color:#CCC;font-size:16px;">
      Hey ${data.fullName.split(' ')[0]}, you've been added to the PPL staff roster.
    </p>
    <p style="margin:0 0 16px;color:#CCC;">
      Your existing login still works — no new password or setup needed. Here's what you have access to:
    </p>
    <div style="background:#1A1A1A;border-radius:8px;padding:16px;margin:0 0 20px;border:1px solid #2A2A2A;">
      <table cellpadding="0" cellspacing="0" style="width:100%;">${locationRows}</table>
    </div>
    ${todoBlock}
    <p style="margin:0 0 20px;text-align:center;">
      <a href="${data.loginUrl}" style="${greenBtn}">Open the PPL app</a>
    </p>
    <p style="font-size:13px;color:#888;margin:0;">
      Questions? Just reply to this email.
    </p>
  `);
}

/**
 * Send the staff reinstate/welcome notification.
 * Safe to call multiple times — the email is informational, not a one-shot invite.
 */
export async function sendStaffReinstateEmail(args: {
  to: string;
  fullName: string;
  assignments: { locationName: string; roleLabels: string[] }[];
  frontendUrl: string;
  needsPhone: boolean;
  needsAvatar: boolean;
}): Promise<void> {
  const html = buildStaffReinstateEmail({
    fullName: args.fullName,
    assignments: args.assignments,
    loginUrl: args.frontendUrl,
    profileUrl: `${args.frontendUrl}/profile`,
    needsPhone: args.needsPhone,
    needsAvatar: args.needsAvatar,
  });

  const lines = [
    `Hey ${args.fullName.split(' ')[0]}, you've been added to the PPL staff roster.`,
    '',
    'Your existing login still works. Access:',
    ...args.assignments.map(
      (a) => `  - ${a.locationName}: ${a.roleLabels.join(', ')}`
    ),
    '',
    args.needsAvatar || args.needsPhone
      ? `When you get a sec, finish your profile at ${args.frontendUrl}/profile${
          args.needsAvatar && args.needsPhone
            ? ' — add a profile photo and phone number.'
            : args.needsAvatar
            ? ' — add a profile photo.'
            : ' — add a phone number.'
        }`
      : '',
    '',
    `Open the app: ${args.frontendUrl}`,
  ].filter((l) => l !== '');

  await sendEmail({
    to: args.to,
    subject: 'Welcome to the PPL staff',
    text: lines.join('\n'),
    html,
  });
}

/**
 * Staff invitation email — sent to someone who does NOT yet have a PPL
 * account when an admin clicks "Invite staff." The recipient clicks the
 * link, which lands them on /join/staff/<token> where they set a password
 * and the account is minted.
 */
export function buildStaffInviteEmail(data: {
  fullName: string;
  invitedByName: string | null;
  assignments: { locationName: string; roleLabels: string[] }[];
  acceptUrl: string;
  expiresInDays: number;
}): string {
  const locationRows = data.assignments
    .map((a) =>
      detailRow(
        a.locationName,
        `<span style="color:#95C83C;">${a.roleLabels.join(', ')}</span>`
      )
    )
    .join('');

  const invitedLine = data.invitedByName
    ? `<strong style="color:#F5F5F5;">${data.invitedByName}</strong> at Pitching Performance Lab added you to the staff roster.`
    : `You've been added to the Pitching Performance Lab staff roster.`;

  return buildPPLEmail("You're invited to the PPL staff", `
    <p style="margin:0 0 16px;color:#CCC;font-size:16px;">
      Hey ${data.fullName.split(' ')[0]},
    </p>
    <p style="margin:0 0 16px;color:#CCC;">${invitedLine}</p>
    <p style="margin:0 0 16px;color:#CCC;">Here's what you'll have access to once you accept:</p>
    <div style="background:#1A1A1A;border-radius:8px;padding:16px;margin:0 0 20px;border:1px solid #2A2A2A;">
      <table cellpadding="0" cellspacing="0" style="width:100%;">${locationRows}</table>
    </div>
    <p style="margin:0 0 20px;text-align:center;">
      <a href="${data.acceptUrl}" style="${greenBtn}">Accept & set a password</a>
    </p>
    <p style="font-size:13px;color:#888;margin:0;">
      This invite link expires in ${data.expiresInDays} days. If it expires before you get to it,
      just reply to this email and we'll send a fresh one.
    </p>
  `);
}

/**
 * Send a staff invite email (fresh invite — not a reinstate).
 * Fire-and-forget — callers should .catch() and log, never await the
 * HTTP response path.
 */
export async function sendStaffInviteEmail(args: {
  to: string;
  fullName: string;
  invitedByName: string | null;
  assignments: { locationName: string; roleLabels: string[] }[];
  acceptUrl: string;
  expiresInDays: number;
}): Promise<void> {
  const html = buildStaffInviteEmail({
    fullName: args.fullName,
    invitedByName: args.invitedByName,
    assignments: args.assignments,
    acceptUrl: args.acceptUrl,
    expiresInDays: args.expiresInDays,
  });
  const lines = [
    `Hey ${args.fullName.split(' ')[0]},`,
    '',
    args.invitedByName
      ? `${args.invitedByName} added you to the PPL staff roster.`
      : `You've been added to the PPL staff roster.`,
    '',
    'Access:',
    ...args.assignments.map((a) => `  - ${a.locationName}: ${a.roleLabels.join(', ')}`),
    '',
    `Accept and set a password: ${args.acceptUrl}`,
    `This link expires in ${args.expiresInDays} days.`,
  ];
  await sendEmail({
    to: args.to,
    subject: "You're invited to the PPL staff",
    text: lines.join('\n'),
    html,
  });
}

/**
 * Send a coach invite email (convenience wrapper).
 */
export async function sendCoachInviteEmail(
  email: string,
  fullName: string,
  schoolName: string,
  password: string,
  frontendUrl: string,
): Promise<void> {
  const html = buildCoachInviteEmail(fullName, schoolName, password, frontendUrl);
  await sendEmail({
    to: email,
    subject: `Your PPL Coach Portal Access â ${schoolName}`,
    text: `Hey ${fullName.split(' ')[0]}, you've been added as a coach for ${schoolName} on PPL. Log in at ${frontendUrl}/auth/coach-login with password: ${password}`,
    html,
  });
}

/**
 * Membership status change email (activated, paused, cancelled).
 */
export function buildMembershipStatusEmail(
  memberName: string,
  status: 'ACTIVE' | 'PAUSED' | 'CANCELLED',
  planName: string,
): string {
  const statusMessages: Record<string, { title: string; body: string }> = {
    ACTIVE: {
      title: 'Membership Activated',
      body: `Your <strong style="color:#F5F5F5;">${planName}</strong> membership is now active. You can start booking sessions right away.`,
    },
    PAUSED: {
      title: 'Membership Paused',
      body: `Your <strong style="color:#F5F5F5;">${planName}</strong> membership has been paused. Your credits will be preserved until you resume.`,
    },
    CANCELLED: {
      title: 'Membership Cancelled',
      body: `Your <strong style="color:#F5F5F5;">${planName}</strong> membership has been cancelled. You can still use any remaining credits until they expire.`,
    },
  };

  const msg = statusMessages[status] || statusMessages.ACTIVE;

  return buildPPLEmail(msg.title, `
    <p style="margin:0 0 16px;color:#CCC;">Hey ${memberName.split(' ')[0]},</p>
    <p style="margin:0 0 16px;color:#CCC;">${msg.body}</p>
    <p style="font-size:13px;color:#888;margin:0;">If you have questions, reply to this email or contact us at info@pitchingperformancelab.com.</p>
  `);
}

/**
 * Card update required email (for failed payments).
 */
export function buildCardUpdateEmail(
  memberName: string,
  lastFour: string,
  updateUrl: string,
): string {
  return buildPPLEmail('Update Your Payment Method', `
    <p style="margin:0 0 16px;color:#CCC;">Hey ${memberName.split(' ')[0]},</p>
    <p style="margin:0 0 16px;color:#CCC;">We were unable to process your payment using the card ending in <strong style="color:#F5F5F5;">${lastFour}</strong>. Please update your payment method to avoid any interruption to your training.</p>
    <p style="margin:0 0 20px;text-align:center;">
      <a href="${updateUrl}" style="display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#5B8C2A,#95C83C);color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">Update Payment Method</a>
    </p>
    <p style="font-size:13px;color:#888;margin:0;">If your payment was already resolved, you can ignore this email.</p>
  `);
}
