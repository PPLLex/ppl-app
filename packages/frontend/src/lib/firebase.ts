import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getMessaging, getToken, onMessage, Messaging, MessagePayload } from 'firebase/messaging';

// Firebase config from environment variables
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
};

let app: FirebaseApp | null = null;
let messaging: Messaging | null = null;

/**
 * Initialize Firebase app (singleton).
 */
function getFirebaseApp(): FirebaseApp | null {
  if (typeof window === 'undefined') return null;
  if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
    console.warn('[Firebase] Config not set — push notifications disabled');
    return null;
  }

  if (!app && getApps().length === 0) {
    app = initializeApp(firebaseConfig);
  } else if (!app) {
    app = getApps()[0];
  }
  return app;
}

/**
 * Get Firebase Messaging instance.
 */
function getFirebaseMessaging(): Messaging | null {
  if (messaging) return messaging;

  const fbApp = getFirebaseApp();
  if (!fbApp) return null;

  try {
    messaging = getMessaging(fbApp);
    return messaging;
  } catch (error) {
    console.error('[Firebase] Failed to get messaging:', error);
    return null;
  }
}

/**
 * Register the service worker and request an FCM token.
 * Returns the token string, or null if permission was denied or unavailable.
 */
export async function requestPushToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  if (!('serviceWorker' in navigator) || !('Notification' in window)) {
    console.warn('[Push] Service workers or notifications not supported');
    return null;
  }

  const fbMessaging = getFirebaseMessaging();
  if (!fbMessaging) return null;

  try {
    // Register the service worker with Firebase config as query params
    const swUrl = buildSwUrl();
    const registration = await navigator.serviceWorker.register(swUrl, { scope: '/' });

    // Wait for the SW to be ready
    await navigator.serviceWorker.ready;

    const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || '';
    if (!vapidKey) {
      console.warn('[Push] VAPID key not configured');
      return null;
    }

    const token = await getToken(fbMessaging, {
      vapidKey,
      serviceWorkerRegistration: registration,
    });

    if (token) {
      console.log('[Push] FCM token obtained');
      return token;
    } else {
      console.log('[Push] No FCM token — permission may not be granted');
      return null;
    }
  } catch (error) {
    console.error('[Push] Failed to get FCM token:', error);
    return null;
  }
}

/**
 * Build the service worker URL with Firebase config as query params.
 */
function buildSwUrl(): string {
  const params = new URLSearchParams({
    apiKey: firebaseConfig.apiKey,
    authDomain: firebaseConfig.authDomain,
    projectId: firebaseConfig.projectId,
    storageBucket: firebaseConfig.storageBucket,
    messagingSenderId: firebaseConfig.messagingSenderId,
    appId: firebaseConfig.appId,
  });
  return `/firebase-messaging-sw.js?${params.toString()}`;
}

/**
 * Listen for foreground messages and call the handler.
 * Returns an unsubscribe function.
 */
export function onForegroundMessage(handler: (payload: MessagePayload) => void): (() => void) | null {
  const fbMessaging = getFirebaseMessaging();
  if (!fbMessaging) return null;

  return onMessage(fbMessaging, handler);
}

/**
 * Check if push notifications are supported and permission state.
 */
export function getPushPermissionState(): 'granted' | 'denied' | 'default' | 'unsupported' {
  if (typeof window === 'undefined') return 'unsupported';
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}
