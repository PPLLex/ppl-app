'use client';

/**
 * RecentCoachNotesWidget — placeholder.
 *
 * Full implementation lands in a focused follow-up. The foundation +
 * registry + grid are live; this widget renders a premium "coming
 * soon" card until its data source is wired.
 */

import { PlaceholderBody } from './shared/PlaceholderBody';
import type { WidgetProps } from '../types';

export function RecentCoachNotesWidget(_props: WidgetProps) {
  return (
    <PlaceholderBody
      line="Latest feedback from your kid\u2019s coaches will show here."
      cta="Full notes coming soon"
    />
  );
}
