/**
 * Avatar upload routes (#P11).
 *
 *   GET  /api/avatars/health       — public, "is Cloudinary configured?"
 *   POST /api/avatars/sign         — authed, returns signed upload params
 *   POST /api/avatars/confirm      — authed, persists the resulting URL
 *                                    after the frontend uploaded directly
 *                                    to Cloudinary.
 *   DELETE /api/avatars            — authed, clears avatarUrl (no
 *                                    Cloudinary delete — we just unlink).
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate } from '../middleware/auth';
import {
  isCloudinaryReady,
  signAvatarUpload,
  isValidAvatarUrl,
} from '../services/cloudinaryService';
import { createAuditLog } from '../services/auditService';

const router = Router();

router.get('/health', (_req: Request, res: Response) => {
  res.json({ success: true, data: { ready: isCloudinaryReady() } });
});

router.post('/sign', authenticate, (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = signAvatarUpload(req.user!.userId);
    if (!result.ready) {
      throw new ApiError(503, result.reason);
    }
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/confirm',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { secureUrl } = req.body as { secureUrl?: string };
      if (!secureUrl || typeof secureUrl !== 'string') {
        throw ApiError.badRequest('secureUrl is required');
      }
      // Defense in depth: we trust nothing from the client, only URLs that
      // match the public_id pattern we signed for THIS user.
      if (!isValidAvatarUrl(secureUrl, req.user!.userId)) {
        throw ApiError.badRequest('That URL did not match the avatar slot for your account.');
      }
      await prisma.user.update({
        where: { id: req.user!.userId },
        data: { avatarUrl: secureUrl },
      });
      void createAuditLog({
        userId: req.user!.userId,
        action: 'avatar.uploaded',
        resourceType: 'User',
        resourceId: req.user!.userId,
        ipAddress: req.ip,
      });
      res.json({ success: true, data: { avatarUrl: secureUrl } });
    } catch (err) {
      next(err);
    }
  }
);

router.delete('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.user.update({
      where: { id: req.user!.userId },
      data: { avatarUrl: null },
    });
    void createAuditLog({
      userId: req.user!.userId,
      action: 'avatar.removed',
      resourceType: 'User',
      resourceId: req.user!.userId,
      ipAddress: req.ip,
    });
    res.json({ success: true, data: { avatarUrl: null } });
  } catch (err) {
    next(err);
  }
});

export default router;
