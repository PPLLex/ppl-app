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
 * Build a branded HTML email wrapper matching the PPL app's visual identity.
 *
 * Pulls colors + fonts directly from the app's globals.css token system:
 *   - Background: #0A0A0A (true black, same as app shell)
 *   - Surface:    #141414 (card surface)
 *   - Border:     #2A2A2A
 *   - Foreground: #F5F5F5 (text)
 *   - Muted:      #888888
 *   - Primary:    #5E9E50 (PPL green)
 *   - Accent:     #95C83C (PPL bright green)
 *
 * Fonts (loaded via @font-face from the deployed frontend):
 *   - Bank Gothic Bold      → display headers (--font-display)
 *   - Transducer Black/Oblique → accent eyebrows (--font-accent)
 *   - Manrope               → body text (--font-sans)
 *
 * Email-client font caveat:
 *   Modern webmail (Gmail web, Apple Mail, Outlook web) pulls @font-face
 *   from your domain. Outlook desktop on Windows + some enterprise gateways
 *   strip @font-face and fall back to: Copperplate Gothic Bold / Impact for
 *   Bank Gothic; Arial Black italic for Transducer; system Manrope-ish
 *   sans-serif for body. Layout reads as PPL either way.
 */
/**
 * Tiny editorial-style date label used in the utility bar above the logo.
 * Example: "APR 24, 2026"
 */
function formatInviteDate(d: Date = new Date()): string {
  return d
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    .toUpperCase();
}

/**
 * Subtle paint-splatter / speckle texture for the email background.
 * Inline URL-encoded SVG so there's no external image fetch — Apple Mail,
 * Gmail web, and iOS Mail render it; Outlook desktop falls back to solid
 * black, which still looks correct.
 *
 * Tile is 400x400 with three layers:
 *   - Dark grey speckles  (#1A1A1A, ~22 dots)
 *   - Slightly lighter elliptical "drips"  (#222, 4 rotated ovals)
 *   - Faint green specks at 15% opacity for brand accent  (~4 dots)
 */
const PAINT_SPLATTER_DATA_URI =
  "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Cg fill='%231A1A1A'%3E%3Ccircle cx='34' cy='52' r='2.4'/%3E%3Ccircle cx='112' cy='28' r='1.8'/%3E%3Ccircle cx='168' cy='84' r='3.2'/%3E%3Ccircle cx='244' cy='48' r='2.1'/%3E%3Ccircle cx='320' cy='72' r='1.6'/%3E%3Ccircle cx='376' cy='36' r='2.8'/%3E%3Ccircle cx='52' cy='148' r='1.4'/%3E%3Ccircle cx='128' cy='176' r='2.6'/%3E%3Ccircle cx='196' cy='132' r='1.8'/%3E%3Ccircle cx='284' cy='168' r='3.4'/%3E%3Ccircle cx='348' cy='124' r='2'/%3E%3Ccircle cx='28' cy='244' r='2.2'/%3E%3Ccircle cx='84' cy='216' r='1.6'/%3E%3Ccircle cx='152' cy='268' r='2.8'/%3E%3Ccircle cx='224' cy='232' r='1.9'/%3E%3Ccircle cx='304' cy='256' r='2.4'/%3E%3Ccircle cx='364' cy='212' r='1.8'/%3E%3Ccircle cx='44' cy='332' r='2.6'/%3E%3Ccircle cx='116' cy='304' r='1.5'/%3E%3Ccircle cx='180' cy='348' r='3'/%3E%3Ccircle cx='256' cy='308' r='2.1'/%3E%3Ccircle cx='332' cy='356' r='1.7'/%3E%3C/g%3E%3Cg fill='%23222'%3E%3Cellipse cx='80' cy='100' rx='6' ry='2' transform='rotate(35 80 100)'/%3E%3Cellipse cx='260' cy='200' rx='8' ry='3' transform='rotate(-25 260 200)'/%3E%3Cellipse cx='380' cy='290' rx='5' ry='2' transform='rotate(60 380 290)'/%3E%3Cellipse cx='148' cy='40' rx='4' ry='1.5' transform='rotate(15 148 40)'/%3E%3C/g%3E%3Cg fill='%2395C83C' opacity='0.15'%3E%3Ccircle cx='208' cy='12' r='0.9'/%3E%3Ccircle cx='376' cy='148' r='1.1'/%3E%3Ccircle cx='80' cy='284' r='0.8'/%3E%3Ccircle cx='304' cy='328' r='1'/%3E%3C/g%3E%3C/svg%3E";

