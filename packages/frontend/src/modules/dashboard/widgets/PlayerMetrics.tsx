'use client';

/**
 * PlayerMetricsWidget — placeholder.
 *
 * Full implementation lands in a focused follow-up. The foundation +
 * registry + grid are live; this widget renders a premium "coming
 * soon" card until its data source is wired.
 */

import { PlaceholderBody } from './shared/PlaceholderBody';
import type { WidgetProps } from '../types';

export function PlayerMetricsWidget(_props: WidgetProps) {
  return (
    <PlaceholderBody
      line="Metric snapshots for every player on your roster."
      cta="Metrics view coming soon"
    />
  );
}
