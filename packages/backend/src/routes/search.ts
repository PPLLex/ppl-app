/**
 * Global search (#139) — powers the Cmd-K command palette.
 *
 *   GET /api/search?q=term&types=user,lead,session
 *
 * Returns the top N matches across users, leads, and athletes (all
 * scoped to the org) with a stable shape:
 *
 *   { id, type: 'user'|'lead'|'athlete'|'session', label, sublabel, href }
 *
 * Permissions: any authenticated staff role. Clients only see themselves
 * (no real value in palette for clients yet, but harmless to expose).
 *
 * Performance: hard-capped at 8 per type so the palette stays snappy.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate } from '../middleware/auth';
import { Role } from '@prisma/client';

const router = Router();
router.use(authenticate);

const STAFF_ROLES = new Set<Role>([
  Role.ADMIN,
  Role.COORDINATOR,
  Role.PERFORMANCE_COACH,
  Role.CONTENT_MARKETING_ADMIN,
  Role.CONTENT_MARKETING,
  Role.MEDICAL_ADMIN,
  Role.MEDICAL,
  Role.PARTNERSHIP_COACH,
  Role.OUTSIDE_COACH,
]);

interface SearchHit {
  id: string;
  type: 'user' | 'lead' | 'athlete' | 'session';
  label: string;
  sublabel?: string;
  href: string;
}

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const q = String(req.query.q || '').trim();
    if (q.length < 2) {
      res.json({ success: true, data: { results: [] } });
      return;
    }

    // Clients can only find themselves — keeps the privacy model simple.
    const isStaff = STAFF_ROLES.has(user.role as Role);
    if (!isStaff) {
      const me = await prisma.user.findUnique({
        where: { id: user.userId },
        select: { id: true, fullName: true, email: true },
      });
      const results: SearchHit[] = me
        ? [{ id: me.id, type: 'user', label: me.fullName, sublabel: me.email, href: '/client/account' }]
        : [];
      res.json({ success: true, data: { results } });
      return;
    }

    const wantedTypes = String(req.query.types || 'user,lead,athlete,session')
      .split(',')
      .map((s) => s.trim());

    const results: SearchHit[] = [];

    if (wantedTypes.includes('user')) {
      const users = await prisma.user.findMany({
        where: {
          OR: [
            { fullName: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: { id: true, fullName: true, email: true, role: true },
        take: 8,
      });
      for (const u of users) {
        results.push({
          id: u.id,
          type: 'user',
          label: u.fullName,
          sublabel: `${u.role} · ${u.email}`,
          href: u.role === Role.CLIENT ? `/admin/members/${u.id}` : `/admin/staff/${u.id}`,
        });
      }
    }

    if (wantedTypes.includes('lead')) {
      const leads = await prisma.lead.findMany({
        where: {
          organizationId: 'ppl',
          OR: [
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: { id: true, firstName: true, lastName: true, email: true, stage: true },
        take: 8,
      });
      for (const l of leads) {
        results.push({
          id: l.id,
          type: 'lead',
          label: `${l.firstName} ${l.lastName}`,
          sublabel: `Lead · ${l.stage} · ${l.email}`,
          href: `/admin/crm/${l.id}`,
        });
      }
    }

    if (wantedTypes.includes('athlete')) {
      const athletes = await prisma.athleteProfile.findMany({
        where: {
          OR: [
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          ageGroup: true,
          user: { select: { id: true, email: true } },
        },
        take: 8,
      });
      for (const a of athletes) {
        results.push({
          id: a.id,
          type: 'athlete',
          label: `${a.firstName} ${a.lastName}`,
          sublabel: `Athlete · ${a.ageGroup ?? 'unknown level'} · ${a.user?.email ?? '—'}`,
          href: a.user?.id ? `/admin/members/${a.user.id}` : `/admin`,
        });
      }
    }

    if (wantedTypes.includes('session')) {
      const sessions = await prisma.session.findMany({
        where: {
          startTime: { gte: new Date() },
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: { id: true, title: true, startTime: true, location: { select: { name: true } } },
        take: 8,
        orderBy: { startTime: 'asc' },
      });
      for (const s of sessions) {
        results.push({
          id: s.id,
          type: 'session',
          label: s.title,
          sublabel: `Session · ${new Date(s.startTime).toLocaleString()} · ${s.location?.name ?? ''}`,
          href: `/admin/schedule?focus=${s.id}`,
        });
      }
    }

    res.json({ success: true, data: { results } });
  } catch (err) {
    next(err);
  }
});

export default router;
