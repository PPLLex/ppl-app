/**
 * Swift CSV importer — Phase 2 launch unblocker.
 *
 * Parses CSV exports from Swift (the prior scheduling system) and creates
 * matching Users + AthleteProfile + ClientMembership rows in PPL App.
 * Idempotent: keyed by email — re-running the same CSV updates rather
 * than dupes.
 *
 * Endpoints:
 *   POST /api/admin/swift-import/preview   dry-run, returns counts + samples
 *   POST /api/admin/swift-import/commit    actually writes to DB
 *
 * Both expect multipart/form-data with a single 'file' field (CSV).
 *
 * Required CSV columns (case-insensitive, flexible naming):
 *   email           — required, used as upsert key
 *   name OR (firstName + lastName)
 *   phone           — optional
 *   plan            — optional, plan name (matches MembershipPlan.name)
 *   ageGroup        — optional ('youth' | 'ms_hs' | 'college' | 'pro')
 *   location        — optional, location name (matches Location.name)
 *   status          — optional ('active' | 'past_due' | 'cancelled')
 */

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate, requireAdmin } from '../middleware/auth';
import { Role, MembershipStatus } from '@prisma/client';

const router = Router();
router.use(authenticate, requireAdmin);

// Multer in-memory; cap at 20MB which is more than enough for any
// reasonable Swift export.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// ============================================================
// Routes
// ============================================================

