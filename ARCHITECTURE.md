# PPL App — Architecture

This doc is the reference for how the PPL app is structured. Read this before
adding new models, routes, or frontend pages so you don't accidentally work
against the multi-company design. Anything here overrides older conventions
in CLAUDE.md.

---

## Why this exists

PPL's app isn't just for Pitching Performance Lab. It's the shared backend and
frontend codebase for a small family of companies:

| Org slug              | Full name                     | Notes                                                   |
|-----------------------|-------------------------------|---------------------------------------------------------|
| `ppl`                 | Pitching Performance Lab      | Pitching training. The first org built out.             |
| `hpl`                 | Hitting Performance Lab       | Hitting training. Sub-brand for HPL Youth lives under it (ageGroup distinction, not a separate org). |
| `hpl-youth`           | HPL Youth                     | Present as a convenience row but effectively subsumed by `hpl` + ageGroup. Kept for clarity, may be removed once the ageGroup approach proves out. |
| `renewed-performance` | Renewed Performance           | Physical therapist. Provides pitching/movement screenings for PPL and HPL. No client-facing memberships — PPL pays RP per completed screening. |

Each company will eventually get its own branded frontend domain
(`app.pitchingperformancelab.com`, `app.hittingperformancelab.com`, etc.) but
all frontends talk to the **same backend and the same database**. That's the
only way to keep session capacity, bookings, and rosters correctly
synchronized in real time across apps — if a client books a 3:30 PM HPL
hitting session from the PPL app, the HPL app sees one spot taken instantly
because it's reading the same row.

---

## The `Organization` model

Every business entity is tagged with an **`organizationId`**. That's the
primary scoping mechanism. Backend routes filter by `organizationId` before
returning any data, so the PPL app only sees PPL data even though the
database is shared. Rules for adding `organizationId`:

### Add it directly when…

The model will frequently be filtered by org in a query. Direct column +
index is cheaper than joining through a parent. These are the tables that
MUST have a direct `organizationId`:

- `Location`
- `Session`
- `SessionTypeConfig`
- `MembershipPlan`
- `WeeklyCredit`
- `OnboardingRecord`
- `ScheduleTemplate`
- `StaffInvite`
- `Family`
- `SchoolTeam`
- `FormTemplate`
- `Program`

Other tables added in the future should follow the same test: "will any
route filter this by org?" — if yes, direct FK.

### Skip the direct column when…

The model is always 1–2 hops from a parent that already has `organizationId`.
Inheriting via FK chain avoids duplication. These models intentionally do NOT
have their own `organizationId`:

| Model            | Inherits org via        |
|------------------|-------------------------|
| `Room`           | `Location`              |
| `Booking`        | `Session`               |
| `CreditTransaction` | `WeeklyCredit` → plan |
| `Payment`        | `ClientMembership` → plan |
| `CoachNote`      | `Session`               |
| `AthleteMetric`  | `AthleteProfile`        |
| `AuditLog`       | scoped separately (per-acting-user)  |

### User is special

Users can belong to multiple orgs — a client might have a PPL membership AND
an HPL membership, for instance. Users therefore do NOT have a direct
`organizationId`. Their org membership is inferred from their
`ClientMembership` rows (each with its own `planId → MembershipPlan.organizationId`)
and, for staff, their `StaffLocation` rows.

---

## How org context flows through a request

```
Client's browser
  │  [ domain: app.pitchingperformancelab.com ]
  ▼
Frontend OrgContext (contexts/OrgContext.tsx)
  │  Reads domain → resolves to org slug 'ppl'
  │  Attaches 'X-Organization: ppl' header to every api.ts fetch
  ▼
Backend orgContext middleware (middleware/orgContext.ts)
  │  Reads header, falls back to JWT, falls back to user's primary org
  │  Attaches req.org { id, slug, ... } to the request
  ▼
Route handler
  │  All queries include `where: { organizationId: req.org.id }`
  ▼
Response filtered to that org
```

**Never** write a route that returns `prisma.session.findMany()` without a
`where.organizationId`. Code review catches this; lint rule may be added
later.

---

## Memberships across orgs

**Single-org membership (most common).** A `MembershipPlan` with
`organizationId = 'ppl'`. Client subscribes, gets a `ClientMembership` +
`WeeklyCredit` rows scoped to PPL. Their credits work only on PPL sessions.

**Joint membership (phase 2).** A `MembershipBundle` wraps multiple underlying
plans. When a client subscribes to "Pitching + Hitting 1x/week":
1. Single Stripe charge goes to the originating app's Stripe account (whichever
   app the client signed up through).
2. Backend creates TWO `ClientMembership` rows — one linked to the PPL plan,
   one linked to the HPL plan.
3. Two separate `WeeklyCredit` pools are created — 1 PPL credit, 1 HPL credit
   per week. Credits are tied to the `organizationId` of their underlying
   plan, so they can't cross-pollinate (a PPL credit cannot book an HPL session).

**Revenue reconciliation (phase 2).** Because one Stripe account collected
money for services that span orgs, a revenue ledger tracks how much is owed
between orgs. Example: a client signs up on PPL's app for a $140 joint plan.
PPL's Stripe collects $140. The ledger records that HPL is owed $70/week.
Chad and HPL's owner settle up offline based on the ledger. See
`services/revenueLedger.ts` (phase 2).

