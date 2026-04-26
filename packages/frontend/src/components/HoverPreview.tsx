'use client';

/**
 * Hover-preview popover (#P14 / PREMIUM_AUDIT).
 *
 * Wrap a name/link with <HoverPreview entity={...}>...</HoverPreview>
 * to surface a popover after a 350ms hover. The popover lazy-fetches
 * /api/lookup/{kind}/{id} on first hover and caches the result for the
 * lifetime of the component. Skips rendering on touch devices (no real
 * hover).
 *
 * Premium feel:
 *   - Skeleton-matched while loading (no layout shift inside the popover).
 *   - 350ms open delay so quick mouse-overs don't fire spurious popovers.
 *   - Smart edge-flip: popover positions below by default, flips above
 *     if it'd overflow the viewport.
 *   - Backdrop-blur frosted treatment to match the rest of the premium
 *     polish.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';

type LeadPayload = NonNullable<Awaited<ReturnType<typeof api.lookupLead>>['data']>;
type UserPayload = NonNullable<Awaited<ReturnType<typeof api.lookupUser>>['data']>;
type Payload = LeadPayload | UserPayload;

const HOVER_OPEN_MS = 350;
const HOVER_CLOSE_MS = 120;

export interface HoverPreviewProps {
  entity: { kind: 'lead' | 'user'; id: string };
  children: ReactNode;
  className?: string;
}

export function HoverPreview({ entity, children, className }: HoverPreviewProps) {
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [placement, setPlacement] = useState<'below' | 'above'>('below');

  // Skip on touch-primary devices — popovers fight finger taps.
  const [supportsHover, setSupportsHover] = useState(true);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(hover: hover)');
    setSupportsHover(mql.matches);
  }, []);

  useEffect(() => {
    if (!open || data || error) return;
    let cancelled = false;
    const fetcher = entity.kind === 'lead' ? api.lookupLead(entity.id) : api.lookupUser(entity.id);
    fetcher
      .then((res) => {
        if (cancelled) return;
        if (res.data) setData(res.data as Payload);
        else setError('Not found');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Lookup failed');
      });
    return () => {
      cancelled = true;
    };
  }, [open, data, error, entity.kind, entity.id]);

  // After the popover renders, decide whether to flip above the trigger.
  useEffect(() => {
    if (!open || !popRef.current || !wrapRef.current) return;
    const rect = popRef.current.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 8) {
      setPlacement('above');
    } else {
      setPlacement('below');
    }
  }, [open, data]);

  const scheduleOpen = () => {
    if (!supportsHover) return;
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (open) return;
    openTimer.current = window.setTimeout(() => setOpen(true), HOVER_OPEN_MS);
  };
  const scheduleClose = () => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    closeTimer.current = window.setTimeout(() => setOpen(false), HOVER_CLOSE_MS);
  };

  useEffect(
    () => () => {
      if (openTimer.current !== null) window.clearTimeout(openTimer.current);
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    },
    []
  );

  return (
    <span
      ref={wrapRef}
      onMouseEnter={scheduleOpen}
      onMouseLeave={scheduleClose}
      onFocus={scheduleOpen}
      onBlur={scheduleClose}
      className={`relative inline ${className ?? ''}`}
    >
      {children}
      {open && (
        <div
          ref={popRef}
          onMouseEnter={scheduleOpen}
          onMouseLeave={scheduleClose}
          role="tooltip"
          className={`absolute z-40 left-0 w-[280px] rounded-xl border border-border bg-background/95 backdrop-blur-md shadow-2xl shadow-black/40 p-3 text-sm text-foreground animate-[fadeIn_140ms_ease-out_forwards] ${
            placement === 'below' ? 'top-full mt-2' : 'bottom-full mb-2'
          }`}
        >
          <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: translateY(0); } }`}</style>
          {!data && !error && <PreviewSkeleton />}
          {error && (
            <p className="text-xs text-muted">Couldn’t load preview.</p>
          )}
          {data?.kind === 'lead' && <LeadBody lead={data} />}
          {data?.kind === 'user' && <UserBody user={data} />}
        </div>
      )}
    </span>
  );
}

function PreviewSkeleton() {
  return (
    <div className="space-y-2">
      <div className="ppl-skeleton h-4 w-32 rounded" />
      <div className="ppl-skeleton h-3 w-48 rounded" />
      <div className="ppl-skeleton h-3 w-40 rounded" />
    </div>
  );
}

function LeadBody({ lead }: { lead: LeadPayload }) {
  const scoreTier =
    lead.score >= 70 ? 'text-emerald-400' : lead.score >= 40 ? 'text-amber-400' : 'text-muted';
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold truncate">{lead.name}</p>
        {lead.score > 0 && (
          <span className={`text-[10px] uppercase tracking-wider font-bold ${scoreTier}`}>
            Score {lead.score}
          </span>
        )}
      </div>
      <p className="text-xs text-muted truncate">{lead.email}</p>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <Field k="Stage" v={lead.stage.replace(/_/g, ' ').toLowerCase()} />
        <Field k="Source" v={lead.source.replace(/_/g, ' ').toLowerCase()} />
        {lead.ownerName && <Field k="Owner" v={lead.ownerName} />}
        {lead.nextFollowUpAt && (
          <Field k="Follow-up" v={new Date(lead.nextFollowUpAt).toLocaleDateString()} />
        )}
        <Field k="Activity" v={`${lead.activityCount} entries`} />
        <Field k="Tags" v={`${lead.tagCount}`} />
      </div>
    </div>
  );
}

function UserBody({ user }: { user: UserPayload }) {
  const churnTier =
    user.churnRiskScore >= 70
      ? 'text-red-400'
      : user.churnRiskScore >= 40
        ? 'text-amber-400'
        : 'text-emerald-400';
  return (
    <div>
      <div className="flex items-start gap-2">
        <div className="w-8 h-8 rounded-full bg-surface-hover flex items-center justify-center text-xs font-bold text-muted flex-shrink-0">
          {user.name
            .split(' ')
            .map((n) => n[0])
            .join('')
            .slice(0, 2)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">{user.name}</p>
          <p className="text-xs text-muted truncate">{user.email}</p>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <Field k="Role" v={user.role.toLowerCase()} />
        {user.homeLocationName && <Field k="Location" v={user.homeLocationName} />}
        {user.ageGroup && <Field k="Age" v={user.ageGroup} />}
        {user.membership ? (
          <>
            <Field k="Plan" v={user.membership.planName} />
            <Field k="Status" v={user.membership.status.toLowerCase()} />
          </>
        ) : (
          <Field k="Plan" v="—" />
        )}
        <Field k="Bookings" v={`${user.bookingCount}`} />
        <Field k="Churn" v={`${user.churnRiskScore}`} valueClass={churnTier} />
      </div>
      {!user.isActive && (
        <p className="mt-2 text-[10px] uppercase tracking-wider text-amber-400">
          Account archived
        </p>
      )}
    </div>
  );
}

function Field({ k, v, valueClass }: { k: string; v: string; valueClass?: string }) {
  return (
    <>
      <span className="text-muted uppercase tracking-wider text-[10px]">{k}</span>
      <span className={`text-right truncate ${valueClass ?? 'text-foreground/90'}`}>{v}</span>
    </>
  );
}
