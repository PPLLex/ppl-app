import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();
router.use(authenticate, requireAdmin);

/**
 * GET /api/audit-logs
 * Admin: view system audit log with filtering.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 30;
    const action = req.query.action as string | undefined;
    const userId = req.query.userId as string | undefined;
    const resourceType = req.query.resourceType as string | undefined;

    const where: any = {};
    if (action) where.action = { contains: action, mode: 'insensitive' };
    if (userId) where.userId = userId;
    if (resourceType) where.resourceType = resourceType;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { id: true, fullName: true, role: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({
      success: true,
      data: logs.map((log: any) => ({
        id: log.id,
        action: log.action,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        changes: log.changes,
        userName: log.user?.fullName || 'System',
        userRole: log.user?.role || null,
        createdAt: log.createdAt,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
