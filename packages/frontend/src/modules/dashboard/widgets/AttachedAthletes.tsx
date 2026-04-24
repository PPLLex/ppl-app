'use client';

/**
 * AttachedAthletesWidget — placeholder.
 *
 * Full implementation lands in a focused follow-up. The foundation +
 * registry + grid are live; this widget renders a premium "coming
 * soon" card until its data source is wired.
 */

import { PlaceholderBody } from './shared/PlaceholderBody';
import type { WidgetProps } from '../types';

export function AttachedAthletesWidget(_props: WidgetProps) {
  return (
    <PlaceholderBody
      line="Athletes who have added you as their coach."
      cta="Athlete list coming soon"
    />
  );
}
