# PPL App — Pitching Performance Lab Platform
<!-- deploy-kick: 2026-04-23 -->


## Overview
Full-stack scheduling, membership, and business management platform for Pitching Performance Lab (PPL). Built as a monorepo with separate backend and frontend packages. Currently live at **app.pitchingperformancelab.com**.

Owner: Chad Martin (cmart@pitchingperformancelab.com)

## Tech Stack

**Backend:** Express 5 + TypeScript, Prisma ORM, PostgreSQL (Railway), JWT auth, Stripe payments, Twilio SMS, Nodemailer, Firebase Cloud Messaging (push notifications)

**Frontend:** Next.js 16 + React 19 + TypeScript, Tailwind CSS, custom dark theme with PPL branding (teal/cyan accent colors)

**Deployment:** Frontend on Vercel (project: `ppl-app-xsg5`), Backend + Postgres on Railway. Custom domain: `app.pitchingperformancelab.com`

**Source Control:** GitHub repo `PPLLex/ppl-app`, branch `main`. Push using temporary classic PATs with repo scope (create at github.com/settings/tokens, delete immediately after push).

## Project Structure

```
ppl-app/
  packages/
    backend/
      prisma/schema.prisma    # 43 models, PostgreSQL
      src/
        routes/                # 30 route files (auth, bookings, staff, sessions, etc.)
        services/              # Business logic (audit, notification, payment, push)
        middleware/auth.ts      # JWT authenticate + requireAdmin/requireStaff
        utils/                 # prisma client, apiError, config
        app.ts                 # Express app setup + route registration
    frontend/
      src/
        app/                   # Next.js App Router
          (dashboard)/         # Authenticated route group (admin/, staff/, client/, profile/)
          login/, register/, join/, kiosk/, coach/
        components/layout/     # Sidebar.tsx, DashboardLayout.tsx
        contexts/              # AuthContext.tsx, ThemeContext.tsx
        lib/api.ts             # API client class (~1000 lines, all endpoints)
```

## Authentication & Roles

Three user roles: **ADMIN**, **STAFF**, **CLIENT**. JWT tokens stored in `localStorage` as `ppl_token`. Auth context (`AuthContext.tsx`) provides `user`, `login`, `logout`, `refreshUser`, `routeByRole`.

Login methods: email/password, Google OAuth, Apple OAuth, magic link.

Role-based routing: ADMIN -> `/admin`, STAFF -> `/staff`, CLIENT -> `/client`.

Staff have per-location role assignments via `StaffLocation` model with `roles: LocationRole[]` (OWNER, PITCHING_COORDINATOR, YOUTH_COORDINATOR, COACH, TRAINER). A staff member can have different roles at different locations.

## Key Backend Patterns

- All routes use `authenticate` middleware (JWT verification), admin routes add `requireAdmin`
- Standard response format: `{ success: true, data: ... }` or `{ success: false, error: ... }`
- `ApiError` class for structured errors (badRequest, notFound, conflict, forbidden)
- `createAuditLog()` for tracking important actions
- Prisma field naming: User has `avatarUrl` (NOT `profileImageUrl`)

## Key API Endpoints

- `GET /api/auth/me` — current user with homeLocation, locations (staff assignments), profile, memberships
- `GET /api/staff` — list all staff/admin with location assignments (admin only)
- `POST /api/staff/invite` — create staff invitation with location/role assignments
- `POST /api/staff/invite/:token/accept` — public route, accept invite + create account
- `GET /api/locations` — list all locations
- `GET /api/sessions` — list sessions with filters
- `POST /api/bookings` — create booking
- `GET /api/reports/dashboard` — admin dashboard stats

## Frontend Patterns

- Dark theme using CSS custom properties (defined in ThemeContext)
- Component classes: `ppl-card`, `ppl-gradient`, `ppl-btn`
- Color tokens: `text-foreground`, `text-muted`, `bg-surface`, `bg-background`, `text-highlight`, `bg-highlight`, `text-accent-text`, `text-primary-text`, `text-on-accent`, `border-border`, `text-danger`
- Sidebar shows all assigned locations for staff/admin users, homeLocation for clients
- API client at `src/lib/api.ts` — all methods return `Promise<ApiResponse<T>>`

## Database (Prisma) — Key Models

- **User**: id, email, passwordHash, fullName, phone, role, avatarUrl, homeLocationId, staffLocations[], clientProfile, clientMemberships[]
- **Location**: id, name, address, rooms[], sessions[], staff[]
- **StaffLocation**: staffId, locationId, roles: LocationRole[] (@@unique([staffId, locationId]))
- **StaffInvite**: token, email, fullName, role, locations (JSON), expiresAt, usedAt
- **Session**: id, locationId, roomId, type, startTime, endTime, capacity, bookings[]
- **Booking**: id, userId, sessionId, status (CONFIRMED/COMPLETED/CANCELLED/NO_SHOW)
- **MembershipPlan** + **ClientMembership**: plan tiers, status, billing
- **Program**: multi-week training programs with days and exercises
- **Family** + **AthleteProfile**: parent-child relationships
- **SchoolTeam** + **SchoolCoach**: partner school management
- **OrgSettings**: branding, colors, logos, business config

## Locations

PPL currently has multiple locations (PPL Louisville, PPL Youth, etc.). Staff/admin users can be assigned to multiple locations with different roles at each.

