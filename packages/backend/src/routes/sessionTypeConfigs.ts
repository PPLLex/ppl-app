import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate, requireStaffOrAdmin } from '../middleware/auth';
import { Role, SessionType } from '@prisma/client';

const router = Router();

// Sensible PPL defaults per session type
const SESSION_TYPE_DEFAULTS: Record<string, { label: string; maxCapacity: number; durationMinutes: number; color: string }> = {
  COLLEGE_PITCHING:  { label: 'College Pitching Development Session',  maxCapacity: 8,  durationMinutes: 90,  color: '#10B981' },
  MS_HS_PITCHING:    { label: 'HS/MS Pitching Development Session',    maxCapacity: 8,  durationMinutes: 60,  color: '#3B82F6' },
  YOUTH_PITCHING:    { label: 'Youth Pitching Development Session',    maxCapacity: 10, durationMinutes: 60,  color: '#F59E0B' },
  PRIVATE_LESSON:    { label: 'Private Lesson',                        maxCapacity: 1,  durationMinutes: 60,  color: '#8B5CF6' },
  CAGE_RENTAL:       { label: 'Cage Rental',                           maxCapacity: 2,  durationMinutes: 30,  color: '#6B7280' },
};

/**
 * GET /api/session-type-configs?locationId=
 * Get all session type configs for a location.
 * If no configs exist yet, returns the defaults (without persisting them).
 */
router.get('/', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { locationId } = req.query;
    if (!locationId) throw ApiError.badRequest('locationId is required');

    const configs = await prisma.sessionTypeConfig.findMany({
      where: { locationId: locationId as string },
      orderBy: { sessionType: 'asc' },
    });

    // If no configs exist yet for this location, return defaults
    const allTypes = Object.values(SessionType);
    const existingTypes = new Set(configs.map((c) => c.sessionType));

    const merged = allTypes.map((type) => {
      const existing = configs.find((c) => c.sessionType === type);
      if (existing) return { ...existing, persisted: true };

      const defaults = SESSION_TYPE_DEFAULTS[type] || {
        label: type.replace(/_/g, ' '),
        maxCapacity: 8,
        durationMinutes: 60,
        color: '#6B7280',
      };
      return {
        id: null,
        locationId: locationId as string,
        sessionType: type,
        label: defaults.label,
        maxCapacity: defaults.maxCapacity,
        durationMinutes: defaults.durationMinutes,
        registrationCutoffHours: 2,
        cancellationCutoffHours: 1,
        color: defaults.color,
        isActive: true,
        persisted: false,
      };
    });

    res.json({ success: true, data: merged });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/session-type-configs
 * Admin: upsert all session type configs for a location in one call.
 * Body: { locationId, configs: [{ sessionType, label, maxCapacity, durationMinutes, ... }] }
 */
router.put('/', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    if (user.role !== Role.ADMIN) throw ApiError.forbidden('Only admins can update session type configs');

    const { locationId, configs } = req.body;
    if (!locationId || !configs || !Array.isArray(configs)) {
      throw ApiError.badRequest('locationId and configs array are required');
    }

    const validTypes = Object.values(SessionType);

    const results = [];
    for (const cfg of configs) {
      if (!validTypes.includes(cfg.sessionType)) {
        throw ApiError.badRequest(`Invalid session type: ${cfg.sessionType}`);
      }

      const upserted = await prisma.sessionTypeConfig.upsert({
        where: {
          locationId_sessionType: {
            locationId,
            sessionType: cfg.sessionType,
          },
        },
        update: {
          label: cfg.label,
          maxCapacity: cfg.maxCapacity ?? 8,
          durationMinutes: cfg.durationMinutes ?? 60,
          registrationCutoffHours: cfg.registrationCutoffHours ?? 2,
          cancellationCutoffHours: cfg.cancellationCutoffHours ?? 1,
          color: cfg.color || null,
          isActive: cfg.isActive ?? true,
        },
        create: {
          locationId,
          sessionType: cfg.sessionType,
          label: cfg.label || cfg.sessionType.replace(/_/g, ' '),
          maxCapacity: cfg.maxCapacity ?? 8,
          durationMinutes: cfg.durationMinutes ?? 60,
          registrationCutoffHours: cfg.registrationCutoffHours ?? 2,
          cancellationCutoffHours: cfg.cancellationCutoffHours ?? 1,
          color: cfg.color || null,
          isActive: cfg.isActive ?? true,
        },
      });
      results.push(upserted);
    }

    res.json({
      success: true,
      data: results,
      message: `${results.length} session type config(s) saved`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/session-type-configs/defaults/:sessionType?locationId=
 * Public (authenticated): get defaults for a specific session type at a location.
 * Used when creating a new session — auto-fills capacity, duration, cutoffs.
 */
router.get('/defaults/:sessionType', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { locationId } = req.query;
    const sessionType = req.params.sessionType as SessionType;

    if (!locationId) throw ApiError.badRequest('locationId is required');

    const validTypes = Object.values(SessionType);
    if (!validTypes.includes(sessionType)) {
      throw ApiError.badRequest(`Invalid session type: ${sessionType}`);
    }

    // Try to get persisted config
    const config = await prisma.sessionTypeConfig.findUnique({
      where: {
        locationId_sessionType: {
          locationId: locationId as string,
          sessionType,
        },
      },
    });

    if (config) {
      return res.json({ success: true, data: config });
    }

    // Fall back to built-in defaults
    const defaults = SESSION_TYPE_DEFAULTS[sessionType] || {
      label: sessionType.replace(/_/g, ' '),
      maxCapacity: 8,
      durationMinutes: 60,
      color: '#6B7280',
    };

    res.json({
      success: true,
      data: {
        sessionType,
        locationId,
        label: defaults.label,
        maxCapacity: defaults.maxCapacity,
        durationMinutes: defaults.durationMinutes,
        registrationCutoffHours: 2,
        cancellationCutoffHours: 1,
        color: defaults.color,
        isActive: true,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
