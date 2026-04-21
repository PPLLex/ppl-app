/**
 * Hand-runnable assertions for the rooms helper — no test runner required.
 * Run with:  tsx packages/frontend/src/lib/rooms.test.ts
 *
 * Keeping this as a plain script means we don't have to add Jest/Vitest to
 * the frontend just to verify this one helper. If the repo adopts a test
 * runner later, these cases drop straight in.
 */
import {
  roomBucket,
  filterSessionsByRoom,
  spotsStatus,
  spotsLabel,
  spotsLabelShort,
  defaultRoomFilter,
} from './rooms';
import type { Room } from './api';

function eq<T>(label: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${label}  got=${JSON.stringify(got)}  want=${JSON.stringify(want)}`);
  if (!ok) process.exitCode = 1;
}

// --- roomBucket -----------------------------------------------------------
eq('roomBucket 13+', roomBucket({ name: '13+' }), 'teen');
eq(
  'roomBucket long-form 13+',
  roomBucket({ name: '13+ (Middle School, High School, College, and Pro)' }),
  'teen'
);
eq('roomBucket 13 + with space', roomBucket({ name: '13 + Advanced' }), 'teen');
eq('roomBucket Youth', roomBucket({ name: 'Youth' }), 'youth');
eq('roomBucket Youth (12 & Under)', roomBucket({ name: 'Youth (12 & Under)' }), 'youth');
eq('roomBucket case-insensitive Youth', roomBucket({ name: 'youth' }), 'youth');
eq('roomBucket other', roomBucket({ name: 'Turf Field 1' }), 'other');
eq('roomBucket nullish', roomBucket(null), 'other');

// --- filterSessionsByRoom -------------------------------------------------
const mk = (id: string, name?: string) => ({
  id,
  room: name ? ({ id: 'r', name, sortOrder: 0 } as Room) : undefined,
});
const sessions = [mk('a', '13+'), mk('b', 'Youth'), mk('c', 'Turf'), mk('d')];
eq(
  'filter all',
  filterSessionsByRoom(sessions, 'all').map((s) => s.id),
  ['a', 'b', 'c', 'd']
);
eq(
  'filter teen',
  filterSessionsByRoom(sessions, 'teen').map((s) => s.id),
  ['a']
);
eq(
  'filter youth',
  filterSessionsByRoom(sessions, 'youth').map((s) => s.id),
  ['b']
);

// --- spotsStatus ----------------------------------------------------------
eq('status full', spotsStatus(0, 6), 'full');
eq('status last', spotsStatus(1, 6), 'last');
eq('status filling 2/6', spotsStatus(2, 6), 'filling');
eq('status open 3/6', spotsStatus(3, 6), 'open');
eq('status open 6/6', spotsStatus(6, 6), 'open');
eq('status negative guard', spotsStatus(-1, 6), 'full');

// --- spotsLabel -----------------------------------------------------------
eq('label full', spotsLabel(0, 6), 'Full');
eq('label last', spotsLabel(1, 6), '1 spot left');
eq('label open', spotsLabel(3, 6), '3 of 6 spots open');
eq('label short full', spotsLabelShort(0, 6), 'Full');
eq('label short 2/6', spotsLabelShort(2, 6), '2/6');

// --- defaultRoomFilter ----------------------------------------------------
eq('client youth', defaultRoomFilter({ role: 'CLIENT', ageGroup: 'youth' }), 'youth');
eq('client ms_hs', defaultRoomFilter({ role: 'CLIENT', ageGroup: 'ms_hs' }), 'teen');
eq('client college', defaultRoomFilter({ role: 'CLIENT', ageGroup: 'college' }), 'teen');
eq('client unknown age defaults teen', defaultRoomFilter({ role: 'CLIENT', ageGroup: null }), 'teen');
eq('admin default all', defaultRoomFilter({ role: 'ADMIN', ageGroup: null }), 'all');
eq('staff default all', defaultRoomFilter({ role: 'STAFF', ageGroup: null }), 'all');

if (process.exitCode) {
  console.log('\nSome assertions failed.');
} else {
  console.log('\nAll rooms-helper assertions passed.');
}
