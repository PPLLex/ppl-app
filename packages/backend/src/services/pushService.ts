import admin from 'firebase-admin';
import { config } from '../config';
import { prisma } from '../utils/prisma';

let firebaseInitialized = false;

/**
 * Initialize Firebase Admin SDK.
 * Called lazily on first push send — avoids crash if credentials aren't configured.
 */
function initFirebase(): boolean {
  if (firebaseInitialized) return true;

  const { projectId, clientEmail, privateKey } = config.firebase;

  if (!projectId || !clientEmail || !privateKey) {
    console.warn('[Push] Firebase credentials not configured — push notifications disabled');
    return false;
  }

  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
    firebaseInitialized = true;
    console.log('[Push] Firebase Admin SDK initialized');
    return true;
  } catch (error) {
    console.error('[Push] Failed to initialize Firebase:', error);
    return false;
  }
}

interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  icon?: string;
  url?: string; // Click-through URL
}

/**
 * Send a push notification to all active devices for a user.
 * Returns true if at least one device was successfully notified.
 */
export async function sendPush(userId: string, payload: PushPayload): Promise<boolean> {
  if (!initFirebase()) return false;

  // Get all active push tokens for this user
  const tokens = await prisma.pushToken.findMany({
    where: { userId, isActive: true },
    select: { id: true, token: true },
  });

  if (tokens.length === 0) {
    console.log(`[Push] No active tokens for user ${userId}`);
    return false;
  }

  const messaging = admin.messaging();

  // Build FCM message
  const message: admin.messaging.MulticastMessage = {
    tokens: tokens.map(t => t.token),
    notification: {
      title: payload.title,
      body: payload.body,
    },
    webpush: {
      notification: {
        icon: payload.icon || '/ppl-icon-192.png',
        badge: '/ppl-badge-72.png',
        tag: payload.data?.type || 'ppl-notification',
        ...(payload.url ? { data: { url: payload.url } } : {}),
      },
      fcmOptions: {
        link: payload.url || '/',
      },
    },
    data: payload.data || {},
  };

  try {
    const response = await messaging.sendEachForMulticast(message);

    // Handle stale tokens — deactivate any that failed with specific errors
    const staleTokenIds: string[] = [];
    response.responses.forEach((resp, idx) => {
      if (!resp.success && resp.error) {
        const code = resp.error.code;
        // These error codes mean the token is permanently invalid
        if (
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/registration-token-not-registered'
        ) {
          staleTokenIds.push(tokens[idx].id);
        }
      }
    });

    // Deactivate stale tokens
    if (staleTokenIds.length > 0) {
      await prisma.pushToken.updateMany({
        where: { id: { in: staleTokenIds } },
        data: { isActive: false },
      });
      console.log(`[Push] Deactivated ${staleTokenIds.length} stale token(s) for user ${userId}`);
    }

    const successCount = response.successCount;
    console.log(`[Push] Sent to ${successCount}/${tokens.length} device(s) for user ${userId}`);

    return successCount > 0;
  } catch (error) {
    console.error(`[Push] Failed to send to user ${userId}:`, error);
    return false;
  }
}
