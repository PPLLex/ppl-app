/**
 * Outbound webhook delivery — Phase 2 (#43).
 *
 * Called whenever the workflow trigger emitter runs (workflowEngine.ts).
 * Finds every active Webhook subscribed to the trigger event and POSTs
 * the payload to its URL with an HMAC-SHA256 signature header.
 *
 * Receiver verification:
 *   const expected = crypto
 *     .createHmac('sha256', WEBHOOK_SECRET)
 *     .update(rawRequestBody)
 *     .digest('hex');
 *   if (req.headers['x-ppl-signature'] !== expected) reject();
 *
 * Failures + responses are logged to WebhookDelivery for retry + audit.
 * After 10 consecutive failures we auto-disable the webhook so a dead
 * receiver doesn't keep spamming logs.
 */

import crypto from 'node:crypto';
import { prisma } from '../utils/prisma';
import type { WorkflowTrigger } from '@prisma/client';

const AUTO_DISABLE_AFTER = 10;
const REQUEST_TIMEOUT_MS = 8000;

type ContextType = 'lead' | 'user' | 'booking' | 'athlete';

export function dispatchWebhooks(
  event: WorkflowTrigger,
  contextType: ContextType,
  contextId: string,
  payload?: Record<string, unknown>
): void {
  // Fire-and-forget — never block the calling request.
  void dispatchWebhooksAsync(event, contextType, contextId, payload).catch((err) => {
    console.error(`[webhookDelivery] dispatch ${event} failed:`, err);
  });
}

async function dispatchWebhooksAsync(
  event: WorkflowTrigger,
  contextType: ContextType,
  contextId: string,
  payload?: Record<string, unknown>
): Promise<void> {
  const webhooks = await prisma.webhook.findMany({
    where: {
      organizationId: 'ppl',
      isActive: true,
      events: { has: event },
    },
  });
  if (webhooks.length === 0) return;

  const body = JSON.stringify({
    event,
    contextType,
    contextId,
    payload: payload ?? {},
    sentAt: new Date().toISOString(),
  });

  await Promise.allSettled(webhooks.map((w) => deliverOne(w, event, body)));
}

async function deliverOne(
  webhook: { id: string; url: string; secret: string; consecutiveFailures: number },
  event: string,
  body: string
): Promise<void> {
  const signature = crypto.createHmac('sha256', webhook.secret).update(body).digest('hex');
  let statusCode: number | null = null;
  let responseBody: string | null = null;
  let error: string | null = null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const res = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PPL-Signature': signature,
        'X-PPL-Event': event,
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);
    statusCode = res.status;
    responseBody = (await res.text().catch(() => '')).slice(0, 1000);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const ok = statusCode != null && statusCode >= 200 && statusCode < 300;

  await prisma.webhookDelivery.create({
    data: {
      webhookId: webhook.id,
      event,
      payload: JSON.parse(body),
      statusCode,
      responseBody,
      error,
    },
  });

  // Update webhook stats — succeed resets failure counter, fail increments
  // and auto-disables once we hit AUTO_DISABLE_AFTER.
  if (ok) {
    await prisma.webhook.update({
      where: { id: webhook.id },
      data: { lastSuccessAt: new Date(), consecutiveFailures: 0 },
    });
  } else {
    const next = webhook.consecutiveFailures + 1;
    await prisma.webhook.update({
      where: { id: webhook.id },
      data: {
        consecutiveFailures: next,
        ...(next >= AUTO_DISABLE_AFTER ? { isActive: false } : {}),
      },
    });
  }
}
