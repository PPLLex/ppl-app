import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/apiError';
import { authenticate } from '../middleware/auth';
import { Role } from '@prisma/client';

const router = Router();

// All conversation routes require auth
router.use(authenticate);

function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

// ============================================================
// CONVERSATIONS
// ============================================================

/**
 * GET /api/conversations
 * List conversations for the current user.
 * Admins see all; staff see their location's; clients see their own.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;

    // Fetch all conversations, then filter by participant
    const allConversations = await prisma.conversation.findMany({
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            sender: { select: { id: true, fullName: true, role: true } },
          },
        },
        location: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    // Filter: user must be in participants array
    const conversations = allConversations.filter((c) => {
      const participants = c.participants as string[];
      if (user.role === Role.ADMIN) return true; // Admins see all
      return participants.includes(user.userId);
    });

    // Enrich with participant names and unread count
    const enriched = await Promise.all(
      conversations.map(async (conv) => {
        const participantIds = conv.participants as string[];
        const participants = await prisma.user.findMany({
          where: { id: { in: participantIds } },
          select: { id: true, fullName: true, role: true },
        });

        // Count unread messages (messages where current user is NOT in readBy)
        const unreadCount = await prisma.message.count({
          where: {
            conversationId: conv.id,
            NOT: {
              readBy: { path: [], array_contains: user.userId },
            },
            senderId: { not: user.userId },
          },
        });

        const lastMessage = conv.messages[0] || null;

        return {
          id: conv.id,
          type: conv.type,
          locationId: conv.locationId,
          locationName: conv.location?.name || null,
          participants,
          lastMessage: lastMessage
            ? {
                id: lastMessage.id,
                content: lastMessage.content,
                senderId: lastMessage.senderId,
                senderName: lastMessage.sender.fullName,
                createdAt: lastMessage.createdAt,
              }
            : null,
          unreadCount,
          updatedAt: conv.updatedAt,
        };
      })
    );

    res.json({ success: true, data: enriched });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/conversations
 * Start a new conversation. Client can only message staff/admin.
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const { recipientId, message, type } = req.body;

    if (!recipientId || !message) {
      throw ApiError.badRequest('recipientId and message are required');
    }

    // Verify recipient exists
    const recipient = await prisma.user.findUnique({
      where: { id: recipientId },
      select: { id: true, role: true, fullName: true },
    });
    if (!recipient) throw ApiError.notFound('Recipient not found');

    // Check if conversation already exists between these two
    const existing = await prisma.conversation.findMany({
      where: {
        type: type || 'client_coach',
      },
    });

    const existingConv = existing.find((c) => {
      const parts = c.participants as string[];
      return parts.includes(user.userId) && parts.includes(recipientId) && parts.length === 2;
    });

    let conversation;

    if (existingConv) {
      // Add message to existing conversation
      conversation = existingConv;
    } else {
      // Determine conversation type
      const convType =
        type ||
        (user.role === Role.CLIENT
          ? recipient.role === Role.ADMIN
            ? 'client_admin'
            : 'client_coach'
          : 'client_coach');

      conversation = await prisma.conversation.create({
        data: {
          participants: [user.userId, recipientId],
          type: convType,
        },
      });
    }

    // Create the message
    const newMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId: user.userId,
        content: message,
        readBy: [user.userId],
      },
      include: {
        sender: { select: { id: true, fullName: true, role: true } },
      },
    });

    // Update conversation timestamp
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    res.status(201).json({
      success: true,
      data: {
        conversationId: conversation.id,
        message: {
          id: newMessage.id,
          content: newMessage.content,
          senderId: newMessage.senderId,
          senderName: newMessage.sender.fullName,
          createdAt: newMessage.createdAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================
// MESSAGES WITHIN A CONVERSATION
// ============================================================

/**
 * GET /api/conversations/:id/messages
 * Get messages for a conversation. Marks them as read.
 */
router.get('/:id/messages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const conversationId = param(req, 'id');
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;

    // Verify conversation exists and user has access
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) throw ApiError.notFound('Conversation not found');

    const participants = conversation.participants as string[];
    if (user.role !== Role.ADMIN && !participants.includes(user.userId)) {
      throw ApiError.forbidden('You are not a participant in this conversation');
    }

    // Fetch messages
    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: { conversationId },
        include: {
          sender: { select: { id: true, fullName: true, role: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.message.count({ where: { conversationId } }),
    ]);

    // Mark unread messages as read by this user
    const unreadMessages = messages.filter((m) => {
      const readBy = m.readBy as string[];
      return !readBy.includes(user.userId);
    });

    if (unreadMessages.length > 0) {
      // Update readBy for each unread message
      await Promise.all(
        unreadMessages.map((m) => {
          const currentReadBy = m.readBy as string[];
          return prisma.message.update({
            where: { id: m.id },
            data: { readBy: [...currentReadBy, user.userId] },
          });
        })
      );
    }

    res.json({
      success: true,
      data: messages.reverse().map((m) => ({
        id: m.id,
        content: m.content,
        senderId: m.senderId,
        senderName: m.sender.fullName,
        senderRole: m.sender.role,
        readBy: m.readBy,
        createdAt: m.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/conversations/:id/messages
 * Send a message in an existing conversation.
 */
router.post('/:id/messages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const conversationId = param(req, 'id');
    const { content } = req.body;

    if (!content?.trim()) throw ApiError.badRequest('Message content is required');

    // Verify conversation and access
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) throw ApiError.notFound('Conversation not found');

    const participants = conversation.participants as string[];
    if (user.role !== Role.ADMIN && !participants.includes(user.userId)) {
      throw ApiError.forbidden('You are not a participant in this conversation');
    }

    const message = await prisma.message.create({
      data: {
        conversationId,
        senderId: user.userId,
        content: content.trim(),
        readBy: [user.userId],
      },
      include: {
        sender: { select: { id: true, fullName: true, role: true } },
      },
    });

    // Update conversation timestamp
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    res.status(201).json({
      success: true,
      data: {
        id: message.id,
        content: message.content,
        senderId: message.senderId,
        senderName: message.sender.fullName,
        senderRole: message.sender.role,
        readBy: message.readBy,
        createdAt: message.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/conversations/contacts
 * Get available contacts to start a new conversation.
 * Clients see staff + admins at their location.
 * Staff see clients + other staff + admins.
 * Admins see everyone.
 */
router.get('/contacts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;

    let whereClause: any = {
      id: { not: user.userId },
    };

    if (user.role === Role.CLIENT) {
      // Clients can message staff and admins
      whereClause.role = { in: [Role.STAFF, Role.ADMIN] };
    }
    // Staff and Admins can message anyone

    const contacts = await prisma.user.findMany({
      where: whereClause,
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
      },
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
    });

    res.json({ success: true, data: contacts });
  } catch (error) {
    next(error);
  }
});

export default router;
