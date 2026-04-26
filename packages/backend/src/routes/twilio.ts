/**
 * Twilio webhook handlers — inbound voice + SMS — Phase 2 (#8, #9, #41 prep).
 *
 * Configure these URLs in your Twilio phone number settings:
 *   Voice: POST https://api.pitchingperformancelab.com/api/twilio/voice
 *   SMS:   POST https://api.pitchingperformancelab.com/api/twilio/sms
 *
 * /voice
 *   - When PPL's Twilio number is called, we attempt a brief greeting via
 *     TwiML, then forward to the org's main line (config.twilio.forwardTo
 *     env). If forwarding fails or no answer → text-back is fired
 *     automatically by /voice/status when the call hangs up unanswered.
 *
 * /voice/status
 *   - Twilio posts call status changes here. On no-answer / busy we
 *     fire a text-back to the caller's number with a friendly "sorry I
 *     missed you" + the consult-booking link.
 *
 * /sms
 *   - Inbound SMS is logged to the Conversation table (not yet implemented;
 *     for now we just log to server console + drop a Lead entry if email
 *     unknown). Future: route into the unified inbox (#6).
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { config } from '../config';
import { sendSms } from '../services/smsService';
import { LeadActivityType, LeadSource } from '@prisma/client';

const router = Router();

/**
 * POST /api/twilio/voice
 * Twilio posts here when our number rings. Reply with TwiML that:
 *   - Plays a brief greeting
 *   - Forwards to the configured main number (TWILIO_FORWARD_TO env)
 *   - Falls through to voicemail / text-back if no one answers
 */
router.post('/voice', (req: Request, res: Response) => {
  const forwardTo = process.env.TWILIO_FORWARD_TO;
  // statusCallback fires when the dial leg ends — we use that to detect
  // no-answer + fire the missed-call text-back.
  const statusCallback = `${process.env.PUBLIC_API_URL || 'https://api.pitchingperformancelab.com'}/api/twilio/voice/status`;

  let twiml: string;
  if (forwardTo) {
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Thanks for calling Pitching Performance Lab. Connecting you now.</Say>
  <Dial timeout="20" action="${statusCallback}" method="POST">
    <Number>${forwardTo}</Number>
  </Dial>
</Response>`;
  } else {
    // No forward configured → straight to text-back trigger via Hangup.
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Thanks for calling Pitching Performance Lab. We're not available right now — we'll text you a link to book a quick call. Talk soon.</Say>
  <Hangup/>
</Response>`;
    // Fire text-back immediately since there's no dial leg.
    void fireMissedCallTextBack(req.body.From as string | undefined);
  }

  res.type('text/xml').send(twiml);
});

/**
 * POST /api/twilio/voice/status
 * Twilio posts here when a forwarded call finishes. If the dial result
 * was no-answer / busy / failed, fire the missed-call text-back to the
 * caller's number.
 */
router.post('/voice/status', (req: Request, res: Response) => {
  const dialStatus = req.body.DialCallStatus as string | undefined;
  const from = req.body.From as string | undefined;

  // Only text back if the forwarded call didn't connect.
  if (from && dialStatus && ['no-answer', 'busy', 'failed', 'canceled'].includes(dialStatus)) {
    void fireMissedCallTextBack(from);
  }

  // Twilio expects a 200 with empty TwiML.
  res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response/>`);
});

/**
 * POST /api/twilio/sms
 * Inbound SMS to PPL's Twilio number. For now: log it + create/update
 * a Lead row keyed by phone. Future: route into the unified inbox (#6).
 */
router.post('/sms', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const from = (req.body.From as string | undefined) ?? null;
    const body = (req.body.Body as string | undefined) ?? '';

    if (from) {
      // Look for an existing Lead by phone; if none, create a stub.
      const existing = await prisma.lead.findFirst({
        where: { organizationId: 'ppl', phone: from },
      });
      if (existing) {
        await prisma.leadActivity.create({
          data: {
            leadId: existing.id,
            // SMS_RECEIVED isn't in LeadActivityType yet — use TEXT (existing
            // text-message bucket) until we expand the enum.
            type: LeadActivityType.TEXT,
            content: body.slice(0, 1000),
          },
        });
      } else {
        await prisma.lead.create({
          data: {
            organizationId: 'ppl',
            firstName: 'SMS Lead',
            lastName: from,
            email: `sms+${from.replace(/\D/g, '')}@placeholder.local`,
            phone: from,
            source: LeadSource.OTHER,
            notes: `Inbound SMS: ${body.slice(0, 500)}`,
          },
        });
      }
    }

    // No auto-reply by default — Chad can wire workflow rules to act on
    // SMS_RECEIVED events later. Just ack to Twilio.
    res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response/>`);
  } catch (err) {
    next(err);
  }
});

// ============================================================
// Helpers
// ============================================================

async function fireMissedCallTextBack(callerNumber: string | undefined): Promise<void> {
  if (!callerNumber) return;
  // Don't text our own forwarded number back
  if (callerNumber === process.env.TWILIO_FORWARD_TO) return;

  const consultUrl = `${config.frontendUrl}/consult`;
  const body = `Sorry we missed you! This is Pitching Performance Lab. Reply or book a 15-min call: ${consultUrl}`;
  try {
    await sendSms({ to: callerNumber, body });
    console.log(`[twilio] missed-call text-back sent to ${callerNumber}`);
  } catch (err) {
    console.error('[twilio] missed-call text-back failed:', err);
  }
}

export default router;
