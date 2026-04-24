/**
 * Partnership school coach dashboard config.
 *
 * SchoolCoach users (tied to a SchoolTeam row via partnership setup).
 * They add + remove players, see read-only coach notes and metrics
 * for their team. No booking, no billing, no personal program access.
 */

import type { DashboardConfig } from '../types';

export const schoolCoachDashboardConfig: DashboardConfig = {
  name: 'Team Dashboard',
  widgets: [
    { id: 'team-roster', size: '2x2' },
    { id: 'player-coach-notes', size: '1x1' },
    { id: 'player-metrics', size: '1x1' },
  ],
};
