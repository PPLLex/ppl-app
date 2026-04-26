'use client';

/**
 * Right-click context menu (#U10 / PREMIUM_AUDIT).
 *
 * Wrap a list row in <ContextMenu items={...}>...</ContextMenu>. Right-
 * clicking inside the wrapped area opens a styled popover with the
 * supplied actions. Closes on outside click, Escape, scroll, or selection.
 *
 * Items are ANY shape — { label, onSelect, icon?, danger?, hrefNewTab? }.
 * Pass hrefNewTab when the action is just "open this URL in a new tab"
 * — the component handles cmd-click semantics itself.
 *
 * Skips entirely on touch devices: mobile users have no right-click,
 * and we don't want to commandeer their long-press.
 */

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

export interface ContextMenuItem {
  label: string;
  onSelect?: () => void;
  /** Shortcut for "open in new tab". Mutually exclusive with onSelect. */
  hrefNewTab?: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}

export interface ContextMenuProps {
  items: ContextMenuItem[];
  /** Single child — the area that should listen for right-clicks. */
  children: ReactElement<{
    onContextMenu?: (e: ReactMouseEvent) => void;
  }>;
}

export function ContextMenu({ items, children }: ContextMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const popRef = useRef<HTMLDivElement | null>(null);

  // Touch-primary detection — same approach as HoverPreview.
  const [supportsHover, setSupportsHover] = useState(true);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setSupportsHover(window.matchMedia('(hover: hover)').matches);
  }, []);

  const handleContextMenu = useCallback(
    (e: ReactMouseEvent) => {
      if (!supportsHover) return; // touch device, fall through to native menu
      if (items.length === 0) return;
      e.preventDefault();
      // Edge-flip: clamp x/y so the menu never overflows the viewport.
      const w = 220;
      const h = items.length * 32 + 12;
      const x = Math.min(e.clientX, window.innerWidth - w - 8);
      const y = Math.min(e.clientY, window.innerHeight - h - 8);
      setPos({ x, y });
      setOpen(true);
    },
    [items.length, supportsHover]
  );

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onDocClick = (e: globalThis.MouseEvent) => {
      if (popRef.current && popRef.current.contains(e.target as Node)) return;
      close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDocClick);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  // Inject onContextMenu onto the single child.
  const trigger = isValidElement(children)
    ? cloneElement(children, {
        onContextMenu: (e: ReactMouseEvent) => {
          handleContextMenu(e);
          // If the child had its own onContextMenu, fire it after.
          children.props.onContextMenu?.(e);
        },
      })
    : children;

  const runItem = (item: ContextMenuItem) => {
    setOpen(false);
    if (item.disabled) return;
    if (item.hrefNewTab) {
      window.open(item.hrefNewTab, '_blank', 'noopener,noreferrer');
      return;
    }
    item.onSelect?.();
  };

  return (
    <>
      {trigger}
      {open && (
        <div
          ref={popRef}
          role="menu"
          className="fixed z-50 w-[220px] rounded-lg border border-border bg-background/95 backdrop-blur-md shadow-2xl shadow-black/40 py-1 animate-[menuIn_120ms_ease-out_forwards]"
          style={{ left: pos.x, top: pos.y }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <style>{`@keyframes menuIn { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }`}</style>
          {items.map((item, idx) => (
            <button
              key={`${item.label}-${idx}`}
              type="button"
              role="menuitem"
              onClick={() => runItem(item)}
              disabled={item.disabled}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors disabled:opacity-40 ${
                item.danger
                  ? 'text-danger hover:bg-danger/10'
                  : 'text-foreground hover:bg-surface-hover'
              }`}
            >
              {item.icon && <span className="w-4 h-4 flex-shrink-0">{item.icon}</span>}
              <span className="flex-1 truncate">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
