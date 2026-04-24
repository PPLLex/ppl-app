'use client';

/**
 * Messages widget — parent dashboard.
 *
 * Shows unread-count big number + most recent conversation preview.
 * Tap to jump to the full inbox.
 *
 * Data source: api.getConversations() → ConversationSummary[].
 */

import { useEffect, useState } from 'react';
import { api, ConversationSummary } from '@/lib/api';
import Link from '@/components/PageTransitionLink';
import type { WidgetProps } from '../types';

export function MessagesWidget(_props: WidgetProps) {
  const [convos, setConvos] = useState<ConversationSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getConversations();
        if (!cancelled) setConvos(res.data ?? []);
      } catch {
        if (!cancelled) setConvos([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (convos === null) {
    return (
      <div className="space-y-2">
        <div className="ppl-skeleton h-4 w-24" aria-hidden="true" />
        <div className="ppl-skeleton h-4 w-full" aria-hidden="true" />
      </div>
    );
  }

  const unreadTotal = convos.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
  const latest = convos[0] || null;

  if (convos.length === 0) {
    return (
      <div className="flex flex-col h-full justify-between gap-3">
        <p className="text-sm text-muted leading-snug">
          Start a conversation with your coaches or PPL staff.
        </p>
        <Link
          href="/client/messages"
          className="text-xs font-medium text-accent-text hover:brightness-110"
        >
          Open inbox →
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-stat text-3xl leading-none tabular-nums text-foreground">
          {unreadTotal}
        </span>
        <span className="text-[11px] uppercase tracking-[0.12em] text-muted">
          Unread
        </span>
      </div>
      {latest && (
        <div className="mt-1 border-t border-border/60 pt-2">
          <p className="text-[11px] text-muted">Latest</p>
          <p className="text-xs text-foreground/90 truncate mt-0.5">
            {latest.lastMessage?.content || 'No messages yet'}
          </p>
        </div>
      )}
      <div className="mt-auto">
        <Link
          href="/client/messages"
          className="text-xs font-medium text-accent-text hover:brightness-110"
        >
          Open inbox →
        </Link>
      </div>
    </div>
  );
}