export function buildPPLEmail(
  title: string,
  body: string,
  opts?: { preheader?: string; subLabel?: string; tagline?: string },
): string {
  const preheader = opts?.preheader ?? '';
  // subLabel mirrors the report's "BULLPEN REPORT · 04.16.2026" line under the lockup.
  // Default to the current date in the same format if the caller doesn't supply one.
  const subLabel =
    opts?.subLabel ??
    `Notification \u00B7 ${new Date()
      .toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
      .replace(/\//g, '.')}`;
  // tagline mirrors the report's "#MUSTBESOMETHINGINTHEWATER" line under the athlete name.
  const tagline = opts?.tagline ?? '';
  const baseUrl = config.frontendUrl;
  const logoUrl = `${baseUrl}/ppl-logo.png`;
  // splatter texture removed — pure black to match the report.
  void PAINT_SPLATTER_DATA_URI;
  void formatInviteDate;
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="dark only">
  <meta name="supported-color-schemes" content="dark">
  <title>${title}</title>
  <style>
    @font-face {
      font-family: 'Bank Gothic';
      font-style: normal;
      font-weight: 700;
      font-display: swap;
      src: url('${baseUrl}/fonts/BankGothic-Bold.ttf') format('truetype');
    }
    @font-face {
      font-family: 'Transducer';
      font-style: italic;
      font-weight: 900;
      font-display: swap;
      src: url('${baseUrl}/fonts/Transducer-BlackOblique.otf') format('opentype');
    }
    @font-face {
      font-family: 'Transducer';
      font-style: normal;
      font-weight: 900;
      font-display: swap;
      src: url('${baseUrl}/fonts/Transducer-Black.otf') format('opentype');
    }
    @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Bebas+Neue&display=swap');
    @media (max-width: 640px) {
      .ppl-stack { padding: 32px 22px 36px !important; }
      .ppl-hero { font-size: 38px !important; letter-spacing: 0.02em !important; }
      .ppl-lockup { font-size: 14px !important; letter-spacing: 0.18em !important; }
      .ppl-sublabel { font-size: 9px !important; letter-spacing: 0.28em !important; }
      .ppl-logo { width: 48px !important; height: 48px !important; }
      .ppl-tagline { font-size: 10px !important; letter-spacing: 0.22em !important; }
      .ppl-body { font-size: 14.5px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#0A0A0A;font-family:'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#F5F5F5;-webkit-font-smoothing:antialiased;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${preheader}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0A;">
    <tr>
      <td align="center" class="ppl-stack" style="padding:48px 32px 44px;">
        <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;">

          <!-- ============================================================
               HEADER: logo + Bank Gothic lockup + sub-label
               Mirrors the Bullpen Report's top bar.
               ============================================================ -->
          <tr>
            <td style="padding:0 0 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td valign="middle" style="padding:0 18px 0 0;width:64px;">
                    <img class="ppl-logo" src="${logoUrl}" alt="PPL" width="56" height="56" style="display:block;border:0;outline:none;text-decoration:none;">
                  </td>
                  <td valign="middle" style="border-left:1px solid #2A2A2A;padding:4px 0 4px 18px;">
                    <p class="ppl-lockup" style="margin:0 0 6px;font-family:'Bank Gothic','Copperplate Gothic Bold',Impact,sans-serif;font-weight:700;font-size:18px;line-height:1;letter-spacing:0.18em;text-transform:uppercase;color:#F5F5F5;">Pitching Performance Lab</p>
                    <p class="ppl-sublabel" style="margin:0;font-family:'Transducer','Arial Black',Helvetica,Arial,sans-serif;font-style:italic;font-weight:900;font-size:10px;line-height:1;letter-spacing:0.34em;text-transform:uppercase;color:#888888;">${subLabel}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ============================================================
               HERO: huge green title (= report's "COLIN MURPHY")
               + optional Transducer italic tagline (= report's hashtag line)
               ============================================================ -->
          <tr>
            <td style="padding:8px 0 ${tagline ? '6px' : '36px'};">
              <p class="ppl-hero" style="margin:0;font-family:'Bebas Neue','Oswald',Impact,sans-serif;font-size:54px;line-height:1;font-weight:400;letter-spacing:0.03em;text-transform:uppercase;color:#95C83C;">${title}</p>
            </td>
          </tr>
          ${
            tagline
              ? `
          <tr>
            <td style="padding:0 0 36px;">
              <p class="ppl-tagline" style="margin:0;font-family:'Transducer','Arial Black',Helvetica,Arial,sans-serif;font-style:italic;font-weight:900;font-size:11px;line-height:1.3;letter-spacing:0.22em;text-transform:uppercase;color:#888888;">${tagline}</p>
            </td>
          </tr>`
              : ''
          }

          <!-- Top divider bar — single hairline that mirrors the report's section rules -->
          <tr>
            <td style="padding:0 0 28px;">
              <div style="height:1px;background:#2A2A2A;line-height:1px;font-size:0;">&nbsp;</div>
            </td>
          </tr>

          <!-- ============================================================
               BODY
               ============================================================ -->
          <tr>
            <td class="ppl-body" style="padding:0 0 36px;color:#CCCCCC;font-size:15px;line-height:1.7;">
              ${body}
            </td>
          </tr>

          <!-- ============================================================
               FOOTER — matches the report's bottom bar
               ============================================================ -->
          <tr>
            <td style="padding:24px 0 0;border-top:1px solid #1F1F1F;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td valign="middle" style="font-family:'Transducer','Arial Black',Helvetica,Arial,sans-serif;font-style:italic;font-weight:900;font-size:10px;letter-spacing:0.28em;text-transform:uppercase;color:#888888;">Pitching Performance Lab</td>
                  <td valign="middle" align="right" style="font-size:11px;color:#666666;">
                    <a href="https://pitchingperformancelab.com" style="color:#888888;text-decoration:none;">pitchingperformancelab.com</a>
                    &nbsp;&middot;&nbsp;
                    <a href="mailto:support@pitchingperformancelab.com" style="color:#888888;text-decoration:none;">support@pitchingperformancelab.com</a>
                  </td>
                </tr>
              </table>
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
 * Section header that matches the report's "▼ NOTES FROM COACH STAFF" /
 * "● PITCH ARSENAL · LATEST SESSION" rules — green pill marker on the left,
 * Transducer Black Italic ALL-CAPS title, optional right-aligned meta.
 *
 * Available to any email that wants to keep section structure on-brand with
 * the bullpen report.
 */
export function pplSectionHeader(label: string, meta?: string): string {
  const metaCell = meta
    ? `<td valign="middle" align="right" style="font-family:'Transducer','Arial Black',Helvetica,Arial,sans-serif;font-style:italic;font-weight:900;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#666666;white-space:nowrap;padding-left:12px;">${meta}</td>`
    : '';
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;">
      <tr>
        <td valign="middle" style="width:14px;padding:0 10px 0 0;">
          <div style="width:8px;height:8px;background:#95C83C;border-radius:2px;"></div>
        </td>
        <td valign="middle" style="font-family:'Transducer','Arial Black',Helvetica,Arial,sans-serif;font-style:italic;font-weight:900;font-size:11px;letter-spacing:0.26em;text-transform:uppercase;color:#F5F5F5;">${label}</td>
        ${metaCell}
      </tr>
    </table>`;
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

// ============================================================================
// ROLE-SPECIFIC INVITE EMAILS
// ----------------------------------------------------------------------------
// Each of the 10 invitable roles gets a tailored welcome email explaining
// exactly what they can do in the app. The generic `buildStaffInviteEmail`
// above is kept for backward compat with the legacy STAFF+LocationRole flow;
// new invites flowing through the UserRole model should use the dispatcher
// `buildInviteEmailByRole(role, data)` below.
//
// Subject line is also role-specific so the recipient's inbox makes it
// obvious what's in the envelope before they open it.
// ============================================================================

/** Short role label for subject lines / badges. */
export function roleDisplayName(role: string): string {
  switch (role) {
    case 'ADMIN':                   return 'Admin';
    case 'COORDINATOR':             return 'Coordinator';
    case 'PERFORMANCE_COACH':       return 'Performance Coach';
    case 'CONTENT_MARKETING_ADMIN': return 'Content & Marketing Admin';
    case 'CONTENT_MARKETING':       return 'Content & Marketing';
    case 'MEDICAL_ADMIN':           return 'Medical Admin';
    case 'MEDICAL':                 return 'Medical';
    case 'PARTNERSHIP_COACH':       return 'Partnership Coach';
    case 'OUTSIDE_COACH':           return 'Outside Coach';
    case 'PARENT':                  return 'Parent / Guardian';
    case 'ATHLETE':                 return 'Athlete';
    default:                        return role;
  }
}

/** 2-3 bullet points describing what each role can do — used in invite body. */
function roleResponsibilities(role: string): string[] {
  switch (role) {
    case 'ADMIN':
      return [
        'Full access across every PPL location',
        'Manage staff, plans, billing, and org settings',
        'View revenue and reports for all locations',
      ];
    case 'COORDINATOR':
      return [
        'Full access at your assigned location',
        'Manage athletes, sessions, coaches, and the schedule',
        'Run check-in, review coach notes, handle billing exceptions',
      ];
    case 'PERFORMANCE_COACH':
      return [
        'View the calendar and athlete dashboard at your location',
        'Write coach notes, goals, and programs for athletes',
        'Mark sessions as completed and review reports',
      ];
    case 'CONTENT_MARKETING_ADMIN':
      return [
        'Oversee social media and marketing across every PPL location',
        'Send marketing email blasts to members',
        'View schedule data to coordinate content timing',
      ];
    case 'CONTENT_MARKETING':
      return [
        'Access your location\u2019s schedule and marketing tools',
        'Post to social media and prepare marketing content',
        'Coordinate with the broader Content & Marketing team',
      ];
    case 'MEDICAL_ADMIN':
      return [
        'See the screening schedule and mark athletes present',
        'View weekly screening revenue broken out per location',
        'Make programming changes and reports for your screenings',
      ];
    case 'MEDICAL':
      return [
        'See the screening schedule and mark athletes present',
        'Make programming changes and reports for your screenings',
        'Focus on screenings \u2014 no revenue visibility',
      ];
    case 'PARTNERSHIP_COACH':
      return [
        'View and manage your partner school\u2019s PPL roster',
        'Sign your athletes up for in-person training at PPL',
        'Stay in sync with the PPL team supporting your players',
      ];
    case 'OUTSIDE_COACH':
      return [
        'View your athlete\u2019s notes, metrics, and reports',
        'Message the PPL coaching team about your player',
        'Read-only access \u2014 no booking or scheduling',
      ];
    case 'PARENT':
      return [
        'Book and manage sessions for your athlete(s)',
        'Handle payments and view educational resources',
        'Message the PPL team any time',
      ];
    case 'ATHLETE':
      return [
        'Your own dashboard, program, and training goals',
        'Access educational resources built by PPL coaches',
        'See your session history and progress over time',
      ];
    default:
      return ['Access granted to the Pitching Performance Lab app'];
  }
}

type RoleInviteData = {
  fullName: string;
  invitedByName: string | null;
  role: string;
  // For location-scoped roles.
  locationName?: string | null;
  // For Partnership Coach.
  schoolName?: string | null;
  acceptUrl: string;
  expiresInDays: number;
};

/**
 * Dispatch: build the correct HTML body for the given role.
 *
 * Body design — matches Chad's daily-overview email components:
 *   - Greeting paragraph
 *   - "Role" info card with green left-accent (status-card pattern from
 *     daily emails — gives the role + scope visual emphasis at a glance)
 *   - Section header with Bank Gothic Bold + small green underline
 *   - Bulleted responsibilities, no list-bullet markers (custom green dots
 *     for the modern look)
 *   - Centered, full-width gradient CTA button
 *   - Quiet expiry note in muted tone
 */
export function buildInviteEmailByRole(data: RoleInviteData): string {
  const firstName = data.fullName.split(' ')[0];
  const roleLabel = roleDisplayName(data.role);
  const responsibilities = roleResponsibilities(data.role);

  // Scope label that gets baked into the report-style tagline beneath the recipient's name.
  const scopeLabel = data.locationName
    ? data.locationName.toUpperCase()
    : data.schoolName
    ? data.schoolName.toUpperCase()
    : data.role === 'ADMIN' || data.role === 'CONTENT_MARKETING_ADMIN' || data.role === 'MEDICAL_ADMIN'
    ? 'GLOBAL ACCESS'
    : 'ALL LOCATIONS';

  // The hashtag-style tagline that mirrors "#MUSTBESOMETHINGINTHEWATER".
  const tagline = `${roleLabel.toUpperCase()} \u00B7 ${scopeLabel}`;

  // Section header for the from-line / what-you'll-do / how-to-accept blocks.
  const sectionHeader = (label: string, meta?: string) => pplSectionHeader(label, meta);

  // Bullets for the responsibilities list — small green dots, like the
  // colored pitch dots in the report's pitch-arsenal table.
  const responsibilitiesHtml = responsibilities
    .map(
      (r) => `
      <tr>
        <td valign="top" style="padding:7px 14px 7px 0;width:18px;">
          <div style="width:6px;height:6px;background:#95C83C;border-radius:50%;margin-top:8px;"></div>
        </td>
        <td valign="top" style="padding:7px 0;color:#CCCCCC;font-size:14.5px;line-height:1.6;">${r}</td>
      </tr>`,
    )
    .join('');

  const showResponsibilities =
    data.role !== 'PERFORMANCE_COACH' && data.role !== 'COORDINATOR';

  const inviterIntro = data.invitedByName
    ? `<strong style="color:#F5F5F5;">${data.invitedByName}</strong> added you to the team. Welcome aboard.`
    : `You\u2019ve been added to the team. Welcome aboard.`;

  const fromLabel = data.invitedByName
    ? `From ${data.invitedByName}`
    : 'Welcome';

  // Date for the section meta, formatted MM/DD/YYYY like the report.
  const todayMeta = new Date()
    .toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
    .replace(/\//g, '/');

  const body = `
    <!-- ▼ FROM SECTION — matches the report's "▼ NOTES FROM COACH STAFF" rule -->
    ${sectionHeader(fromLabel, todayMeta)}
    <p style="margin:0 0 14px;color:#F5F5F5;font-size:16px;line-height:1.6;">Hey ${firstName},</p>
    <p style="margin:0 0 32px;color:#CCCCCC;font-size:15px;line-height:1.7;">${inviterIntro}</p>

    ${
      showResponsibilities
        ? `
    <!-- ▼ WHAT YOU'LL DO — matches the report's "● PITCH ARSENAL · LATEST SESSION" pattern -->
    ${sectionHeader("What You'll Do", `${responsibilities.length} things`)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
      ${responsibilitiesHtml}
    </table>`
        : ''
    }

    <!-- ▼ HOW TO ACCEPT — final actionable section -->
    ${sectionHeader('How to Accept')}
    <p style="margin:0 0 22px;color:#CCCCCC;font-size:15px;line-height:1.7;">Click the button below to set your password and finish setup. The link is single-use and tied to your email address.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;">
      <tr>
        <td align="center">
          <a href="${data.acceptUrl}" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#5E9E50 0%,#95C83C 100%);color:#0A0A0A;text-decoration:none;border-radius:10px;font-family:'Transducer','Arial Black',Helvetica,Arial,sans-serif;font-style:italic;font-weight:900;font-size:13px;letter-spacing:0.16em;text-transform:uppercase;">Accept &amp; Set Your Password</a>
        </td>
      </tr>
    </table>

    <p style="font-size:13px;color:#888888;margin:0;line-height:1.6;text-align:center;">
      This invite expires in <strong style="color:#F5F5F5;text-decoration:underline;">${data.expiresInDays} days</strong>. If it lapses, reply and we&rsquo;ll send a fresh one.
    </p>
  `;

  return buildPPLEmail(data.fullName.toUpperCase(), body, {
    preheader: `${data.invitedByName ?? 'PPL'} invited you to join Pitching Performance Lab as a ${roleLabel}.`,
    subLabel: `Staff Invitation \u00B7 ${todayMeta.replace(/\//g, '.')}`,
    tagline,
  });
}

/**
 * Send a role-specific invite email. Plain-text fallback mirrors the HTML
 * so recipients without rich email clients (or SMTP stripping) still get the
 * key info.
 */
export async function sendInviteEmailByRole(args: RoleInviteData & { to: string }): Promise<void> {
  const html = buildInviteEmailByRole(args);
  const roleLabel = roleDisplayName(args.role);
  const firstName = args.fullName.split(' ')[0];
  const scopeLineText = args.locationName
    ? `Location: ${args.locationName}`
    : args.schoolName
    ? `Partner school: ${args.schoolName}`
    : 'Global access across all PPL locations';

  const lines = [
    `Hey ${firstName},`,
    '',
    args.invitedByName
      ? `${args.invitedByName} added you to PPL as a ${roleLabel}.`
      : `You've been added to PPL as a ${roleLabel}.`,
    scopeLineText,
    '',
    'Once you accept, you\u2019ll be able to:',
    ...roleResponsibilities(args.role).map((r) => `  - ${r}`),
    '',
    `Accept and set a password: ${args.acceptUrl}`,
    `This link expires in ${args.expiresInDays} days.`,
  ];

  await sendEmail({
    to: args.to,
    subject: `You\u2019re invited to PPL as a ${roleLabel}`,
    text: lines.join('\n'),
    html,
  });
}
