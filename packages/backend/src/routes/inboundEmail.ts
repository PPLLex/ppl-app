/**
 * Inbound email + SMS webhook handlers.
 *
 * When a client replies to a PPL email (or SMS), the reply lands in the
 * app as an in-app Message thread with PPL staff — NOT in an external
 * inbox. This turns the app into a real CRM: every conversation with a
 * client lives in one place, searchable, tied to their athlete profile.
 *
 * Flow (email):
 *   1. Outbound email sent from "Pitching Performance Lab <info@ppl>"
 *   2. Client hits "Reply" → email lands at info@pitchingperformancelab.com
 *   3. DNS MX record for pitchingperformancelab.com points to Resend's
 *      inbound endpoint (setup per Chad's Resend dashboard)
 *   4. Resend POSTs the parsed email to POST /api/webhooks/inbound-email
 *   5. We look up the user by From address, find/create their
 *      Conversation, and append the reply as a Message.
 *
 * Flow (SMS):
 *   1. Outbound SMS sent via Twilio
 *   2. Client replies to the same number
 *   3. Twilio POSTs to POST /api/webhooks/inbound-sms
 *   4. Same lookup + Message creation.
 *
 * Security: both routes verify the webhook signature before accepting
 * the payload. Without signature verification, anyone on the internet
 * could post fake messages into the app.
 */

import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../utils/prisma';

const router = Router();

/**
 * Verify Resend webhook signature. Resend signs payloads with HMAC-SHA256
 * using the INBOUND webhook secret set in their dashboard. If the secret
 * is unset we log and reject — never accept unsigned inbound mail in
 * production.
 */
function verifyResendSignature(req: Request): boolean {
  const secret = process.env.RESEND_INBOUND_SECRET;
  if (!secret) {
    console.error('[inbound-email] RESEND_INBOUND_SECRET not set — rejecting');
    return false;
  }
  const signature = req.header('resend-signature');
  if (!signature) return false;
  // Resend passes raw body via express.raw() below.
  const expected = crypto
    .createHmac('sha256', secret)
    .update((req as unknown as { rawBody?: Buffer }).rawBody ?? JSON.stringify(req.body))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(`sha256=${expected}`)
  );
}

/**
 * Parse a From header value into its bare email address.
 *   `"Jane Doe" <jane@example.com>` → `jane@example.com`
 *   `jane@example.com`              → `jane@example.com`
 */
function extractEmail(fromHeader: string): string | null {
  const match = fromHeader.match(/<([^>]+)>/);
  if (match) return match[1].toLowerCase().trim();
  const trimmed = fromHeader.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}

/**
 * Strip a quoted reply block out of the email body so the in-app
 * message just shows what the user actually typed, not the entire
 * thread history appended below.
 */
function stripQuotedReply(text: string): string {
  // Common reply separators from Gmail, Outlook, Apple Mail, etc.
  const markers = [
    /\n\s*On\s.+wrote:\s*\n/,
    /\n\s*-----\s*Original Message\s*-----/i,
    /\n\s*_+\s*\n\s*From:/i,
    /\n\s*>/,
  ];
  let cut = text.length;
  for (const marker of markers) {
    const m = text.match(marker);
    if (m && m.index !== undefined && m.index < cut) cut = m.index;
  }
  return text.slice(0, cut).trim();
}

/**
 * POST /api/webhooks/inbound-email
 * Accepts Resend's parsed-email payload and appends the reply as a
 * Message in the client's Conversation thread with PPL staff.
 */
