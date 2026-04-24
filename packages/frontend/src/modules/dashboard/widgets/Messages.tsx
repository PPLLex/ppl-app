'use client';

/**
 * MessagesWidget — placeholder.
 *
 * Full implementation lands in a focused follow-up. The foundation +
 * registry + grid are live; this widget renders a premium "coming
 * soon" card until its data source is wired.
 */

import { PlaceholderBody } from './shared/PlaceholderBody';
import type { WidgetProps } from '../types';

export function MessagesWidget(_props: WidgetProps) {
  return (
    <PlaceholderBody
      line="Unread messages with coaches and PPL staff."
      cta="Inbox coming soon"
    />
  );
}
