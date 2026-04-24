'use client';

/**
 * DashboardGrid — renders a role's widget list in a responsive grid.
 *
 * The grid is 2 columns on desktop, 1 column on mobile. Widget sizes:
 *   1x1 — 1 column, 1 row
 *   2x1 — 2 columns (full width), 1 row    (e.g. hero strip)
 *   1x2 — 1 column, 2 rows                 (e.g. side panel)
 *   2x2 — 2 columns, 2 rows                (hero card)
 *
 * Widgets that don't exist in the registry are silently skipped (so a
 * bad config never crashes the page). Widgets requiring a role the
 * current user doesn't have are also skipped defensively — the config
 * is the primary gate but this is belt-and-suspenders.
 */

import { getWidget } from './registry';
import type { DashboardConfig, DashboardRole, WidgetSize } from './types';

const SIZE_CLASSES: Record<WidgetSize, string> = {
  '1x1': 'col-span-1 row-span-1',
  '2x1': 'col-span-1 md:col-span-2 row-span-1',
  '1x2': 'col-span-1 row-span-2',
  '2x2': 'col-span-1 md:col-span-2 row-span-2',
};

export interface DashboardGridProps {
  config: DashboardConfig;
  role: DashboardRole;
  /** Current athlete profile id for athlete-scoped widgets. */
  athleteId?: string | null;
  /** Optional page heading override. Defaults to config.name. */
  heading?: string;
  /** Optional subheading under the page title. */
  subheading?: string;
}

export function DashboardGrid({
  config,
  role,
  athleteId = null,
  heading,
  subheading,
}: DashboardGridProps) {
  const placements = config.widgets
    .map((p) => {
      const def = getWidget(p.id);
      if (!def) return null;
      // Role gate — if the widget restricts roles, skip when the user's
      // role isn't allowed. Prevents leaking widgets in mis-configured
      // role configs.
      if (def.allowedRoles && !def.allowedRoles.includes(role)) {
        return null;
      }
      return { def, size: (p.size ?? def.defaultSize) as WidgetSize };
    })
    .filter((x): x is { def: NonNullable<ReturnType<typeof getWidget>>; size: WidgetSize } =>
      x !== null
    );

  return (
    <div className="space-y-6">
      {heading && (
        <div>
          <h1 className="font-display text-2xl uppercase tracking-[0.04em] text-foreground">
            {heading}
          </h1>
          {subheading && (
            <p className="text-sm text-muted mt-1">{subheading}</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 auto-rows-[minmax(140px,auto)] gap-4">
        {placements.map(({ def, size }) => {
          const WidgetComponent = def.component;
          return (
            <section
              key={def.id}
              className={`ppl-card ppl-fade-in ${SIZE_CLASSES[size]}`}
              aria-labelledby={`widget-${def.id}-title`}
            >
              <header className="flex items-center justify-between mb-3">
                <h2
                  id={`widget-${def.id}-title`}
                  className="font-display uppercase tracking-[0.06em] text-foreground/90 text-xs"
                >
                  {def.title}
                </h2>
              </header>
              <WidgetComponent role={role} athleteId={athleteId} />
            </section>
          );
        })}
      </div>

      {placements.length === 0 && (
        <div className="ppl-card text-center py-12">
          <p className="text-sm text-muted">
            No widgets configured for your account yet.
          </p>
        </div>
      )}
    </div>
  );
}