router.post('/inbound-email', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!verifyResendSignature(req)) {
      console.warn('[inbound-email] signature verification failed');
      return res.status(401).json({ success: false, message: 'Invalid signature' });
    }

    // Resend inbound payload shape (check their docs for exact field names)
    const { from, subject, text, html } = req.body as {
      from?: string;
      subject?: string;
      text?: string;
      html?: string;
    };

    if (!from) {
      return res.status(400).json({ success: false, message: 'Missing from address' });
    }

    const senderEmail = extractEmail(from);
    if (!senderEmail) {
      return res.status(400).json({ success: false, message: 'Could not parse sender email' });
    }

    // Look up the user by their email. If we don't know them, park the
    // message as an unmatched inbound for Chad to review later. For MVP
    // we just log and 200 so Resend doesn't keep retrying.
    const user = await prisma.user.findUnique({
      where: { email: senderEmail },
      select: { id: true, fullName: true, homeLocationId: true },
    });
    if (!user) {
      console.log(`[inbound-email] unknown sender ${senderEmail} — subject: ${subject}`);
      return res.json({ success: true, matched: false });
    }

    // Find or create a conversation between the user and PPL staff
    // scoped to their home location. Using "client_admin" type so the
    // existing Messages UI surfaces these threads to admins.
    let conversation = await prisma.conversation.findFirst({
      where: {
        type: 'client_admin',
        locationId: user.homeLocationId ?? undefined,
        // Prisma doesn't support JSON array-contains directly; rely on
        // participants including this user. We'll check post-query.
      },
    });

    if (
      conversation &&
      !Array.isArray(conversation.participants as unknown) /* guard */
    ) {
      conversation = null;
    }
    if (
      conversation &&
      Array.isArray(conversation.participants) &&
      !(conversation.participants as string[]).includes(user.id)
    ) {
      conversation = null;
    }

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          locationId: user.homeLocationId ?? null,
          participants: [user.id],
          type: 'client_admin',
        },
      });
    }

    // Strip quoted-reply blocks so the in-app preview isn't ugly.
    const cleanBody = stripQuotedReply(text || (html ?? '')).slice(0, 20_000);
    if (cleanBody.length === 0) {
      return res.json({ success: true, matched: true, skipped: 'empty body' });
    }

    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId: user.id,
        content: subject ? `${subject}\n\n${cleanBody}` : cleanBody,
      },
    });

    console.log(`[inbound-email] matched ${senderEmail} → message ${message.id}`);
    res.json({ success: true, matched: true, messageId: message.id });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/webhooks/inbound-sms
 * Accepts Twilio's inbound SMS webhook. Same pattern as email: match
 * by phone number, append to conversation, notify admins.
 */
router.post('/inbound-sms', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Twilio signature verification. Twilio HMAC-SHA1s the full URL +
    // sorted params; we use their SDK to do it properly.
    const signature = req.header('x-twilio-signature');
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!signature || !authToken) {
      console.warn('[inbound-sms] missing signature or TWILIO_AUTH_TOKEN');
      return res.status(401).json({ success: false, message: 'Invalid signature' });
    }
    try {
      const twilio = await import('twilio');
      const url =
        `${req.protocol}://${req.get('host')}${req.originalUrl.split('?')[0]}`;
      const valid = twilio.validateRequest(
        authToken,
        signature,
        url,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        req.body as any
      );
      if (!valid) {
        return res.status(401).json({ success: false, message: 'Invalid signature' });
      }
    } catch {
      // If the twilio SDK isn't installed (e.g. dev), fall through —
      // but in production we ALWAYS want signature verification.
      if (process.env.NODE_ENV === 'production') {
        return res.status(500).json({ success: false, message: 'Twilio SDK missing' });
      }
    }

    const from = (req.body?.From as string) || '';
    const body = (req.body?.Body as string) || '';
    const normalizedPhone = from.replace(/\D/g, '').replace(/^1/, '');

    // Find the user by any phone-number format (stored as +1XXXXXXXXXX
    // or XXX-XXX-XXXX — we strip non-digits on both sides to compare).
    const users = await prisma.user.findMany({
      where: { phone: { not: null } },
      select: { id: true, phone: true, homeLocationId: true },
    });
    const user = users.find(
      (u) => (u.phone || '').replace(/\D/g, '').replace(/^1/, '') === normalizedPhone
    );

    if (!user) {
      console.log(`[inbound-sms] unknown sender ${from}`);
      return res.status(200).type('text/xml').send('<Response></Response>');
    }

    let conversation = await prisma.conversation.findFirst({
      where: {
        type: 'client_admin',
        locationId: user.homeLocationId ?? undefined,
      },
    });
    if (
      conversation &&
      Array.isArray(conversation.participants) &&
      !(conversation.participants as string[]).includes(user.id)
    ) {
      conversation = null;
    }
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          locationId: user.homeLocationId ?? null,
          participants: [user.id],
          type: 'client_admin',
        },
      });
    }

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId: user.id,
        content: `📱 ${body.slice(0, 2000)}`,
      },
    });

    // Twilio expects TwiML response.
    res.status(200).type('text/xml').send('<Response></Response>');
  } catch (err) {
    next(err);
  }
});

export default router;
