import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();

// Multer — in-memory storage, max 10MB for logos. SVG deliberately
// excluded from the allow-list: SVG is XML and can carry inline
// <script> tags, event handlers (onclick, onload), and foreignObject
// payloads that execute as JS when rendered inline on a trusted domain.
// Raster-only formats are safe. If an SVG logo is needed later, serve
// it with Content-Disposition: attachment so browsers won't execute it.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new ApiError(400, 'Only PNG, JPEG, WebP, and GIF images are allowed'));
    }
  },
});

/**
 * Helper: convert a multer file buffer to a base64 data URI.
 */
function fileToDataUri(file: Express.Multer.File): string {
  const base64 = file.buffer.toString('base64');
  return `data:${file.mimetype};base64,${base64}`;
}

/**
 * Helper: ensure the singleton OrgSettings row exists.
 */
async function getOrCreateSettings() {
  let settings = await prisma.orgSettings.findUnique({ where: { id: 'ppl' } });
  if (!settings) {
    settings = await prisma.orgSettings.create({ data: { id: 'ppl' } });
  }
  return settings;
}

// ============================================================
// ORG BRANDING & SETTINGS
// ============================================================

/**
 * GET /api/settings/branding
 * Public: returns logo, business name, colors, session defaults.
 *
 * Intentionally unauthenticated — branding data is shown on every public
 * page (login, register, join, etc.) so the logo and colors appear before
 * the user has signed in. Write routes (PUT/POST/DELETE) remain admin-only.
 */
router.get('/branding', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const settings = await getOrCreateSettings();
    res.json({ data: settings });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/settings/branding
 * Admin: update branding fields (text/color fields only — logo via separate upload).
 */
router.put('/branding', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      businessName,
      tagline,
      primaryColor,
      accentColor,
      defaultCapacity,
      sessionDurationMinutes,
      registrationCutoffHours,
      cancellationCutoffHours,
      financeWeekStartDay,
      financeWeekResetDay,
      financeWeekResetHour,
      liabilityWaiverText,
      liabilityWaiverVersion,
      googleReviewUrl,
      facebookReviewUrl,
      googlePlaceId,
    } = req.body;

    await getOrCreateSettings(); // ensure row exists

    // Clamp helper for the finance-week fields so a malformed PUT can't
    // leave the DB in a bad state.
    const clamp = (v: unknown, min: number, max: number, fallback: number) => {
      const n = parseInt(String(v));
      if (Number.isNaN(n)) return fallback;
      return Math.max(min, Math.min(max, n));
    };

    // Hex-color validator — accepts #RGB, #RRGGBB, #RRGGBBAA. Rejects
    // anything else so the branding UI can't be poisoned with CSS
    // expressions or other injection payloads. Falls back silently
    // to not-updating the color so a bad POST can't DOS the site.
    const isHexColor = (v: unknown): v is string =>
      typeof v === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v.trim());

    const data: Record<string, unknown> = {};
    if (typeof businessName === 'string') data.businessName = businessName.slice(0, 120);
    if (typeof tagline === 'string') data.tagline = tagline.slice(0, 200);
    if (isHexColor(primaryColor)) data.primaryColor = primaryColor.trim();
    if (isHexColor(accentColor)) data.accentColor = accentColor.trim();
    if (defaultCapacity !== undefined) data.defaultCapacity = parseInt(defaultCapacity) || 8;
    if (sessionDurationMinutes !== undefined) data.sessionDurationMinutes = parseInt(sessionDurationMinutes) || 60;
    if (registrationCutoffHours !== undefined) data.registrationCutoffHours = parseInt(registrationCutoffHours) || 1;
    if (cancellationCutoffHours !== undefined) data.cancellationCutoffHours = parseInt(cancellationCutoffHours) || 6;
    if (financeWeekStartDay !== undefined) data.financeWeekStartDay = clamp(financeWeekStartDay, 1, 7, 1);
    if (financeWeekResetDay !== undefined) data.financeWeekResetDay = clamp(financeWeekResetDay, 1, 7, 1);
    if (financeWeekResetHour !== undefined) data.financeWeekResetHour = clamp(financeWeekResetHour, 0, 23, 5);
    if (liabilityWaiverText !== undefined && typeof liabilityWaiverText === 'string') {
      data.liabilityWaiverText = liabilityWaiverText;
    }
    if (liabilityWaiverVersion !== undefined && typeof liabilityWaiverVersion === 'string') {
      // Enforce a non-empty, trimmed string. Bumping this invalidates
      // existing signatures and forces everyone to re-sign.
      const v = liabilityWaiverVersion.trim();
      if (v.length > 0) data.liabilityWaiverVersion = v;
    }

    // Reputation management URLs — accept https URL strings or null/empty
    // to clear. Validate just enough to reject obvious garbage.
    const isHttpsUrl = (v: unknown): v is string =>
      typeof v === 'string' && /^https?:\/\/.+/i.test(v.trim());
    if (googleReviewUrl !== undefined) {
      data.googleReviewUrl =
        googleReviewUrl === '' || googleReviewUrl === null
          ? null
          : isHttpsUrl(googleReviewUrl)
          ? googleReviewUrl.trim()
          : undefined; // ignore garbage instead of crashing
    }
    if (facebookReviewUrl !== undefined) {
      data.facebookReviewUrl =
        facebookReviewUrl === '' || facebookReviewUrl === null
          ? null
          : isHttpsUrl(facebookReviewUrl)
          ? facebookReviewUrl.trim()
          : undefined;
    }
    if (googlePlaceId !== undefined && typeof googlePlaceId === 'string') {
      const v = googlePlaceId.trim();
      data.googlePlaceId = v.length > 0 ? v : null;
    }

    const settings = await prisma.orgSettings.update({
      where: { id: 'ppl' },
      data,
    });

    res.json({ data: settings });
  } catch (err) {
    next(err);
  }
});

