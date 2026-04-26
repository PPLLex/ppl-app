# PPL App — Session Handoff

Drop this whole file into the next Cowork chat (or just point at it) and the
new session will have full context. It's the single source of truth for
what's shipped, what's queued, what direction we're heading, and how I work.

---

## Vision (don't lose this)

Chad is building **the PPL App** — the one-stop platform for Pitching
Performance Lab. Originally just a scheduling replacement for Swift
(`admin.runswiftapp.com`), it has expanded into a full ops platform:
scheduling + payments + memberships + CRM + marketing + workflows +
forms + referrals + AI assists.

**Two priorities are equally weighted:**

1. **Premium experience to match a premium service.** Every interaction
   should feel like Linear / Stripe / Vercel — fast, polished,
   delightful. Skeleton screens, animated counters, gradient accents,
   Cmd-K palette, sound design, microinteractions. Never a bare spinner,
   never a dead-end empty state.

2. **Operationally complete.** Anything PPL does today across Swift +
   GoHighLevel + Stripe + email tools should land in the app. The CRM,
   marketing, workflow engine, and forms work was all about absorbing
   GHL parity. Membership pause + referrals + promo codes are about
   running real growth motions.

This is **not** a SaaS product for sale. It's PPL's internal-facing
business operating system + customer-facing app. PPL serves athletes
across multiple orgs (PPL, with HPL queued) — every data model is
already org-scoped via `organizationId`.

---

## Tech stack

```
Frontend  : Next.js 16 (App Router), React 19, TypeScript, Tailwind v4
            Hosted on Vercel. Stripe Elements via @stripe/react-stripe-js.
            Sonner toasts, Heroicons. View Transitions API enabled on
            register flow. PWA manifest + apple-touch-icon shipped.

Backend   : Express 5, Prisma 6, PostgreSQL
            Hosted on Railway. `prisma db push` runs on startup
            (no migrations folder — `prisma db push` is the deploy step).
            Stripe + Twilio + Resend + Anthropic + Google Places.

Auth      : JWT (single token, long-lived) with Google + Apple OAuth.
            Magic links for passwordless. Role enum: ADMIN, COORDINATOR,
            CONTENT_MARKETING_ADMIN, CONTENT_MARKETING, PERFORMANCE_COACH,
            MEDICAL_ADMIN, MEDICAL, PARTNERSHIP_COACH, OUTSIDE_COACH,
            PARENT, ATHLETE (mostly modeled as CLIENT now), CLIENT.

Branding  : PPL palette: #0A0A0A bg, #141414 surface, #2A2A2A border,
            #F5F5F5 fg, #5E9E50 primary, #95C83C highlight.
            Fonts: Bank Gothic (display), Manrope (body), Bebas Neue
            (stat numbers), Transducer Black Italic (accent).

Cron      : services/cronService.ts hosts everything in-process. Jobs:
            session reminders (15min), daily payment retries (9am ET),
            daily admin digest (7am ET), workflow worker (1min),
            scheduled form sender (hourly), nightly lead+churn scoring
            (2am ET), Google reviews poll (8am ET), referral expiry
            (3am ET), auto-resume paused memberships (4am ET).
```

**Deploy flow:**
- `git push origin main` → Railway auto-deploy (backend), Vercel auto-deploy (frontend)
- Both use `prisma db push` on startup so schema changes ship with the commit
- Vercel git integration was set up earlier; it occasionally needs a manual nudge if it silently drops a deploy

**Sandbox-native push:** Chad doesn't have to leave the chat to commit/push.
I `git -c user.name="Chad Martin" -c user.email=cmart@pitchingperformancelab.com commit -m "..."`
and `git push origin main`. Always typecheck-clean (`npx tsc --noEmit`)
both packages before commit.

---

## How I work (the rules)

1. **Typecheck-clean every commit.** Never push code that errors `tsc --noEmit`.
2. **Honest claim discipline.** If something might be broken (e.g. disk-full
   prevents `prisma generate`), say so explicitly. Never claim "done" on a
   feature where the migration didn't run.
3. **Audit log every admin write.** All tag/workflow/customField/webhook/
   marketingForm CRUD writes an `AuditLog` row. Same pattern for new admin features.
