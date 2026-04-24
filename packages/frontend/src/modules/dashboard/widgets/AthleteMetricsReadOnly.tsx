'use client';

/**
 * AthleteMetricsReadOnlyWidget — placeholder.
 *
 * Full implementation lands in a focused follow-up. The foundation +
 * registry + grid are live; this widget renders a premium "coming
 * soon" card until its data source is wired.
 */

import { PlaceholderBody } from './shared/PlaceholderBody';
import type { WidgetProps } from '../types';

export function AthleteMetricsReadOnlyWidget(_props: WidgetProps) {
  return (
    <PlaceholderBody
      line="Read-only metrics for athletes who added you."
      cta="Metrics view coming soon"
    />
  );
}
