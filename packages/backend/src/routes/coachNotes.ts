import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate, requireStaffOrAdmin } from '../middleware/auth';
import { createAuditLog } from '../services/auditService';
import { Role, TrainingCategory } from '@prisma/client';

const router = Router();

function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

// ============================================================
// COACH NOTES â write & manage
// ============================================================

/**
 * POST /api/coach-notes
 * Staff/Admin: create a note for an athlete.
 * Coach is auto-identified from the JWT token.
 */
router.post('/', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const coachId = req.user!.userId;
    const { athleteId, trainingCategory, content, sessionDate, bookingId } = req.body;

    if (!athleteId) throw ApiError.badRequest('Athlete ID is required');
    if (!trainingCategory) throw ApiError.badRequest('Training category is required');
    if (!content || content.trim().length === 0) throw ApiError.badRequest('Note content is required');

    // Validate the training category
    if (!Object.values(TrainingCategory).includes(trainingCategory)) {
      throw ApiError.badRequest(`Invalid training category. Must be one of: ${Object.values(TrainingCategory).join(', ')}`);
    }

    // Verify athlete exists and is a CLIENT
    const athlete = await prisma.user.findUnique({
      where: { id: athleteId },
      select: { id: true, role: true, fullName: true, isActive: true },
    });
    if (!athlete || athlete.role !== Role.CLIENT) {
      throw ApiError.notFound('Athlete not found');
    }

    // Check if athlete has an active membership (payment enforcement)
    const activeMembership = await prisma.clientMembership.findFirst({
      where: {
        clientId: athleteId,
        status: 'ACTIVE',
      },
    });
    if (!activeMembership) {
      throw ApiError.forbidden(
        `Cannot submit notes for ${athlete.fullName} â their membership is not active. ` +
        'They need to resolve their payment before notes can be submitted.'
      );
    }

    // If bookingId provided, validate it
    if (bookingId) {
      const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
      if (!booking) throw ApiError.notFound('Booking not found');
    }

    const note = await prisma.coachNote.create({
      data: {
        athleteId,
        coachId,
        trainingCategory,
        rawContent: content.trim(),
        sessionDate: sessionDate ? new Date(sessionDate) : new Date(),
        bookingId: bookingId || null,
      },
      include: {
        coach: { select: { id: true, fullName: true } },
        athlete: { select: { id: true, fullName: true } },
      },
    });

    await createAuditLog({
      userId: coachId,
      action: 'coach_note.created',
      resourceType: 'coach_note',
      resourceId: note.id,
      changes: { athleteId, trainingCategory },
    });

    res.status(201).json({ data: note });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/coach-notes/my
 * Self-managed athlete view of their own notes timeline. No athleteId
 * in the path — uses req.user.userId.
 */
router.get('/my', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const { category, limit, offset } = req.query;

    const where: Record<string, unknown> = {
      athleteId: user.userId,
      isVisible: true,
    };
    if (category) where.trainingCategory = category as string;

    const notes = await prisma.coachNote.findMany({
      where,
      include: {
        coach: { select: { id: true, fullName: true } },
        booking: {
          select: {
            id: true,
            session: {
              select: { id: true, title: true, sessionType: true, startTime: true },
            },
          },
        },
      },
      orderBy: { sessionDate: 'desc' },
      take: limit ? parseInt(limit as string) : 50,
      skip: offset ? parseInt(offset as string) : 0,
    });

    const formattedNotes = notes.map((note: { cleanedContent: string | null; rawContent: string; [key: string]: unknown }) => ({
      ...note,
      content: note.cleanedContent || note.rawContent,
    }));

    res.json({ data: formattedNotes });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/coach-notes/athlete/:athleteId
 * Get all notes for a specific athlete (timeline view).
 * Staff/Admin: see all notes. Client: see own notes only.
 */
router.get('/athlete/:athleteId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const athleteId = param(req, 'athleteId');

    // Clients can only see their own notes
    if (user.role === Role.CLIENT && user.userId !== athleteId) {
      throw ApiError.forbidden('You can only view your own notes');
    }

    const { category, limit, offset } = req.query;

    const where: Record<string, unknown> = {
      athleteId,
      isVisible: true,
    };
    if (category) {
      where.trainingCategory = category as string;
    }

    const notes = await prisma.coachNote.findMany({
      where,
      include: {
        coach: { select: { id: true, fullName: true } },
        booking: {
          select: {
            id: true,
            session: {
              select: { id: true, title: true, sessionType: true, startTime: true },
            },
          },
        },
      },
      orderBy: { sessionDate: 'desc' },
      take: limit ? parseInt(limit as string) : 50,
      skip: offset ? parseInt(offset as string) : 0,
    });

    // Return cleaned content if available, otherwise raw
    const formattedNotes = notes.map((note: { cleanedContent: string | null; rawContent: string; [key: string]: unknown }) => ({
      ...note,
      content: note.cleanedContent || note.rawContent,
    }));

    res.json({ data: formattedNotes });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/coach-notes/my-notes
 * Staff: get all notes I've written (for the coach's own dashboard)
 */
router.get('/my-notes', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const coachId = req.user!.userId;
    const { limit, offset } = req.query;

    const notes = await prisma.coachNote.findMany({
      where: { coachId },
      include: {
        athlete: { select: { id: true, fullName: true } },
        booking: {
          select: {
            session: { select: { title: true, sessionType: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit ? parseInt(limit as string) : 50,
      skip: offset ? parseInt(offset as string) : 0,
    });

    res.json({ data: notes });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/coach-notes/:noteId
 * Staff/Admin: update a note (only the coach who wrote it, or admin)
 */
router.put('/:noteId', authenticate, requireStaffOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const noteId = param(req, 'noteId');
    const { content, trainingCategory } = req.body;

    const existing = await prisma.coachNote.findUnique({ where: { id: noteId } });
    if (!existing) throw ApiError.notFound('Note not found');

    // Only the coach who wrote it or an admin can edit
    if (user.role !== Role.ADMIN && existing.coachId !== user.userId) {
      throw ApiError.forbidden('You can only edit notes you wrote');
    }

    const updateData: Record<string, unknown> = {};
    if (content) updateData.rawContent = content.trim();
    if (trainingCategory) updateData.trainingCategory = trainingCategory;
    // Reset cleaned content since raw content changed
    if (content) updateData.cleanedContent = null;

    const updated = await prisma.coachNote.update({
      where: { id: noteId },
      data: updateData,
      include: {
        coach: { select: { id: true, fullName: true } },
        athlete: { select: { id: true, fullName: true } },
      },
    });

    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/coach-notes/:noteId
 * Admin only: soft-delete (hide) a note
 */
router.delete('/:noteId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const noteId = param(req, 'noteId');

    if (user.role !== Role.ADMIN) {
      throw ApiError.forbidden('Only admins can delete notes');
    }

    const note = await prisma.coachNote.update({
      where: { id: noteId },
      data: { isVisible: false },
    });

    await createAuditLog({
      userId: user.userId,
      action: 'coach_note.deleted',
      resourceType: 'coach_note',
      resourceId: noteId,
    });

    res.json({ data: note, message: 'Note hidden successfully' });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// DIGEST RECIPIENTS â manage who gets weekly emails
// ============================================================

/**
 * GET /api/coach-notes/recipients/:athleteId
 * Get all digest recipients for an athlete
 */
router.get('/recipients/:athleteId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const athleteId = param(req, 'athleteId');

    // Clients can only manage their own recipients
    if (user.role === Role.CLIENT && user.userId !== athleteId) {
      throw ApiError.forbidden('You can only view your own email recipients');
    }

    const recipients = await prisma.digestRecipient.findMany({
      where: { athleteId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ data: recipients });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/coach-notes/recipients/:athleteId
 * Add a new digest recipient (parent email, on-field coach, etc.)
 */
router.post('/recipients/:athleteId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const athleteId = param(req, 'athleteId');
    const { email, name, relation } = req.body;

    if (user.role === Role.CLIENT && user.userId !== athleteId) {
      throw ApiError.forbidden('You can only manage your own email recipients');
    }

    if (!email) throw ApiError.badRequest('Email is required');

    const recipient = await prisma.digestRecipient.create({
      data: {
        athleteId,
        email: email.toLowerCase().trim(),
        name: name || null,
        relation: relation || null,
      },
    });

    res.status(201).json({ data: recipient });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/coach-notes/recipients/:recipientId
 * Remove a digest recipient
 */
router.delete('/recipients/remove/:recipientId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const recipientId = param(req, 'recipientId');

    const recipient = await prisma.digestRecipient.findUnique({ where: { id: recipientId } });
    if (!recipient) throw ApiError.notFound('Recipient not found');

    if (user.role === Role.CLIENT && user.userId !== recipient.athleteId) {
      throw ApiError.forbidden('You can only manage your own email recipients');
    }

    await prisma.digestRecipient.update({
      where: { id: recipientId },
      data: { isActive: false },
    });

    res.json({ message: 'Recipient removed' });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// TRAINING CATEGORIES â for dropdown population
// ============================================================

/**
 * GET /api/coach-notes/categories
 * Return all valid training categories
 */
router.get('/categories', authenticate, (_req: Request, res: Response) => {
  const categories = Object.values(TrainingCategory).map((cat: string) => ({
    value: cat,
    label: cat.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()),
  }));
  res.json({ data: categories });
});

export default router;
