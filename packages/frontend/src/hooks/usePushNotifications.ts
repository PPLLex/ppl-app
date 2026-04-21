'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { requestPushToken, onForegroundMessage, getPushPermissionState } from '@/lib/firebase';
import { api } from '@/lib/api';

interface UsePushNotificationsReturn {
  permission: 'granted' | 'denied' | 'default' | 'unsupported';
  isRegistered: boolean;
  isLoading: boolean;
  requestPermission: () => Promise<boolean>;
  unregister: () => Promise<void>;
}

/**
 * Hook to manage push notification registration and foreground message handling.
 * Call requestPermission() to prompt the user and register with the backend.
 */
export function usePushNotifications(): UsePushNotificationsReturn {
  const [permission, setPermission] = useState<'granted' | 'denied' | 'default' | 'unsupported'>('default');
  const [isRegistered, setIsRegistered] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const currentToken = useRef<string | null>(null);

  // Check current permission state on mount
  useEffect(() => {
    setPermission(getPushPermissionState());
  }, []);

  // Set up foreground message handler
  useEffect(() => {
    const unsubscribe = onForegroundMessage((payload) => {
      // Show in-app toast for foreground messages
      if (payload.notification) {
        // Use the Notification API for foreground messages too
        if (Notification.permission === 'granted') {
          new Notification(payload.notification.title || 'PPL', {
            body: payload.notification.body || '',
            icon: '/ppl-icon-192.png',
            tag: 'ppl-foreground',
          });
        }
      }
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Auto-register if permission already granted (returning user)
  useEffect(() => {
    if (permission === 'granted' && !isRegistered && !isLoading) {
      registerToken();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission]);

  const registerToken = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    try {
      const token = await requestPushToken();
      if (token) {
        // Get device info for the backend
        const deviceInfo = getDeviceInfo();
        await api.registerPushToken(token, deviceInfo);
        currentToken.current = token;
        setIsRegistered(true);
        setPermission('granted');
        return true;
      }
      return false;
    } catch (error) {
      console.error('[Push] Registration failed:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermission('unsupported');
      return false;
    }

    // Request browser permission first
    const result = await Notification.requestPermission();
    setPermission(result as 'granted' | 'denied' | 'default');

    if (result === 'granted') {
      return registerToken();
    }
    return false;
  }, [registerToken]);

  const unregister = useCallback(async () => {
    if (currentToken.current) {
      try {
        await api.removePushToken(currentToken.current);
      } catch (error) {
        console.error('[Push] Failed to remove token:', error);
      }
      currentToken.current = null;
      setIsRegistered(false);
    }
  }, []);

  return { permission, isRegistered, isLoading, requestPermission, unregister };
}

/**
 * Get a human-readable device description.
 */
function getDeviceInfo(): string {
  if (typeof navigator === 'undefined') return 'Unknown';

  const ua = navigator.userAgent;
  let browser = 'Browser';
  let os = 'Unknown OS';

  // Detect browser
  if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Chrome';
  else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
  else if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Edg')) browser = 'Edge';

  // Detect OS
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac OS')) os = 'macOS';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('Linux')) os = 'Linux';

  return `${browser} on ${os}`;
}
