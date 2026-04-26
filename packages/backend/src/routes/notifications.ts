import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

/**
 * GET /api/notifications
 * Fetch current user's notifications. Supports ?unread=true filter.
 *
 * In-app read state uses Notification.readAt (NULL = unread). The
 * `status` enum tracks delivery state for outbound channels (PENDING /
 * SENT / FAILED) and is independent — that's why the bell uses readAt.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const unreadOnly = req.query.unread === 'true';
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const where: any = { userId };
    if (unreadOnly) {
      where.readAt = null;
    }

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          link: true,
          metadata: true,
          readAt: true,
          createdAt: true,
        },
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId, readAt: null } }),
    ]);

    res.json({
      success: true,
      data: notifications,
      unreadCount,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Mark a single notification as read. Both POST and PUT supported so
 * the older clients still work — POST is the canonical form going forward.
 */
const markOneRead = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const notifId = param(req, 'id');
    const userId = req.user!.userId;
    await prisma.notification.updateMany({
      where: { id: notifId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};
router.put('/:id/read', markOneRead);
router.post('/:id/read', markOneRead);

// ============================================================
// PUSH TOKEN MANAGEMENT
// ============================================================

/**
 * POST /api/notifications/push-token
 * Register or refresh an FCM push token for the current device.
 */
router.post('/push-token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { token, deviceInfo } = req.body;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ success: false, message: 'Push token is required' });
    }

    // Upsert — if this token exists (even for another user), reassign it
    const existing = await prisma.pushToken.findUnique({ where: { token } });

    if (existing) {
      // Update: reassign to current user, reactivate if deactivated
      await prisma.pushToken.update({
        where: { token },
        data: { userId, isActive: true, deviceInfo: deviceInfo || existing.deviceInfo },
      });
    } else {
      await prisma.pushToken.create({
        data: { userId, token, deviceInfo },
      });
    }

    res.json({ success: true, message: 'Push token registered' });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/notifications/push-token
 * Remove an FCM push token (e.g., on logout).
 */
router.delete('/push-token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.body;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ success: false, message: 'Push token is required' });
    }

    // Soft-deactivate rather than hard delete
    await prisma.pushToken.updateMany({
      where: { token },
      data: { isActive: false },
    });

    res.json({ success: true, message: 'Push token removed' });
  } catch (error) {
    next(error);
  }
});

// ============================================================
// READ / MARK NOTIFICATIONS
// ============================================================

/**
 * Mark all unread notifications as read for current user. Both POST
 * and PUT supported.
 */
const markAllRead = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const result = await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ success: true, data: { marked: result.count } });
  } catch (error) {
    next(error);
  }
};
router.put('/read-all', markAllRead);
router.post('/read-all', markAllRead);

export default router;
