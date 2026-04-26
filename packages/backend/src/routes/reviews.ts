/**
 * Review monitoring + AI draft replies — Phase 2 (#28, #40).
 *
 * Endpoints (all admin-only):
 *   GET    /api/reviews                        list captured reviews (filter by ?rating=, ?status=)
 *   GET    /api/reviews/:id                    detail
 *   POST   /api/reviews/:id/draft-reply        ask Claude to draft a reply
 *   PATCH  /api/reviews/:id                    save edited draft / mark published
 *   POST   /api/reviews/poll-now               manual trigger of the poll cron
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate } from '../middleware/auth';
import { requireAnyRole } from '../services/roleService';
import { Role } from '@prisma/client';
import { pollGoogleReviews } from '../services/reviewMonitor';
import { draftReviewReply } from '../services/aiService';

const router = Router();
router.use(
  authenticate,
  requireAnyRole(Role.ADMIN, Role.CONTENT_MARKETING_ADMIN, Role.CONTENT_MARKETING)
);

function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rating, status } = req.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = { organizationId: 'ppl' };
    if (rating) {
      const r = parseInt(rating, 10);
      if (r >= 1 && r <= 5) where.rating = r;
    }
    if (status === 'unpublished') where.publishedReplyAt = null;
    if (status === 'replied') where.publishedReplyAt = { not: null };

    const reviews = await prisma.review.findMany({
      where: where as any,
      orderBy: { publishedAt: 'desc' },
      take: 200,
    });
    res.json({ success: true, data: reviews });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const review = await prisma.review.findUnique({ where: { id: param(req, 'id') } });
    if (!review) throw ApiError.notFound('Review not found');
    res.json({ success: true, data: review });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/reviews/:id/draft-reply
 * Calls Claude to draft a reply matching the review's tone. Saves the
 * draft on the row but does NOT publish to Google — admin must edit +
 * post manually (Google Business Profile API publish is a future iteration).
 */
router.post('/:id/draft-reply', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const review = await prisma.review.findUnique({ where: { id } });
    if (!review) throw ApiError.notFound('Review not found');

    const result = await draftReviewReply({
      reviewerName: review.authorName,
      rating: review.rating,
      reviewText: review.text ?? '',
    });
    if (!result.ok || !result.reply) {
      throw ApiError.badRequest(result.error || 'AI draft failed');
    }

    const updated = await prisma.review.update({
      where: { id },
      data: { draftReply: result.reply },
    });
    res.json({ success: true, data: { id: updated.id, draftReply: updated.draftReply } });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const { draftReply, publishedReply, markPublished } = req.body as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    if (typeof draftReply === 'string') data.draftReply = draftReply;
    if (typeof publishedReply === 'string') data.publishedReply = publishedReply;
    if (markPublished === true) data.publishedReplyAt = new Date();
    const review = await prisma.review.update({ where: { id }, data: data as any });
    res.json({ success: true, data: review });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/reviews/poll-now
 * Manual trigger of the Google Places poll. Cron runs nightly; admins
 * use this for immediate refresh after configuring googlePlaceId.
 */
router.post('/poll-now', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await pollGoogleReviews();
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

export default router;
