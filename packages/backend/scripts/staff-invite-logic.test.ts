/**
 * Decision-tree test for the POST /api/staff/invite logic.
 * Mirrors the branches in routes/staff.ts so we can verify them without
 * standing up a real DB. Run with:
 *   ./node_modules/.bin/tsx scripts/staff-invite-logic.test.ts
 */

type Role = 'ADMIN' | 'STAFF' | 'CLIENT';
type Outcome =
  | { kind: 'conflict_active_staff' }
  | { kind: 'conflict_pending_invite' }
  | { kind: 'reinstate' }
  | { kind: 'new_invite' };

/**
 * Pure translation of the real code's branching. If you change the route, update
 * this to keep parity (same shape, no Prisma).
 */
function decide(input: {
  existingUser: { role: Role } | null;
  pendingInvite: { id: string } | null;
}): Outcome {
  const { existingUser, pendingInvite } = input;

  if (existingUser && (existingUser.role === 'ADMIN' || existingUser.role === 'STAFF')) {
    return { kind: 'conflict_active_staff' };
  }
  if (existingUser && existingUser.role === 'CLIENT') {
    return { kind: 'reinstate' };
  }
  if (pendingInvite) {
    return { kind: 'conflict_pending_invite' };
  }
  return { kind: 'new_invite' };
}

type Case = {
  label: string;
  input: Parameters<typeof decide>[0];
  want: Outcome['kind'];
};

const cases: Case[] = [
  {
    label: 'brand-new person → new invite',
    input: { existingUser: null, pendingInvite: null },
    want: 'new_invite',
  },
  {
    label: 'email is an active STAFF → conflict',
    input: { existingUser: { role: 'STAFF' }, pendingInvite: null },
    want: 'conflict_active_staff',
  },
  {
    label: 'email is an active ADMIN → conflict',
    input: { existingUser: { role: 'ADMIN' }, pendingInvite: null },
    want: 'conflict_active_staff',
  },
  {
    label: 'email is a CLIENT (previously soft-removed staff) → reinstate',
    input: { existingUser: { role: 'CLIENT' }, pendingInvite: null },
    want: 'reinstate',
  },
  {
    label: 'email is a real client being hired → reinstate (same path, preserves login)',
    input: { existingUser: { role: 'CLIENT' }, pendingInvite: null },
    want: 'reinstate',
  },
  {
    label: 'no user but a pending invite exists → conflict',
    input: { existingUser: null, pendingInvite: { id: 'inv-1' } },
    want: 'conflict_pending_invite',
  },
  {
    label: 'CLIENT user AND pending invite → reinstate takes priority (user outranks invite row)',
    input: { existingUser: { role: 'CLIENT' }, pendingInvite: { id: 'inv-1' } },
    want: 'reinstate',
  },
  {
    label: 'active STAFF AND pending invite → conflict, not reinstate',
    input: { existingUser: { role: 'STAFF' }, pendingInvite: { id: 'inv-1' } },
    want: 'conflict_active_staff',
  },
];

let failed = 0;
for (const c of cases) {
  const got = decide(c.input).kind;
  const ok = got === c.want;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${c.label}  got=${got}  want=${c.want}`);
  if (!ok) failed++;
}

if (failed) {
  console.log(`\n${failed} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nAll staff-invite branching assertions passed.');
