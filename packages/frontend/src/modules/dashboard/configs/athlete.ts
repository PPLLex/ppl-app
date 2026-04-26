/**
 * Athlete dashboard config.
 *
 * Applied to self-managing CLIENT users (MS/HS solo, College, Pro).
 * Priority per Chad's 2026-04-23 call:
 *   1. Today's program (hero)
 *   2. My goals
 *   3. My metrics + metric-related goals
 *   4. Coach notes
 */

import type { DashboardConfig } from '../types';

export const athleteDashboardConfig: DashboardConfig = {
  name: 'Athlete Dashboard',
  widgets: [
    { id: 'todays-program', size: '2x2' },
    { id: 'my-goals', size: '1x1' },
    { id: 'my-metrics', size: '2x1' },
    { id: 'coach-notes', size: '1x1' },
    { id: 'refer-a-friend', size: '1x1' },
  ],
};