/**
 * Trigger a Vercel rebuild of the frontend. Fire-and-forget — we don't block
 * the admin's response on the hook call. Configure with Railway env var
 * VERCEL_DEPLOY_HOOK_URL. See packages/frontend/scripts/fetch-logo.mjs for
 * the prebuild step that pulls the latest logo into public/ppl-logo.webp.
 */
async function triggerFrontendRebuild(reason: string): Promise<void> {
  const url = process.env.VERCEL_DEPLOY_HOOK_URL;
  if (!url) {
    console.log(`[logo-sync] no VERCEL_DEPLOY_HOOK_URL set; skipping rebuild (${reason})`);
    return;
  }
  try {
    const res = await fetch(url, { method: 'POST' });
    const body = await res.text();
    console.log(`[logo-sync] Vercel redeploy triggered (${reason}): ${body.slice(0, 200)}`);
  } catch (err) {
    console.error(
      `[logo-sync] failed to trigger Vercel redeploy (${reason}):`,
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * POST /api/settings/branding/logo
 * Admin: upload a logo image. Stores as base64 data URI in DB and fires a
 * Vercel rebuild so the static /ppl-logo.webp asset gets refreshed from the
 * new image. Frontend's prebuild script reads the new logo from this API.
 */
router.post(
  '/branding/logo',
  authenticate,
  requireAdmin,
  upload.single('logo'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) throw new ApiError(400, 'No file uploaded');

      await getOrCreateSettings();

      const logoData = fileToDataUri(req.file);

      const settings = await prisma.orgSettings.update({
        where: { id: 'ppl' },
        data: { logoData },
      });

      // Fire-and-forget — the admin gets their response immediately; the
      // frontend rebuild runs in the background and promotes the new logo
      // to the static asset in ~60-90s.
      triggerFrontendRebuild('logo uploaded').catch(() => {});

      res.json({
        data: settings,
        message: 'Logo saved. Frontend will finish updating in about 1-2 minutes.',
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/settings/branding/logo
 * Admin: remove the current logo and rebuild the frontend so the default
 * asset is restored.
 */
router.delete('/branding/logo', authenticate, requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    await getOrCreateSettings();
    const settings = await prisma.orgSettings.update({
      where: { id: 'ppl' },
      data: { logoData: null },
    });
    triggerFrontendRebuild('logo removed').catch(() => {});
    res.json({ data: settings });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// SCHOOL LOGO UPLOAD
// ============================================================

/**
 * POST /api/settings/schools/:id/logo
 * Admin: upload a logo for a partner school. Stores as base64 data URI.
 */
router.post(
  '/schools/:id/logo',
  authenticate,
  requireAdmin,
  upload.single('logo'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!req.file) throw new ApiError(400, 'No file uploaded');

      const school = await prisma.schoolTeam.findUnique({ where: { id } });
      if (!school) throw new ApiError(404, 'School team not found');

      const brandLogoUrl = fileToDataUri(req.file);

      const updated = await prisma.schoolTeam.update({
        where: { id },
        data: { brandLogoUrl },
      });

      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/settings/schools/:id/logo
 * Admin: remove the school logo.
 */
router.delete('/schools/:id/logo', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const school = await prisma.schoolTeam.findUnique({ where: { id } });
    if (!school) throw new ApiError(404, 'School team not found');

    const updated = await prisma.schoolTeam.update({
      where: { id },
      data: { brandLogoUrl: null },
    });

    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
