/**
 * Idempotency check for the room-name matchers in backfill-default-rooms.ts.
 * We don't want to hit a real DB here; instead we mirror the matcher logic and
 * verify it classifies both old and new room names correctly. Run with:
 *   ../backend/node_modules/.bin/tsx scripts/backfill-default-rooms.test.ts
 */

function isTeenRoom(name: string): boolean {
  return /^\s*13\s*\+/i.test(name.trim());
}
function isYouthRoom(name: string): boolean {
  return /^\s*youth\b/i.test(name.trim());
}

type Case = { rooms: string[]; hasTeen: boolean; hasYouth: boolean; label: string };

const cases: Case[] = [
  {
    label: 'brand-new location (no rooms yet)',
    rooms: [],
    hasTeen: false,
    hasYouth: false,
  },
  {
    label: 'old short names (like current Lexington / Louisville would be)',
    rooms: ['13+', 'Youth'],
    hasTeen: true,
    hasYouth: true,
  },
  {
    label: 'new long-form names (freshly created post-change)',
    rooms: ['13+ (Middle School, High School, College, and Pro)', 'Youth'],
    hasTeen: true,
    hasYouth: true,
  },
  {
    label: 'only a 13+ room (needs Youth backfill)',
    rooms: ['13+'],
    hasTeen: true,
    hasYouth: false,
  },
  {
    label: 'only a Youth room (needs 13+ backfill)',
    rooms: ['Youth (12 & Under)'],
    hasTeen: false,
    hasYouth: true,
  },
  {
    label: 'unrelated rooms do not trigger false positives',
    rooms: ['Turf', 'Cage 1', 'Mound Room'],
    hasTeen: false,
    hasYouth: false,
  },
  {
    label: 'case and spacing tolerance',
    rooms: ['  13 + Advanced', 'youth  '],
    hasTeen: true,
    hasYouth: true,
  },
];

let failed = 0;
for (const c of cases) {
  const hasTeen = c.rooms.some(isTeenRoom);
  const hasYouth = c.rooms.some(isYouthRoom);
  const ok = hasTeen === c.hasTeen && hasYouth === c.hasYouth;
  console.log(
    `[${ok ? 'PASS' : 'FAIL'}] ${c.label}  detected teen=${hasTeen} youth=${hasYouth}`
  );
  if (!ok) failed += 1;
}

// Re-run idempotency: if we add defaults in the second pass for the "brand new" case,
// a third pass should detect both and do nothing.
const afterFirstPass = [
  '13+ (Middle School, High School, College, and Pro)',
  'Youth',
];
const secondPassTeen = afterFirstPass.some(isTeenRoom);
const secondPassYouth = afterFirstPass.some(isYouthRoom);
const idempotent = secondPassTeen && secondPassYouth;
console.log(
  `[${idempotent ? 'PASS' : 'FAIL'}] re-run after first backfill is a no-op (teen=${secondPassTeen}, youth=${secondPassYouth})`
);
if (!idempotent) failed += 1;

if (failed > 0) {
  console.log(`\n${failed} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nAll backfill matcher assertions passed.');
