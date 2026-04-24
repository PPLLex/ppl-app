'use client';

/**
 * TodaysProgramWidget — placeholder.
 *
 * Full implementation lands in a focused follow-up. The foundation +
 * registry + grid are live; this widget renders a premium "coming
 * soon" card until its data source is wired.
 */

import { PlaceholderBody } from './shared/PlaceholderBody';
import type { WidgetProps } from '../types';

export function TodaysProgramWidget(_props: WidgetProps) {
  return (
    <PlaceholderBody
      line="Today\u2019s throwing, hitting, arm-care, and strength work."
      cta="Program view coming soon"
    />
  );
}