---

## Renewed Performance ledger

Renewed Performance (`renewed-performance` org) does NOT sell memberships
to clients. PPL pays RP directly under a fixed-fee arrangement:

- **$300 per new-athlete onboarding screening** (gross — RP receives the
  amount minus Stripe's processing fee)
- **$50 per returning-athlete re-screen**

Payout only triggers when ALL THREE gates are cleared:
1. Athlete paid successfully (Stripe invoice marked paid)
2. Athlete marked present at the screening session
3. Cory (RP owner) submitted feedback / screening update for the athlete

This forces accountability — Cory has to actually do the work to get paid. See
`services/screeningLedger.ts` (phase 3).

---

## Phases of buildout

**Phase 1 — Schema + bootstrap.** `Organization` model exists, 4 orgs seeded,
every direct-orgId table has its column populated with `'ppl'` for existing
data. Backend and frontend still effectively single-tenant but the layer is
in place. This is the current state.

**Phase 2 — Backend scoping + multi-service UI.** `orgContext` middleware,
routes filtered, JWT carries orgs, frontend `OrgContext`, `OrgPicker` for
multi-service booking UX, `MembershipBundle` data model, revenue ledger.

**Phase 3 — Renewed Performance.** `SCREENING` session type, `SCREENING_PROVIDER`
role for Cory, screening ledger, feedback-triggered payout flow, admin view
of "amount owed to RP this month".

**Phase 4 — HPL frontend domain.** Spin up the HPL-branded frontend at
`app.hittingperformancelab.com`, same backend. `SessionType` enum expanded
for hitting session types. Joint membership bundles go live.

**Phase 5 — Pro perks / discount credits.** Pro tier athletes can earn
discounts on their monthly membership by doing things that help PPL grow:
social media posts, Google reviews, helping run group sessions, giving
private lessons at the facility. Each earned credit is a row in
`ProPerkCredit` with a reason code, dollar amount, admin approver, proof
link/notes, and an `appliedToInvoiceId` that is null until it's applied.
At billing time, the stripeService looks up unapplied credits for the Pro
athlete and issues a one-time invoice line-item discount equal to the sum
(capped at the invoice total). Needs a simple admin UI to log a new credit
and a Pro-facing "credits on your account" view. Reason codes (not final):
`SOCIAL_MEDIA_POST`, `GOOGLE_REVIEW`, `COACHED_GROUP_SESSION`,
`TAUGHT_PRIVATE_LESSON`, `OTHER`.

---

## File organization

Any new files related to the multi-org layer live in these locations so the
codebase stays navigable:

```
ppl-app/
├── ARCHITECTURE.md                     ← this file
├── CLAUDE.md                           ← shorter day-to-day reference, defers to ARCHITECTURE.md
└── packages/
    ├── backend/
    │   ├── prisma/schema.prisma        ← Organization model + orgId columns
    │   └── src/
    │       ├── middleware/
    │       │   └── orgContext.ts       ← attaches req.org (Phase 2)
    │       ├── services/
    │       │   ├── orgService.ts       ← lookup + user-to-org mapping (Phase 2)
    │       │   ├── revenueLedger.ts    ← cross-org reconciliation (Phase 2)
    │       │   └── screeningLedger.ts  ← Renewed Performance payouts (Phase 3)
    │       ├── routes/
    │       │   └── organizations.ts    ← admin CRUD for orgs (Phase 2)
    │       └── scripts/
    │           └── bootstrap-organizations.ts  ← runs on deploy (Phase 1)
    └── frontend/
        └── src/
            ├── contexts/
            │   └── OrgContext.tsx      ← current active org (Phase 2)
            ├── lib/
            │   └── orgs.ts             ← branding helpers (Phase 2)
            └── components/org/         ← OrgLogo, OrgPicker, OrgSwitcher (Phase 2)
```

**Naming convention:** anything that touches the org layer should have `org`
in the path or filename, so it's findable with `grep -r org packages/`. If you
add cross-org accounting, call it `inter-org-*` so it's clear.

---

## Working rules for future features

1. **Every new model** that represents a business entity gets `organizationId`
   directly OR explicitly inherits via a documented FK chain. Never orgless
   by accident.
2. **Every new route** that returns business data filters by `req.org.id`.
   No exceptions.
3. **Every new frontend feature** reads the current org from `useOrg()`
   instead of assuming PPL.
4. **Renewed Performance** and **joint memberships** are their own files
   (`screeningLedger.ts`, `membershipBundles.ts`) — don't stuff their
   logic into unrelated routes.
5. **Stripe accounts are per-org.** The `Organization.stripeAccountId`
   field determines where a charge for that org lands. Joint memberships
   use the ORIGINATING app's Stripe account for the full charge; the
   revenue ledger tracks what's owed to the other orgs.
6. **Seed data** (`prisma/seed.ts`) and the live-DB bootstrap script
   (`scripts/bootstrap-organizations.ts`) must both create the same 4 orgs
   with the same slugs as primary keys.