router.post('/preview', upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const file = req.file;
    if (!file) throw ApiError.badRequest('No file uploaded');
    const result = await processCsv(file.buffer, { dryRun: true });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post('/commit', upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const file = req.file;
    if (!file) throw ApiError.badRequest('No file uploaded');
    const result = await processCsv(file.buffer, { dryRun: false });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// CSV processing
// ============================================================

type ImportRow = {
  email: string;
  fullName: string;
  phone?: string | null;
  planName?: string | null;
  ageGroup?: string | null;
  locationName?: string | null;
  status?: string | null;
  raw: Record<string, string>;
};

type ProcessResult = {
  total: number;
  parsed: number;
  errors: Array<{ row: number; reason: string; raw: Record<string, string> }>;
  preview: ImportRow[]; // first 5 rows for UI preview
  willCreate: number;
  willUpdate: number;
  membershipsCreated: number;
  ageGroupsAssigned: number;
  // For commit only
  created?: number;
  updated?: number;
  skipped?: number;
};

async function processCsv(buffer: Buffer, opts: { dryRun: boolean }): Promise<ProcessResult> {
  const text = buffer.toString('utf-8');
  const rows = parseCsv(text);
  if (rows.length === 0) throw ApiError.badRequest('CSV appears empty');
  const headers = rows[0].map((h) => h.toLowerCase().trim());
  const dataRows = rows.slice(1).filter((r) => r.some((cell) => cell.trim() !== ''));

  // Resolve common column-name aliases → canonical keys
  const resolve = (...aliases: string[]): number => {
    for (const a of aliases) {
      const idx = headers.indexOf(a.toLowerCase());
      if (idx !== -1) return idx;
    }
    return -1;
  };
  const colEmail = resolve('email', 'e-mail', 'email_address');
  const colName = resolve('name', 'full_name', 'fullname');
  const colFirstName = resolve('first_name', 'firstname', 'first');
  const colLastName = resolve('last_name', 'lastname', 'last');
  const colPhone = resolve('phone', 'phone_number', 'mobile', 'cell');
  const colPlan = resolve('plan', 'plan_name', 'membership', 'membership_plan');
  const colAgeGroup = resolve('age_group', 'age', 'level', 'playing_level');
  const colLocation = resolve('location', 'home_location', 'gym');
  const colStatus = resolve('status', 'membership_status', 'state');

  if (colEmail === -1) {
    throw ApiError.badRequest('CSV must include an "email" column');
  }
  if (colName === -1 && (colFirstName === -1 || colLastName === -1)) {
    throw ApiError.badRequest('CSV must include either a "name" column OR both "first_name" + "last_name"');
  }

  const errors: ProcessResult['errors'] = [];
  const validRows: ImportRow[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const raw: Record<string, string> = {};
    headers.forEach((h, j) => { raw[h] = (row[j] ?? '').trim(); });

    const email = (row[colEmail] ?? '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push({ row: i + 2, reason: 'Invalid or missing email', raw });
      continue;
    }
    let fullName: string;
    if (colName !== -1 && row[colName]?.trim()) {
      fullName = row[colName].trim();
    } else {
      const fn = (row[colFirstName] ?? '').trim();
      const ln = (row[colLastName] ?? '').trim();
      fullName = `${fn} ${ln}`.trim();
    }
    if (!fullName) {
      errors.push({ row: i + 2, reason: 'Missing name', raw });
      continue;
    }

    validRows.push({
      email,
      fullName,
      phone: colPhone !== -1 ? row[colPhone]?.trim() || null : null,
      planName: colPlan !== -1 ? row[colPlan]?.trim() || null : null,
      ageGroup: colAgeGroup !== -1 ? normalizeAgeGroup(row[colAgeGroup]) : null,
      locationName: colLocation !== -1 ? row[colLocation]?.trim() || null : null,
      status: colStatus !== -1 ? row[colStatus]?.trim().toLowerCase() || null : null,
      raw,
    });
  }

  // Categorize: who's already in the DB?
  const existing = await prisma.user.findMany({
    where: { email: { in: validRows.map((r) => r.email) } },
    select: { id: true, email: true },
  });
  const existingByEmail = new Map(existing.map((u) => [u.email.toLowerCase(), u.id]));

  let willCreate = 0;
  let willUpdate = 0;
  let membershipsCreated = 0;
  let ageGroupsAssigned = 0;
  for (const r of validRows) {
    if (existingByEmail.has(r.email)) willUpdate++;
    else willCreate++;
    if (r.planName) membershipsCreated++;
    if (r.ageGroup) ageGroupsAssigned++;
  }

  if (opts.dryRun) {
    return {
      total: dataRows.length,
      parsed: validRows.length,
      errors,
      preview: validRows.slice(0, 5),
      willCreate,
      willUpdate,
      membershipsCreated,
      ageGroupsAssigned,
    };
  }

  // ============================================================
  // COMMIT — actually write to the DB
  // ============================================================
  // Pre-fetch lookups so we don't query inside the per-row loop.
  const allLocations = await prisma.location.findMany({ select: { id: true, name: true } });
  const locByName = new Map(allLocations.map((l) => [l.name.toLowerCase(), l.id]));
  const allPlans = await prisma.membershipPlan.findMany({ select: { id: true, name: true, locationId: true } });

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const r of validRows) {
    try {
      const locationId = r.locationName ? locByName.get(r.locationName.toLowerCase()) ?? null : null;

      const existingId = existingByEmail.get(r.email);
      let userId: string;
      if (existingId) {
        // Idempotent update — never overwrite passwords or roles
        await prisma.user.update({
          where: { id: existingId },
          data: {
            fullName: r.fullName,
            phone: r.phone ?? undefined,
            ...(locationId ? { homeLocationId: locationId } : {}),
          },
        });
        userId = existingId;
        updated++;
      } else {
        // Create with a random password — they'll reset on first login
        const placeholder = randomBytes(16).toString('hex');
        const passwordHash = await bcrypt.hash(placeholder, 10);
        const newUser = await prisma.user.create({
          data: {
            email: r.email,
            fullName: r.fullName,
            phone: r.phone ?? null,
            passwordHash,
            role: Role.CLIENT,
            ...(locationId ? { homeLocationId: locationId } : {}),
          },
        });
        userId = newUser.id;
        created++;
      }

      // Athlete profile (single per user — INDIVIDUAL family type)
      if (r.ageGroup) {
        const existingProfile = await prisma.athleteProfile.findFirst({ where: { userId } });
        const [firstName, ...rest] = r.fullName.split(' ');
        const lastName = rest.join(' ') || firstName;
        if (existingProfile) {
          await prisma.athleteProfile.update({
            where: { id: existingProfile.id },
            data: { ageGroup: r.ageGroup, firstName, lastName },
          });
        } else {
          await prisma.athleteProfile.create({
            data: {
              userId,
              firstName,
              lastName,
              ageGroup: r.ageGroup,
              relationToParent: 'SELF',
              parentOptOut: true,
              parentOptOutAckedAt: new Date(),
            },
          });
        }
      }

      // Membership (best-effort match by plan name)
      if (r.planName) {
        const plan = allPlans.find((p) => p.name.toLowerCase() === r.planName!.toLowerCase());
        if (plan) {
          const existingMembership = await prisma.clientMembership.findFirst({
            where: { clientId: userId, planId: plan.id },
          });
          const status = mapMembershipStatus(r.status);
          if (!existingMembership) {
            const resolvedLocId = plan.locationId ?? locationId ?? allLocations[0]?.id;
            if (!resolvedLocId) {
              throw new Error(`Cannot create membership for ${r.email}: no location resolvable`);
            }
            await prisma.clientMembership.create({
              data: {
                clientId: userId,
                planId: plan.id,
                locationId: resolvedLocId,
                status,
                billingDay: 'MONDAY',
                billingAnchorDate: new Date(),
                startedAt: new Date(),
              },
            });
          } else if (existingMembership.status !== status) {
            await prisma.clientMembership.update({
              where: { id: existingMembership.id },
              data: { status },
            });
          }
        }
      }
    } catch (err) {
      console.error(`[swiftImport] row failed for ${r.email}:`, err);
      skipped++;
    }
  }

  return {
    total: dataRows.length,
    parsed: validRows.length,
    errors,
    preview: validRows.slice(0, 5),
    willCreate,
    willUpdate,
    membershipsCreated,
    ageGroupsAssigned,
    created,
    updated,
    skipped,
  };
}

// ============================================================
// CSV parser — handles quoted fields, commas inside quotes,
// escaped quotes ("" → "), and \r\n / \n line endings.
// ============================================================
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(cur);
        cur = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur);
        out.push(row);
        row = [];
        cur = '';
      } else {
        cur += c;
      }
    }
  }
  // Trailing field
  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    out.push(row);
  }
  return out;
}

function normalizeAgeGroup(raw: string | undefined): string | null {
  if (!raw) return null;
  const v = raw.toLowerCase().trim();
  if (['youth', '12u', '12 and under'].includes(v)) return 'youth';
  if (['ms', 'hs', 'ms_hs', 'middle school', 'high school', 'middle/high'].includes(v)) return 'ms_hs';
  if (v === 'college') return 'college';
  if (['pro', 'milb', 'mlb'].includes(v)) return 'pro';
  // Pass through unknown values so admins can still see them in audit
  return v;
}

function mapMembershipStatus(raw: string | null | undefined): MembershipStatus {
  if (!raw) return MembershipStatus.ACTIVE;
  const v = raw.toLowerCase();
  if (v.includes('past') || v.includes('overdue')) return MembershipStatus.PAST_DUE;
  if (v.includes('cancel') || v.includes('inactive')) return MembershipStatus.CANCELLED;
  return MembershipStatus.ACTIVE;
}

export default router;
