/**
 * Outside coach dashboard config.
 *
 * OUTSIDE_COACH users are private coaches attached to a player/parent
 * via OutsideCoachLink. Intentionally minimal per Chad's 2026-04-23
 * call: metrics + coach notes only, plus a message-PPL channel.
 */

import type { DashboardConfig } from '../types';

export const outsideCoachDashboardConfig: DashboardConfig = {
  name: 'Coach Dashboard',
  widgets: [
    { id: 'attached-athletes', size: '2x1' },
    { id: 'athlete-notes-readonly', size: '1x1' },
    { id: 'athlete-metrics-readonly', size: '1x1' },
    { id: 'message-ppl-staff', size: '1x1' },
  ],
};
