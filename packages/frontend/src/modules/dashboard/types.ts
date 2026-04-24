/**
 * Dashboard module — type contract.
 *
 * Every widget on every dashboard declares itself here. Adding a new
 * widget means: create the component, export it from widgets/index.ts,
 * and add its ID to one or more role configs in configs/*.ts. No other
 * files in the app need to be touched. That's the modularity guarantee.
 *
 * Size on the 2-column grid:
 *   1x1 — half-width square-ish card
 *   2x1 — full-width horizontal strip (1 row tall)
 *   1x2 — half-width tall card (2 rows tall)
 *   2x2 — full-width large panel (hero widget)
 *
 * Additional sizes can be added by extending WidgetSize + the Tailwind
 * class map in DashboardGrid.tsx.
 */

import type { ComponentType } from 'react';

export type WidgetSize = '1x1' | '2x1' | '1x2' | '2x2';

/**
 * Role string matches the backend auth model. When a role-scoped role is
 * irrelevant (e.g. "widget for all clients regardless of athlete vs
 * parent flavor"), omit the requiredRole and gate by the role config
 * that includes the widget instead.
 */
export type DashboardRole = 'CLIENT' | 'STAFF' | 'ADMIN' | 'SCHOOL_COACH' | 'OUTSIDE_COACH';

export interface WidgetProps {
  /** Current user's role, for defensive checks inside the widget if needed. */
  role: DashboardRole;
  /** Current user's athlete profile ID for athlete-scoped widgets, null otherwise. */
  athleteId?: string | null;
  /** When true the widget is being shown as a preview/thumb (optional render hint). */
  isPreview?: boolean;
}

/**
 * Canonical widget definition. Every entry in the widget registry
 * conforms to this interface.
 */
export interface WidgetDefinition {
  /** Stable ID used in role configs. kebab-case. e.g. 'upcoming-sessions' */
  id: string;
  /** Human-readable title shown in the widget's default header. */
  title: string;
  /** Default grid size — can be overridden per-use in a role config. */
  defaultSize: WidgetSize;
  /** Roles allowed to see this widget. Omit to allow all. */
  allowedRoles?: DashboardRole[];
  /** The React component that renders the widget body. */
  component: ComponentType<WidgetProps>;
}

/**
 * A single entry in a dashboard role config — refers to a registered
 * widget by id, optionally overriding its size for this placement.
 */
export interface WidgetPlacement {
  id: string;
  /** Override the widget's default size just for this dashboard. */
  size?: WidgetSize;
}

/**
 * A role-specific dashboard — just an ordered list of widget placements.
 * Edit the array to reorder, add, or remove widgets for that role.
 */
export interface DashboardConfig {
  /** Human-readable name, used in the page heading / module documentation. */
  name: string;
  /** Ordered widget list. Rendered top-to-bottom, left-to-right. */
  widgets: WidgetPlacement[];
}
