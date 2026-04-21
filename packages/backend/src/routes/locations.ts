import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();

/**
 * Zip-code → IANA timezone mapping for the US.
 * Uses the first 3 digits (zip prefix) to determine the timezone.
 */
function timezoneFromZip(zip: string): string {
  const prefix = parseInt(zip.substring(0, 3), 10);
  if (isNaN(prefix)) return 'America/Chicago';

  // Eastern
  if (
    (prefix >= 1 && prefix <= 27) ||   // CT, MA, ME, NH, NJ, PR, RI, VT, VI, APO
    (prefix >= 28 && prefix <= 29) ||   // NC, SC
    (prefix >= 30 && prefix <= 31) ||   // GA (partial)
    (prefix >= 32 && prefix <= 34) ||   // FL (Eastern)
    (prefix >= 100 && prefix <= 149) || // NY
    (prefix >= 150 && prefix <= 196) || // PA, DE
    (prefix >= 200 && prefix <= 268) || // DC, MD, VA, WV
    (prefix >= 270 && prefix <= 289) || // NC, SC
    (prefix >= 290 && prefix <= 299) || // SC (partial)
    (prefix >= 300 && prefix <= 319) || // GA
    (prefix >= 320 && prefix <= 349) || // FL
    (prefix >= 430 && prefix <= 459) || // OH
    (prefix >= 460 && prefix <= 479) || // IN (partial)
    (prefix >= 220 && prefix <= 246)    // VA
  ) return 'America/New_York';

  // Central
  if (
    (prefix >= 350 && prefix <= 369) || // AL
    (prefix >= 370 && prefix <= 385) || // TN
    (prefix >= 386 && prefix <= 397) || // MS
    (prefix >= 400 && prefix <= 427) || // KY
    (prefix >= 480 && prefix <= 499) || // MI
    (prefix >= 500 && prefix <= 528) || // IA
    (prefix >= 530 && prefix <= 549) || // WI
    (prefix >= 550 && prefix <= 567) || // MN
    (prefix >= 570 && prefix <= 577) || // SD (partial)
    (prefix >= 580 && prefix <= 588) || // ND (partial)
    (prefix >= 590 && prefix <= 599) || // MT (partial)
    (prefix >= 600 && prefix <= 629) || // IL
    (prefix >= 630 && prefix <= 658) || // MO
    (prefix >= 660 && prefix <= 679) || // KS
    (prefix >= 680 && prefix <= 693) || // NE
    (prefix >= 700 && prefix <= 714) || // LA
    (prefix >= 716 && prefix <= 729) || // AR
    (prefix >= 730 && prefix <= 749) || // OK
    (prefix >= 750 && prefix <= 799) || // TX
    (prefix >= 885 && prefix <= 885)    // TX (El Paso area)
  ) return 'America/Chicago';

  // Mountain
  if (
    (prefix >= 800 && prefix <= 816) || // CO
    (prefix >= 820 && prefix <= 831) || // WY
    (prefix >= 832 && prefix <= 838) || // ID (partial)
    (prefix >= 840 && prefix <= 847) || // UT
    (prefix >= 850 && prefix <= 865) || // AZ
    (prefix >= 870 && prefix <= 884) || // NM
    (prefix >= 590 && prefix <= 599)    // MT
  ) return 'America/Denver';

  // Pacific
  if (
    (prefix >= 889 && prefix <= 898) || // NV
    (prefix >= 900 && prefix <= 966) || // CA, HI
    (prefix >= 970 && prefix <= 979) || // OR
    (prefix >= 980 && prefix <= 994)    // WA
  ) return 'America/Los_Angeles';

  // Alaska
  if (prefix >= 995 && prefix <= 999) return 'America/Anchorage';

  // Hawaii
  if (prefix >= 967 && prefix <= 968) return 'Pacific/Honolulu';

  return 'America/Chicago'; // default fallback
}

/** Helper to safely extract a single string param */
function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

