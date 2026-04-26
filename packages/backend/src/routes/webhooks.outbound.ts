/**
 * Outbound webhook CRUD — admin-configured "fire-and-forget" subscribers
 * to PPL events. Each webhook receives a signed POST when one of its
 * subscribed events fires.
 *
 * Endpoints (all admin-only):
 *   GET    /api/outbound-webhooks               list
 *   POST   /api/outbound-webhooks               create (auto-generates secret)
 *   GET    /api/outbound-webhooks/:id           detail + recent deliveries
 *   PATCH  /api/outbound-webhooks/:id           update name/url/events/isActive
 *   DELETE /api/outbound-webhooks/:id           delete
 *   POST   /api/outbound-webhooks/:id/rotate    regenerate the signing secret
 *   POST   /api/outbound-webhooks/:id/test      send a synthetic payload now
 */

import crypto from 'node:crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate, requireAdmin } from '../middleware/auth';
import { WorkflowTrigger } from '@prisma/client';

const router = Router();
router.use(authenticate, requireAdmin);

function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

function generateSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const webhooks = await prisma.webhook.findMany({
      where: { organizationId: 'ppl' },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { deliveries: true } },
        createdBy: { select: { id: true, fullName: true } },
      },
    });
    res.json({ success: true, data: webhooks });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, url, events } = req.body as Record<string, unknown>;
    if (!name || typeof name !== 'string') throw ApiError.badRequest('name required');
    if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      throw ApiError.badRequest('url required and must start with http(s)://');
    }
    if (!Array.isArray(events) || events.length === 0) {
      throw ApiError.badRequest('events array required');
    }
    const validEvents = (events as string[]).filter((e) =>
      (Object.values(WorkflowTrigger) as string[]).includes(e)
    );
    if (validEvents.length === 0) {
      throw ApiError.badRequest(
        'No valid event names provided. Use WorkflowTrigger enum values (BOOKING_CREATED, etc).'
      );
    }

    const webhook = await prisma.webhook.create({
      data: {
        organizationId: 'ppl',
        name: name.trim(),
        url,
        secret: generateSecret(),
        events: validEvents,
        createdById: req.user?.userId ?? null,
      },
    });
    res.status(201).json({ success: true, data: webhook });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const webhook = await prisma.webhook.findUnique({
      where: { id: param(req, 'id') },
      include: {
        deliveries: {
          orderBy: { attemptedAt: 'desc' },
          take: 25,
          select: {
            id: true,
            event: true,
            statusCode: true,
            error: true,
            attemptedAt: true,
            responseBody: true,
          },
        },
      },
    });
    if (!webhook) throw ApiError.notFound('Webhook not found');
    res.json({ success: true, data: webhook });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, url, events, isActive } = req.body as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    if (typeof name === 'string') data.name = name.trim();
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) data.url = url;
    if (Array.isArray(events)) {
      data.events = (events as string[]).filter((e) =>
        (Object.values(WorkflowTrigger) as string[]).includes(e)
      );
    }
    if (typeof isActive === 'boolean') {
      data.isActive = isActive;
      // Re-enabling resets the failure counter — admin's saying "I fixed it."
      if (isActive) data.consecutiveFailures = 0;
    }
    const webhook = await prisma.webhook.update({
      where: { id: param(req, 'id') },
      data: data as any,
    });
    res.json({ success: true, data: webhook });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.webhook.delete({ where: { id: param(req, 'id') } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/rotate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const webhook = await prisma.webhook.update({
      where: { id: param(req, 'id') },
      data: { secret: generateSecret() },
    });
    res.json({ success: true, data: { secret: webhook.secret } });
  } catch (err) {
    next(err);
  }
});

/**
 * Synthetic test delivery — admins click "Test" in the UI to verify their
 * receiver works without waiting for a real event. Posts the same shape
 * a real event would, but with payload.test = true so receivers can ignore.
 */
router.post('/:id/test', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const webhook = await prisma.webhook.findUnique({ where: { id: param(req, 'id') } });
    if (!webhook) throw ApiError.notFound('Webhook not found');
    const body = JSON.stringify({
      event: 'TEST_PING',
      contextType: 'test',
      contextId: 'test',
      payload: { test: true, message: 'PPL outbound webhook test ping' },
      sentAt: new Date().toISOString(),
    });
    const signature = crypto.createHmac('sha256', webhook.secret).update(body).digest('hex');
    let statusCode: number | null = null;
    let error: string | null = null;
    try {
      const res2 = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PPL-Signature': signature,
          'X-PPL-Event': 'TEST_PING',
        },
        body,
      });
      statusCode = res2.status;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    await prisma.webhookDelivery.create({
      data: {
        webhookId: webhook.id,
        event: 'TEST_PING',
        payload: JSON.parse(body),
        statusCode,
        error,
      },
    });
    res.json({ success: true, data: { statusCode, error } });
  } catch (err) {
    next(err);
  }
});

export default router;