4. **Org-scope by default.** New models include `organizationId String @default("ppl")`.
5. **Cron-resilient.** Background work is fire-and-forget with logging,
   never blocking on a request response.
6. **Minimal modal/component-level disk.** Heavy bundles (Stripe Elements,
   form builder) are dynamic-imported.
7. **Frontend uses `ppl-skeleton`** class for shimmer skeletons, not
   `animate-pulse`. Always layout-matched (no shift on data arrival).
8. **No popular emojis in UI** unless explicitly asked. PPL's voice is
   clean + professional.

---

## Shipped this session (April 25-26, 2026)

12 commits, all on `main`, deployed:

| # | Commit | What it shipped |
|---|--------|-----------------|
| 1 | `9b462bd` | Audit log on tag/workflow/customField/webhook CRUD |
| 2 | `3be85e0` | Form builder + scheduled delivery (#133) — public `/f/[slug]` + admin `/admin/forms` |
| 3 | `8728467` | Referral program (#134) — PPL-XXXX-XXXX codes, 7-credit reward |
| 4 | `2db3201` | Mobile responsive audit (#122) |
| 5 | `89cdf3c` | Notification readAt + click-through links (#136) |
| 6 | `fd2dc16` | Membership pause / resume (#137) — 1-12 weeks, Stripe pause_collection |
| 7 | `37b7efc` | Premium batch 1 (#140): compression middleware, branded 404/500, route progress bar |
| 8 | `c427908` | Cmd-K command palette + global search (#139) |
| 9 | `dfa9e56` | Skeleton loaders on top 5 pages (#143) |
| 10 | `16040ea` | Animated number counters on stat cards (P13) |
| 11 | `1bfb601` | Empty states + filter persistence (#144) |
| 12 | `bc326f9` | Lazy-load Stripe Elements bundle (E11) |

Plus `PREMIUM_AUDIT.md` at the repo root — **the authoritative roadmap**
with 70+ items rated must-have / strong-leverage / polish across
security, UX, speed, and premium feel. Read this first.

---

## Pending tasks (priority order)

These are the open items as of session end:

### 🔴 Schema-touching (need clean sandbox disk to do `prisma generate`)

- **#141 — Two-factor authentication (TOTP) for ADMIN role**
  Biggest single security upgrade. Recovery codes. Required on first
  login after rollout. Models: `TwoFactorSecret { userId, secret,
  enabledAt, recoveryCodes }`. Use `otplib` for TOTP.

- **#142 — Email verification + magic-link expiry tightening**
  Add `emailVerifiedAt: DateTime?` on User. Tighten magic-link expiry
  from 1h → 15min. Block first login until verified (admin-created
  users via invite are pre-verified).

- **#138 — Promo codes — Stripe Coupon integration**
  Admin CRUD for coupons (percent-off OR amount-off, optional
  first-month-only or N-months). Mirror to Stripe as Coupon objects.
  Public `/register?promo=CODE` accepts. Track redemption count.

- **Account lockout on failed logins** (called out in PREMIUM_AUDIT)
  Add `failedLoginCount`, `failedLoginResetAt`, `lockedUntil` to User.
  Lock 15 min after 5 fails in 15 min.

### 🟡 Frontend-only (no schema needed)

- **U8 — Bulk actions on CRM + members** — multi-select rows → bulk tag,
  bulk email, bulk archive. Daily productivity for coordinators.
- **U7 — Auto-save drafts on long forms** — workflow builder, form builder,
  lead notes. localStorage round-trip + subtle "Saved" indicator.
- **U22 — Streak indicators** — "You've trained 4 weeks in a row 🔥" on
  client dashboard. Retention + delight.
- **P14 — Hover-preview cards** — hover a lead/member name → mini popover
  with score + last activity.
- **U10 — Right-click context menus** on list rows
- **U11 — Keyboard navigation** (j/k arrows in CRM kanban)
- **P9 — Light + Dark theme toggle** — currently dark-only
- **P11 — Profile photos / avatars**
- **E15 — Tree-shake icon libraries** + bundle analyzer pass

### Refresher reading

- `PREMIUM_AUDIT.md` — full 70-item roadmap (must read)
- `ARCHITECTURE.md` — multi-org architecture, role model
- `CLAUDE.md` — project memory + Chad's working style notes
- `DEPLOY.md` — Railway + Vercel deploy mechanics

---

## Why this session ended

The sandbox's working disk hit 100%. Not Chad's Mac — the temporary
volume that the Cowork sandbox uses for tooling (~10GB total). After
~12 commits worth of file writes, the overlay layer accumulated
enough churn that `prisma generate` couldn't write to
`node_modules/.prisma`. That blocked all schema-touching tasks.

**Fix: a fresh Cowork session gets a fresh 10GB sandbox volume.** No
data loss — git holds everything, the audit doc carries the plan.

---

## Suggested opening message for the next chat

Paste this verbatim into the new session:

> Continuing the PPL App build. Read these in order:
>
> 1. `~/Documents/Claude/Projects/Scheduling App/ppl-app/SESSION_HANDOFF.md` — full context from last session
> 2. `~/Documents/Claude/Projects/Scheduling App/ppl-app/PREMIUM_AUDIT.md` — the authoritative roadmap
> 3. `~/Documents/Claude/Projects/Scheduling App/ppl-app/CLAUDE.md` — project memory
>
> Then verify the sandbox has fresh disk (`df -h /sessions` should show plenty of free space) and confirm `npx prisma generate` works in `packages/backend/`.
>
> Once verified, ship #141 (Two-factor auth for ADMIN role) — biggest pending security upgrade, schema-touching, blocked last session by disk. Use the design notes in PREMIUM_AUDIT.md (S6) and SESSION_HANDOFF.md (Pending tasks section).
>
> After that, in order: #142 email verification, #138 promo codes, account lockout. All schema-touching, all queued.
>
> Vision unchanged: premium feel matching premium service, one-stop ops platform for PPL. Typecheck-clean every commit. Honest claim discipline. Push to `main` to auto-deploy.

---

## Quick architectural reminders for the new chat

- **The dashboard registry pattern.** `packages/frontend/src/modules/dashboard/`
  has `widgets/`, `configs/`, and a `registry.ts`. Adding a widget = drop
  the file, register it, add to the role config. Never hard-code widgets.
- **Workflow engine.** `services/workflowEngine.ts` is the source of
  truth for automations. Triggers fire-and-forget via `emitTrigger()`.
  Workers resume WAITING runs every minute. Synchronous executor for
  immediate steps. Used for onboarding sequences, post-booking forms,
  referral rewards (in the future).
- **Org-scoping.** Every multi-tenant model has `organizationId String
  @default("ppl")`. Don't add new models without it.
- **Audit logs.** Every admin write should call `createAuditLog()` from
  `services/auditService.ts`. Pattern: `{userId, action: 'thing.created',
  resourceType: 'thing', resourceId: thing.id, changes: {...}}`.
- **Cron jobs.** Add to `services/cronService.ts`. Use `getEasternHour()`
  for time-of-day gates so cron is timezone-correct on Railway (UTC).
- **Email.** `services/emailService.ts` `sendEmail({to, subject, text, html})`.
  Always include `text`. Use `email-design` skill before composing
  HTML emails to recipients.
- **The frontend API client.** `packages/frontend/src/lib/api.ts` is one
  giant class. New endpoints get a method here, typed.
- **Hooks I built this session (reuse them).** `usePersistedState` for
  localStorage-backed state. `EmptyState` component for empty-state
  cards. `Skeleton` primitives. `AnimatedNumber` for stat cards.
  `RouteProgress` for top-of-page progress bars. `CommandPalette`
  for ⌘K — already mounted globally in `(dashboard)/layout.tsx`.

---

## Final state of session (April 26, 2026)

- **Branch:** `main`, last commit `bc326f9`
- **Deployment:** Auto-deploy via Vercel + Railway on push, no pending PRs
- **Tasks closed this session:** #122, #132–#137, #139, #140, #143, #144
- **Tasks pending:** #14 (non-code, ignore), #138, #141, #142
- **Disk state:** Sandbox at 100% — needs fresh session
- **Known good:** Both packages typecheck-clean
- **Vision intact:** Premium ops platform for PPL. Keep stacking polish + capability.

That's it. The next chat has everything it needs.
