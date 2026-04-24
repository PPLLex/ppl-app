'use client';

/**
 * PlayerCoachNotesWidget — placeholder.
 *
 * Full implementation lands in a focused follow-up. The foundation +
 * registry + grid are live; this widget renders a premium "coming
 * soon" card until its data source is wired.
 */

import { PlaceholderBody } from './shared/PlaceholderBody';
import type { WidgetProps } from '../types';

export function PlayerCoachNotesWidget(_props: WidgetProps) {
  return (
    <PlaceholderBody
      line="Read-only coach notes across your entire team."
      cta="Notes view coming soon"
    />
  );
}
