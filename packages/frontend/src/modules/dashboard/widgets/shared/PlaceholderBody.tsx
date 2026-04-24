/**
 * Shared "not yet implemented" placeholder body used by widgets whose
 * full data source isn't wired yet. Prevents any widget from looking
 * broken while keeping a premium visual footprint.
 *
 * Each widget still has its own dedicated file so it can be replaced
 * with a real implementation independently — this is only a temporary
 * render.
 */

export function PlaceholderBody({
  line,
  cta,
}: {
  line: string;
  cta?: string;
}) {
  return (
    <div className="flex flex-col items-start justify-center h-full min-h-[100px] gap-2">
      <p className="text-sm text-muted leading-snug">{line}</p>
      {cta && (
        <p className="text-[11px] uppercase tracking-[0.14em] text-foreground/60">
          {cta}
        </p>
      )}
    </div>
  );
}
