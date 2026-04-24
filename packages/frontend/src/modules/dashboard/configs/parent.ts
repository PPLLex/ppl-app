/**
 * Parent dashboard config.
 *
 * Applied to CLIENT users who have one or more linked AthleteProfile
 * (i.e. kids) — not to self-managing athletes (those get athlete.ts).
 *
 * Widget priority per Chad's 2026-04-23 call:
 *   1. Book / cancel sessions for their kid(s)
 *   2. See kid's recent coach notes
 *   3. Message coaches / PPL staff
 *   4. Manage billing
 *   5. Watch educational content about membership
 *
 * Reorder or remove widgets by editing this array. No other files need
 * to change.
 */

import type { DashboardConfig } from '../types';

export const parentDashboardConfig: DashboardConfig = {
  name: 'Parent Dashboard',
  widgets: [
    { id: 'upcoming-sessions', size: '2x1' },
    { id: 'recent-coach-notes', size: '1x2' },
    { id: 'messages', size: '1x1' },
    { id: 'billing-status', size: '1x1' },
    { id: 'educational-content', size: '2x1' },
  ],
};
