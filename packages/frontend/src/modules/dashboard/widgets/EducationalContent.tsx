'use client';

/**
 * EducationalContentWidget — placeholder.
 *
 * Full implementation lands in a focused follow-up. The foundation +
 * registry + grid are live; this widget renders a premium "coming
 * soon" card until its data source is wired.
 */

import { PlaceholderBody } from './shared/PlaceholderBody';
import type { WidgetProps } from '../types';

export function EducationalContentWidget(_props: WidgetProps) {
  return (
    <PlaceholderBody
      line="Videos and guides explaining everything included with your PPL membership."
      cta="Learning hub coming soon"
    />
  );
}