/**
 * GET /api/locations
 * List all active locations (public — needed for registration)
 */
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const locations = await prisma.location.findMany({
      where: { isActive: true },
      include: {
        rooms: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    res.json({ success: true, data: locations });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/locations/timezone-from-zip/:zip
 * Public: look up timezone from US zip code
 * NOTE: Must be defined BEFORE /:id to avoid route conflicts
 */
router.get('/timezone-from-zip/:zip', (req: Request, res: Response) => {
  const zip = param(req, 'zip');
  if (!zip || zip.length < 3) {
    res.json({ success: true, data: { timezone: 'America/Chicago' } });
    return;
  }
  res.json({ success: true, data: { timezone: timezoneFromZip(zip) } });
});

/**
 * GET /api/locations/:id
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const location = await prisma.location.findUnique({
      where: { id },
      include: {
        rooms: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!location) throw ApiError.notFound('Location not found');
    res.json({ success: true, data: location });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/locations
 * Admin-only: create a new location
 * Auto-creates "13+" and "Youth" calendars for the location
 */
router.post('/', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, address, phone, timezone, zip, operatingHours } = req.body;

    if (!name) throw ApiError.badRequest('Location name is required');

    // Auto-detect timezone from zip if not explicitly provided
    const detectedTimezone = zip ? timezoneFromZip(zip) : (timezone || 'America/Chicago');

    const location = await prisma.location.create({
      data: {
        name,
        address,
        phone,
        timezone: detectedTimezone,
        operatingHours,
      },
    });

    // Auto-create "13+" and "Youth" calendars for the new location
    await prisma.room.createMany({
      data: [
        { locationId: location.id, name: '13+', sortOrder: 0 },
        { locationId: location.id, name: 'Youth', sortOrder: 1 },
      ],
    });

    // Re-fetch with rooms included
    const locationWithRooms = await prisma.location.findUnique({
      where: { id: location.id },
      include: {
        rooms: { orderBy: { sortOrder: 'asc' } },
      },
    });

    res.status(201).json({ success: true, data: locationWithRooms });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/locations/:id
 * Admin-only: update a location
 */
router.put('/:id', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const { name, address, phone, timezone, zip, operatingHours, isActive, kioskPin } = req.body;

    // If zip is provided, auto-detect timezone
    const resolvedTimezone = zip ? timezoneFromZip(zip) : timezone;

    const location = await prisma.location.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(address !== undefined && { address }),
        ...(phone !== undefined && { phone }),
        ...(resolvedTimezone !== undefined && { timezone: resolvedTimezone }),
        ...(operatingHours !== undefined && { operatingHours }),
        ...(isActive !== undefined && { isActive }),
        ...(kioskPin !== undefined && { kioskPin: kioskPin || null }),
      },
    });

    res.json({ success: true, data: location });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/locations/:id
 * Admin-only: partial update a location (same as PUT)
 */
router.patch('/:id', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const { name, address, phone, timezone, kioskPin, operatingHours, isActive } = req.body;

    const location = await prisma.location.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(address !== undefined && { address }),
        ...(phone !== undefined && { phone }),
        ...(timezone !== undefined && { timezone }),
        ...(operatingHours !== undefined && { operatingHours }),
        ...(isActive !== undefined && { isActive }),
        ...(kioskPin !== undefined && { kioskPin: kioskPin || null }),
      },
    });

    res.json({ success: true, data: location });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/locations/:id/rooms
 * Admin-only: add a room to a location
 */
router.post('/:id/rooms', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const { name, sortOrder } = req.body;

    if (!name) throw ApiError.badRequest('Room name is required');

    const location = await prisma.location.findUnique({ where: { id } });
    if (!location) throw ApiError.notFound('Location not found');

    const room = await prisma.room.create({
      data: {
        locationId: id,
        name,
        sortOrder: sortOrder || 0,
      },
    });

    res.status(201).json({ success: true, data: room });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/locations/:locationId/clients/:clientId
 * Admin-only: reassign a client's home location
 */
router.put(
  '/:locationId/clients/:clientId',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const locationId = param(req, 'locationId');
      const clientId = param(req, 'clientId');

      const location = await prisma.location.findUnique({ where: { id: locationId } });
      if (!location || !location.isActive) throw ApiError.notFound('Location not found');

      const user = await prisma.user.update({
        where: { id: clientId },
        data: { homeLocationId: locationId },
        include: {
          homeLocation: { select: { id: true, name: true } },
        },
      });

      res.json({
        success: true,
        data: {
          id: user.id,
          fullName: user.fullName,
          homeLocation: user.homeLocation,
        },
        message: `${user.fullName} has been reassigned to ${location.name}`,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
