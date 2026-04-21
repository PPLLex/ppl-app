/**
 * Room / capacity helpers shared by every calendar view.
 *
 * PPL's scheduling model uses two default "rooms" per location — the 13+
 * calendar and the Youth calendar — and we want every schedule surface to
 * render the same filter chips and spots-left pill. Centralizing these
 * helpers keeps the UX consistent and makes it trivial to add a 3rd or 4th
 * default room later.
 */
import type { Room } from '@/lib/api';

export type RoomBucket = 'teen' | 'youth' | 'other';

/** Classify a room by name so we can offer a 13+ / Youth / All filter. */
export function roomBucket(room: { name: string } | null | undefined): RoomBucket {
  if (!room) return 'other';
  const name = room.name.trim();
  if (/^13\s*\+/.test(name)) return 'teen';
  if (/^youth\b/i.test(name)) return 'youth';
  return 'other';
}

/** Short label used on filter chips and compact badges. */
export function roomChipLabel(bucket: RoomBucket): string {
  switch (bucket) {
    case 'teen':
      return '13+';
    case 'youth':
      return 'Youth';
    default:
      return 'Other';
  }
}

/** Full label for places where space isn't tight (e.g. tooltip, header). */
export function roomFullLabel(bucket: RoomBucket): string {
  switch (bucket) {
    case 'teen':
      return '13+ (Middle School, High School, College, and Pro)';
    case 'youth':
      return 'Youth (12 and Under)';
    default:
      return 'Other';
  }
}

export type RoomFilter = 'all' | RoomBucket;

/**
 * Decide the default room filter for a given viewer.
 *
 *  - Clients: auto-pick the calendar that matches the athlete's age. If the
 *    age isn't known, default to "teen" because the vast majority of PPL
 *    clients are 13+.
 *  - Coaches and admins: default to "all" so they can see the full day.
 */
export function defaultRoomFilter(opts: {
  role?: 'CLIENT' | 'STAFF' | 'TRAINER' | 'ADMIN' | 'YOUTH_COORDINATOR' | string;
  ageGroup?: 'youth' | 'ms_hs' | 'college' | null;
}): RoomFilter {
  if (opts.role === 'CLIENT') {
    if (opts.ageGroup === 'youth') return 'youth';
    return 'teen';
  }
  return 'all';
}

/**
 * Color-coded "spots left" pill.
 *
 * We bucket into 4 states so the calendar is scannable at a glance:
 *   - open:   >= 50% of capacity still open (green)
 *   - filling: 1 < spots < 50% capacity (amber)
 *   - last:   exactly 1 spot left (orange-red, draw the eye)
 *   - full:   no spots left (red, muted)
 */
export type SpotsStatus = 'open' | 'filling' | 'last' | 'full';

export function spotsStatus(spotsRemaining: number, maxCapacity: number): SpotsStatus {
  if (spotsRemaining <= 0) return 'full';
  if (spotsRemaining === 1) return 'last';
  if (maxCapacity > 0 && spotsRemaining / maxCapacity < 0.5) return 'filling';
  return 'open';
}

export function spotsLabel(spotsRemaining: number, maxCapacity: number): string {
  if (spotsRemaining <= 0) return 'Full';
  if (spotsRemaining === 1) return '1 spot left';
  return `${spotsRemaining} of ${maxCapacity} spots open`;
}

/** Short label for tight spaces (calendar grid cells). */
export function spotsLabelShort(spotsRemaining: number, maxCapacity: number): string {
  if (spotsRemaining <= 0) return 'Full';
  return `${spotsRemaining}/${maxCapacity}`;
}

/** Tailwind classes for the pill background/text. */
export function spotsPillClasses(status: SpotsStatus): string {
  switch (status) {
    case 'open':
      return 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30';
    case 'filling':
      return 'bg-amber-500/15 text-amber-400 border border-amber-500/30';
    case 'last':
      return 'bg-orange-500/15 text-orange-400 border border-orange-500/30';
    case 'full':
      return 'bg-red-500/10 text-red-400/80 border border-red-500/20';
  }
}

/**
 * Filter a list of sessions by a RoomFilter setting.
 * If `filter === 'all'` (or session has no room at all), every session passes.
 */
export function filterSessionsByRoom<T extends { room?: Room | null }>(
  sessions: T[],
  filter: RoomFilter
): T[] {
  if (filter === 'all') return sessions;
  return sessions.filter((s) => roomBucket(s.room) === filter);
}
