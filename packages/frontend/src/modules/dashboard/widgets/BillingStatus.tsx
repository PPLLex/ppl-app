'use client';

/**
 * BillingStatusWidget — placeholder.
 *
 * Full implementation lands in a focused follow-up. The foundation +
 * registry + grid are live; this widget renders a premium "coming
 * soon" card until its data source is wired.
 */

import { PlaceholderBody } from './shared/PlaceholderBody';
import type { WidgetProps } from '../types';

export function BillingStatusWidget(_props: WidgetProps) {
  return (
    <PlaceholderBody
      line="Your next charge and card on file at a glance."
      cta="Billing view coming soon"
    />
  );
}
