'use client';

import { useState, useEffect } from 'react';
import { usePushNotifications } from '@/hooks/usePushNotifications';

/**
 * Non-intrusive prompt that slides in to ask users to enable push notifications.
 * Shows once per session if permission hasn't been granted or denied.
 * Appears 5 seconds after mount to avoid being annoying on first load.
 */
export default function PushNotificationPrompt() {
  const { permission, isRegistered, isLoading, requestPermission } = usePushNotifications();
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Only show if permission is 'default' (never asked) and not already registered
    if (permission !== 'default' || isRegistered || dismissed) return;

    // Check if we already dismissed this session
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('ppl_push_dismissed')) {
      setDismissed(true);
      return;
    }

    // Delay the prompt so it doesn't feel aggressive
    const timer = setTimeout(() => setVisible(true), 5000);
    return () => clearTimeout(timer);
  }, [permission, isRegistered, dismissed]);

  const handleEnable = async () => {
    const success = await requestPermission();
    if (success) {
      setVisible(false);
    }
  };

  const handleDismiss = () => {
    setVisible(false);
    setDismissed(true);
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('ppl_push_dismissed', 'true');
    }
  };

  if (!visible || permission !== 'default') return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="ppl-card border border-primary/20 shadow-lg">
        <div className="flex items-start gap-3">
          {/* Bell icon */}
          <div className="w-10 h-10 rounded-full ppl-gradient flex items-center justify-center shrink-0 mt-0.5">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
            </svg>
          </div>

          <div className="flex-1 min-w-0">
            <p className="font-semibold text-foreground text-sm">Stay in the loop</p>
            <p className="text-xs text-muted mt-0.5 leading-relaxed">
              Get instant alerts for session reminders, booking confirmations, and payment updates.
            </p>

            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={handleEnable}
                disabled={isLoading}
                className="px-3 py-1.5 text-xs font-medium text-white ppl-gradient rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {isLoading ? 'Enabling...' : 'Enable Notifications'}
              </button>
              <button
                onClick={handleDismiss}
                className="px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground transition-colors"
              >
                Not now
              </button>
            </div>
          </div>

          {/* Close button */}
          <button
            onClick={handleDismiss}
            className="text-muted hover:text-foreground transition-colors p-0.5"
            aria-label="Dismiss"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
