/**
 * Dashboard widget registry — the single source of truth for every
 * available widget in the app. Role configs reference widgets by ID;
 * this file owns the ID → definition mapping.
 *
 * When adding a new widget:
 *   1. Create the component in widgets/ and export it.
 *   2. Import it here.
 *   3. Register it in the WIDGETS map below with a stable ID.
 *   4. Add the ID to any role config that should show it (configs/*.ts).
 *
 * That's the entire extension point. No grid changes, no provider
 * changes, no route changes.
 */

import type { WidgetDefinition } from './types';
import {
  UpcomingSessionsWidget,
  MyAthletesWidget,
  RecentCoachNotesWidget,
  MessagesWidget,
  BillingStatusWidget,
  EducationalContentWidget,
  TodaysProgramWidget,
  MyGoalsWidget,
  MyMetricsWidget,
  CoachNotesWidget,
  TeamRosterWidget,
  PlayerCoachNotesWidget,
  PlayerMetricsWidget,
  AttachedAthletesWidget,
  AthleteNotesReadOnlyWidget,
  AthleteMetricsReadOnlyWidget,
  MessagePplStaffWidget,
  ReferAFriendWidget,
  TrainingStreakWidget,
} from './widgets';

/**
 * The canonical widget catalog. Keyed by stable widget ID.
 */
export const WIDGETS: Record<string, WidgetDefinition> = {
  // ─── Parent dashboard ─────────────────────────────────────────────────
  'my-athletes': {
    id: 'my-athletes',
    title: 'My Athletes',
    defaultSize: '1x2',
    allowedRoles: ['CLIENT'],
    component: MyAthletesWidget,
  },
  'upcoming-sessions': {
    id: 'upcoming-sessions',
    title: 'Upcoming Sessions',
    defaultSize: '2x1',
    allowedRoles: ['CLIENT'],
    component: UpcomingSessionsWidget,
  },
  'recent-coach-notes': {
    id: 'recent-coach-notes',
    title: 'Recent Coach Notes',
    defaultSize: '1x2',
    allowedRoles: ['CLIENT'],
    component: RecentCoachNotesWidget,
  },
  messages: {
    id: 'messages',
    title: 'Messages',
    defaultSize: '1x1',
    allowedRoles: ['CLIENT'],
    component: MessagesWidget,
  },
  'billing-status': {
    id: 'billing-status',
    title: 'Billing',
    defaultSize: '1x1',
    allowedRoles: ['CLIENT'],
    component: BillingStatusWidget,
  },
  'educational-content': {
    id: 'educational-content',
    title: 'Learn More',
    defaultSize: '2x1',
    allowedRoles: ['CLIENT'],
    component: EducationalContentWidget,
  },

  // ─── Athlete dashboard (13+ self-managed) ────────────────────────────
  'todays-program': {
    id: 'todays-program',
    title: 'Today\u2019s Program',
    defaultSize: '2x2',
    allowedRoles: ['CLIENT'],
    component: TodaysProgramWidget,
  },
  'my-goals': {
    id: 'my-goals',
    title: 'My Goals',
    defaultSize: '1x1',
    allowedRoles: ['CLIENT'],
    component: MyGoalsWidget,
  },
  'my-metrics': {
    id: 'my-metrics',
    title: 'My Metrics',
    defaultSize: '2x1',
    allowedRoles: ['CLIENT'],
    component: MyMetricsWidget,
  },
  'coach-notes': {
    id: 'coach-notes',
    title: 'Coach Notes',
    defaultSize: '1x1',
    allowedRoles: ['CLIENT'],
    component: CoachNotesWidget,
  },

  // ─── Partnership school (SchoolCoach) ────────────────────────────────
  'team-roster': {
    id: 'team-roster',
    title: 'Team Roster',
    defaultSize: '2x2',
    allowedRoles: ['SCHOOL_COACH'],
    component: TeamRosterWidget,
  },
  'player-coach-notes': {
    id: 'player-coach-notes',
    title: 'Player Coach Notes',
    defaultSize: '1x1',
    allowedRoles: ['SCHOOL_COACH'],
    component: PlayerCoachNotesWidget,
  },
  'player-metrics': {
    id: 'player-metrics',
    title: 'Player Metrics',
    defaultSize: '1x1',
    allowedRoles: ['SCHOOL_COACH'],
    component: PlayerMetricsWidget,
  },

  // ─── Outside coach (attached by a player/parent) ─────────────────────
  'attached-athletes': {
    id: 'attached-athletes',
    title: 'My Athletes',
    defaultSize: '2x1',
    allowedRoles: ['OUTSIDE_COACH'],
    component: AttachedAthletesWidget,
  },
  'athlete-notes-readonly': {
    id: 'athlete-notes-readonly',
    title: 'Coach Notes',
    defaultSize: '1x1',
    allowedRoles: ['OUTSIDE_COACH'],
    component: AthleteNotesReadOnlyWidget,
  },
  'athlete-metrics-readonly': {
    id: 'athlete-metrics-readonly',
    title: 'Metrics',
    defaultSize: '1x1',
    allowedRoles: ['OUTSIDE_COACH'],
    component: AthleteMetricsReadOnlyWidget,
  },
  'message-ppl-staff': {
    id: 'message-ppl-staff',
    title: 'Message PPL',
    defaultSize: '1x1',
    allowedRoles: ['OUTSIDE_COACH'],
    component: MessagePplStaffWidget,
  },
  'refer-a-friend': {
    id: 'refer-a-friend',
    title: 'Refer a Friend',
    defaultSize: '1x1',
    allowedRoles: ['CLIENT'],
    component: ReferAFriendWidget,
  },
  // Streak indicator (#U22) — retention + delight, shows up on every
  // CLIENT dashboard variant.
  'training-streak': {
    id: 'training-streak',
    title: 'Training Streak',
    defaultSize: '1x1',
    allowedRoles: ['CLIENT'],
    component: TrainingStreakWidget,
  },
};

export function getWidget(id: string): WidgetDefinition | undefined {
  return WIDGETS[id];
}