## Recent Work (as of April 2026)

- Staff management system with invite flow and onboarding page (`/join/staff/[token]`)
- Multi-role per location support (LocationRole[] arrays)
- Profile editing page for all user types (`/profile`)
- Sidebar shows all assigned locations for staff/admin
- Add Staff modal with location cards and role selection
- Promise.allSettled for resilient parallel API calls
- Self-service kiosk check-in mode
- Recurring session scheduling with series management
- Payment failure -> credit freeze automation
- Push notifications via Firebase Cloud Messaging
- Outside coach management
- Partner school invoicing and contracts

## Common Gotchas

1. User model field is `avatarUrl`, NOT `profileImageUrl` — Prisma will 500 if you select the wrong field name
2. `StaffLocation.roles` is a `LocationRole[]` array, not a single value
3. `homeLocation` on User is a single optional location — separate from `staffLocations` assignments
4. Frontend API client (`api.ts`) User interface must match what backend `/api/auth/me` returns
5. The `staffPublicRouter` (invite acceptance) is registered separately in app.ts before auth middleware
6. When pushing to GitHub, always create a temporary PAT, push, then delete it immediately
7. Use `Promise.allSettled()` instead of `Promise.all()` when loading multiple independent resources

## Chad's Standing Directives (DO NOT SUGGEST OTHERWISE)

- **NO session waitlist feature.** Chad has explicitly ruled out per-session waitlists. A registration-wide waitlist at the business level may come later, but individual session waitlists are OFF the roadmap. Do not suggest, do not propose.
- **NO data migration from Swift.** Clients will not be migrated from Swift to this app. Don't plan migration work, don't suggest it, don't bring it up.
- **Always call training sessions "training sessions," not "classes."** Chad prefers this terminology.
- **Room canonical name for 13+ is** `13+ (Middle School, High School, College, and Pro)` — keep the parenthetical everywhere it's displayed.
- **Push workflow in the sandbox:** use `/tmp/ppl-push-helper.sh "message" file1 ...` — clones fresh to /tmp, copies edited files, commits, pushes, AND fires a Vercel deploy hook. Vercel's GitHub webhook has dropped pushes silently in the past; the hook is a safety net (idempotent so double-firing is fine). Secrets: GH token at `/tmp/.ghtoken`, Vercel deploy hook URL at `/tmp/.vercel-deploy-hook` (both sandbox-private, ephemeral). If missing after a sandbox rebuild, recreate them — Vercel hook URL lives in the project Settings → Git → Deploy Hooks.
- **"Shipped" ≠ "pushed". "Shipped" = "verified live in production".** The push helper supports `--verify-frontend <marker>` (polls JS bundle for the string) and `--verify-backend <path> <expected-substring>` (polls the endpoint until the response matches). ALWAYS pass one of these flags when shipping a meaningful change. If the verify step fails (exit 2), DO NOT tell Chad to "try it in 60s" — diagnose the deploy failure first (check Vercel or Railway dashboard, look at build/deploy logs). A past incident: an orphaned `scripts/bootstrap-organizations.ts` wasn't copied into the Railway production container, which caused every backend deploy to fail healthcheck silently. Railway kept serving old code while claiming new deploys "finished". Without verification we wouldn't have caught that for hours.
- **Railway backend** auto-deploys from `main`. It does NOT have a deploy hook URL (Railway doesn't expose one without an API key). So the Vercel hook alone can't safeguard backend changes — the `--verify-backend` flag is how we guarantee a backend change is live before declaring done.
- **Vercel project:** only `ppl-app-xsg5` (mapped to `app.pitchingperformancelab.com`) is Git-connected. The three older projects (`ppl-app`, `ppl-frontend`, `ppl-scheduling-app`) are disconnected so they don't burn build budget. Don't reconnect them unless you intend to use them.
- **Ship-as-you-go cadence.** Chad wants changes committed + pushed + deployed as soon as they're ready, not batched at the end of a session. Keep him in the loop when deploys land so he can test live.
- **Do everything autonomously that can be done autonomously.** Only interrupt Chad for decisions with meaningful tradeoffs, production data mutations that can't be undone, financial operations, or truly ambiguous requirements. Otherwise, make the call, ship it, report.
- **Always include the correct test link when asking Chad to test something.** Don't make him scroll back or hunt for it. If it's the registration flow, that's `https://app.pitchingperformancelab.com/register`. If it's a specific admin page, paste the full URL. **Never add `?v=whatever` cache-buster query params** — they're visual noise and the push helper's verify-step already waits for the edge cache to rotate before declaring a change live. Plain URL every time.

## Current Build Priority (as of April 21, 2026)

1. **Scheduling + payments fully dialed in on BOTH admin and client sides.** Chad wants end-to-end audit and polish of the core flow before any new features. This is the foundation — nothing else ships until this is solid.
2. Shareable public registration/onboarding page (URL you can text/email to prospects: create account → pick membership → pay → if parent, kid gets their own login for programs).
3. Digital liability waiver — rip the current one from pitchingperformancelab.com, improve it, require before first booking, save to client profile with real signature + time/date stamp.
4. SMTP hardening in production (current sends are slow — was hitting 45s timeouts).

## Ruled Out

- ~~Session-level waitlists~~ (see directives above)
- ~~Swift data migration~~ (see directives above)
