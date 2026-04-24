'use client';

/**
 * TeamRosterWidget — placeholder.
 *
 * Full implementation lands in a focused follow-up. The foundation +
 * registry + grid are live; this widget renders a premium "coming
 * soon" card until its data source is wired.
 */

import { PlaceholderBody } from './shared/PlaceholderBody';
import type { WidgetProps } from '../types';

export function TeamRosterWidget(_props: WidgetProps) {
  return (
    <PlaceholderBody
      line="Add, remove, and manage players on your team."
      cta="Roster view coming soon"
    />
  );
}
