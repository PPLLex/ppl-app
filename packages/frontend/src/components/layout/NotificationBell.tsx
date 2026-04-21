'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { api, AppNotification } from '@/lib/api';

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const loadNotifications = useCallback(async () => {
    try {
      const res = await api.getNotifications({ page: 1 });
      if (res.data) setNotifications(res.data);
      // unreadCount comes from the response wrapper
      const raw = res as any;
      if (raw.unreadCount !== undefined) setUnreadCount(raw.unreadCount);
    } catch (err) {
      console.error(err);
    }
  }, []);

  // Initial load + poll every 15s
  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 15000);
    return () => clearInterval(interval);
  }, [loadNotifications]);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleMarkAllRead = async () => {
    try {
      await api.markAllNotificationsRead();
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, status: 'READ' })));
    } catch (err) {
      console.error(err);
    }
  };

  const handleMarkRead = async (id: string) => {
    try {
      await api.markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, status: 'READ' } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error(err);
    }
  };

  const NOTIF_ICONS: Record<string, string> = {
    BOOKING_CONFIRMED: '📅',
    BOOKING_CANCELLED: '❌',
    PAYMENT_SUCCESS: '💳',
    PAYMENT_FAILED: '⚠️',
    MEMBERSHIP_ACTIVATED: '✅',
    MEMBERSHIP_PAST_DUE: '🔴',
    SCHEDULE_CHANGED: '🔄',
    SESSION_REMINDER: '⏰',
    NEW_MESSAGE: '💬',
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) loadNotifications();
        }}
        className="relative p-2 rounded-lg text-muted hover:text-foreground hover:bg-surface transition"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4.5 h-4.5 min-w-[18px] rounded-full bg-accent text-background text-[10px] font-bold flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-surface border border-border rounded-xl shadow-2xl z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="text-sm font-bold text-foreground">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-accent hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto">
            {notifications.length > 0 ? (
              notifications.map((notif) => {
                const isUnread = notif.status !== 'READ';
                return (
                  <button
                    key={notif.id}
                    onClick={() => {
                      if (isUnread) handleMarkRead(notif.id);
                    }}
                    className={`w-full px-4 py-3 text-left border-b border-border/50 transition hover:bg-background ${
                      isUnread ? 'bg-primary/5' : ''
                    }`}
                  >
                    <div className="flex gap-3">
                      <span className="text-base flex-shrink-0 mt-0.5">
                        {NOTIF_ICONS[notif.type] || '🔔'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-sm ${isUnread ? 'font-semibold text-foreground' : 'text-muted'}`}>
                            {notif.title}
                          </p>
                          {isUnread && (
                            <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0 mt-1.5" />
                          )}
                        </div>
                        <p className="text-xs text-muted mt-0.5 line-clamp-2">{notif.body}</p>
                        <p className="text-xs text-muted/50 mt-1">{formatTimeAgo(notif.createdAt)}</p>
                      </div>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="py-8 text-center">
                <p className="text-sm text-muted">No notifications yet</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
