# PPL App — Premium Audit & Roadmap

A senior-engineer pass over what separates a "works fine" app from one that
*feels* premium. Organized by the four pillars Chad called out: security,
UX, efficiency/speed, and premium feel. Every item is rated:

- **🔴 Must-have** — ship-blocker or material risk if missing
- **🟡 Strong leverage** — visible quality jump, ship soon
- **🟢 Polish** — incremental but cumulative

---

## 1. SECURITY

### 🔴 Must-haves before opening the doors

| # | Item | Why it matters |
|---|------|----------------|
| S1 | **Rate limiting on auth endpoints** | Without this, a bot can credential-stuff `/api/auth/login` 1000 req/sec |
| S2 | **Account lockout after N failed logins** | Prevents online brute force on individual accounts |
| S3 | **Helmet + CSP headers** | One-line baseline against XSS, clickjacking, MIME sniffing |
| S4 | **Email verification before first login** | Stops fake-email signups; required for password-reset to work properly |
| S5 | **HTTPS-only, SameSite=Lax cookies** | JWT in cookie isn't useful if it leaks to JS via document.cookie |
| S6 | **Two-factor auth (TOTP) for ADMIN role** | A compromised admin account = full data breach |
| S7 | **PII redaction in logs** | Don't log full request bodies on /auth/login or /payments |
| S8 | **Dependency vulnerability scanning** | Dependabot or Snyk on CI |

### 🟡 Strong leverage

| # | Item | Why |
|---|------|-----|
| S9 | **JWT short-lived + refresh tokens** | Currently single long-lived JWT; rotation reduces blast radius |
| S10 | **Password complexity + HaveIBeenPwned check** | Block reused passwords from known breaches |
| S11 | **Audit log on every admin write** | Most done, but verify Stripe-related actions are covered |
| S12 | **Magic-link expiry shorter (15 min instead of 1 hr)** | Tighter window if email is compromised |
| S13 | **Webhook signature validation** | Stripe ✓, Twilio ✓ — verify Resend Inbound + GHL inbound |
| S14 | **Subresource Integrity on CDN scripts** | Pin the Stripe.js + any other CDN script SHA |
| S15 | **CORS allowlist** | Currently wide-open in dev; lock down in prod |

### 🟢 Polish

| # | Item | Why |
|---|------|-----|
| S16 | **Session timeout after 30min inactivity** for admins | Optional but standard for internal tools |
| S17 | **PII export (GDPR-style)** for users | Future-proof for compliance |
| S18 | **PII deletion on user delete** | Cascade properly |

---

## 2. UX (USER EXPERIENCE)

### 🔴 Must-haves for premium feel

| # | Item | Why |
|---|------|-----|
| U1 | **Skeleton loaders, not spinners** | Spinners = "I'm still working." Skeletons = "Here's the structure of what you'll see." Premium apps never use bare spinners on main content. |
| U2 | **Optimistic UI updates** | Tag toggling, booking, mark-as-read should feel instant. Reconcile if the server rejects. |
| U3 | **Empty states with illustration + CTA** | Don't show "No data." Show a friendly graphic + the primary next action. |
| U4 | **Inline form validation** | Validate on blur, not on submit-fail. Show success ✓ as fields become valid. |
| U5 | **Cmd-K command palette** | The single most premium-feeling power-user feature. (Already planned #139) |
| U6 | **Real-time validation toasts** | Sonner is in place — make sure every async action gives feedback within 200ms |

### 🟡 Strong leverage

| # | Item | Why |
|---|------|-----|
| U7 | **Auto-save drafts** | Long forms (workflow builder, form builder, lead notes) shouldn't lose work on tab close |
| U8 | **Bulk actions** on lists (CRM, members) | Select-many → tag/email/assign in one go |
| U9 | **Smart filter persistence** | If I filter "leads, location=Lex, score>50" then nav away and back, restore it |
| U10 | **Right-click context menus** | Edit / archive / view in new tab on any list row |
| U11 | **Keyboard navigation** in lists | j/k to move, Enter to open, ⌘+click for new tab |
| U12 | **Drag-and-drop file uploads** anywhere a file input exists | Visual feedback on drag-over |
| U13 | **Toast position respects mobile** | top-right on desktop, top-center on mobile (already done) |
| U14 | **Page transitions** (View Transitions API) | Smooth crossfade between pages — already partially wired in register flow |
| U15 | **Better error messages** | "Could not save: this email is already registered" beats "Save failed" |

### 🟢 Polish

| # | Item | Why |
|---|------|-----|
| U16 | **Microinteractions** on button press / save | Subtle scale + color flash |
| U17 | **Confetti / celebrations** on milestones | Already have birthday — add for first booking, 10th session, referral reward |
| U18 | **Personalized greetings** | "Welcome back, Chad" — already have on dashboard |
| U19 | **Sound effects** (opt-in) | Linear-style swoosh on action completion |
| U20 | **Customizable dashboard widgets** | Drag to reorder, hide unwanted ones |
| U21 | **Onboarding tour** | First-time user walkthrough with intro.js / shepherd.js |
| U22 | **Streak indicators** | "You've trained 4 weeks in a row 🔥" |

---

## 3. EFFICIENCY / SPEED

### 🔴 Must-haves

| # | Item | Why |
|---|------|-----|
| E1 | **Compression middleware (gzip/brotli)** | One-line Express middleware → 50-70% bandwidth savings on JSON payloads |
| E2 | **Database index audit** | Walk every `where` clause and ensure an index exists; missing indexes show up as slow queries fast |
| E3 | **Eager loading on hot routes** | `/admin/crm`, `/client/book` — make sure we're not doing N+1 |
| E4 | **Image optimization** | Use `next/image` everywhere with explicit width/height + priority on above-fold |
| E5 | **Bundle analyzer** | Run @next/bundle-analyzer once, find the 200KB chart library no one's using |

### 🟡 Strong leverage

| # | Item | Why |
|---|------|-----|
| E6 | **Redis cache for hot reads** | Session list, member churn scores, dashboard digests |
| E7 | **Service worker / PWA manifest** | Installable on mobile, asset caching, offline-friendly |
| E8 | **Streaming SSR** | Render shell, stream data — first paint feels 2x faster |
| E9 | **Font subset + preload** | Bank Gothic, Manrope, Bebas Neue, Transducer — subset to used glyphs, preload critical |
| E10 | **Prefetch on hover** for nav links | Already partially via Next.js Link; verify on Sidebar |
| E11 | **Dynamic import** of heavy modals | StripeCheckout, FormBuilder — only load when opened |
| E12 | **Database connection pool tuning** | PgBouncer or Prisma pool size verified for Railway |

### 🟢 Polish

| # | Item | Why |
|---|------|-----|
| E13 | **Edge caching for public pages** | / (landing), /f/[slug] (forms), /register on Vercel edge |
| E14 | **HTTP/2 push for critical assets** | Hint the browser to fetch logo + CSS before the HTML closes |
| E15 | **Tree-shake icon libraries** | Heroicons → import individual icons, not the whole barrel |
| E16 | **Query result virtualization** | Lists >100 rows → react-window or tanstack-virtual |

---

## 4. PREMIUM FEEL

### 🟡 Strong leverage

| # | Item | Why |
|---|------|-----|
| P1 | **Custom-illustrated empty states** | Heroicons placeholder = generic. Custom SVGs = premium. |
| P2 | **Variable fonts with optical sizing** | Bank Gothic + Manrope have weight ranges — use them. |
| P3 | **Subtle gradient accents** on CTAs + hero | Already have ppl-gradient — apply consistently. |
| P4 | **Glassmorphism on overlays** | `backdrop-blur` on modals + dropdowns |
| P5 | **Skeleton screens that match exact layout** | Identical row heights to actual content prevents layout shift |
| P6 | **Page-load progress bar** | Like nprogress at top of viewport during navigations |
| P7 | **Beautiful 404 / 500 pages** | Brand them; offer "back home" + "report issue" buttons |
| P8 | **Print stylesheets** for invoices, receipts | Members will print payment receipts |
| P9 | **Light + Dark theme toggle** | Currently dark-only; light mode broadens appeal |
| P10 | **Real-time presence indicators** | "Travis is also viewing this lead" — small, premium touch |

### 🟢 Polish

| # | Item | Why |
|---|------|-----|
| P11 | **Profile photos** | User uploads avatar → shows in nav, comments, etc. |
| P12 | **Personalized dashboards** per user (drag to reorder) | Power users will love it |
| P13 | **Animated number counters** on stat cards | 0 → 28 over 800ms feels alive |
| P14 | **Hover preview on links** to internal records | Hover a lead name → mini-card with score + last activity |
| P15 | **Smart birthday/holiday surprises** | Birthday confetti exists; add Black Friday, season-opening pop-ups |
| P16 | **Sound design system** (opt-in) | Subtle UI sounds — Linear / Things / Notion-style |

---

## EXECUTION PLAN — what I'm shipping in this session

**Now (high-leverage, low-risk):**
1. ✅ Compression middleware on Express (E1)
2. ✅ Helmet + sane CSP defaults (S3)
3. ✅ Rate limiting on auth endpoints (S1)
4. ✅ PWA manifest + apple-touch-icon + theme-color (E7)
5. ✅ Account lockout after 5 failed login attempts (S2)
6. ✅ Skeleton-loader component utility (U1) — used on top pages
7. ✅ Branded 404 + 500 pages (P7)
8. ✅ Page-load nprogress-style bar (P6)

**Then (soon, separate commits):**
9. Cmd-K command palette (U5 / #139)
10. Promo codes (#138)
11. Email verification + magic-link expiry tighten (S4 / S12)
12. Two-factor auth for admins (S6) — biggest single security upgrade
13. Bundle analyzer pass (E5)

**Future scope (file follow-up tasks):**
- Real-time presence
- Custom illustrations for empty states
- Light theme
- Profile photos + avatars
- Hover-preview cards
- Sound design

---

This document is the authoritative list. Tick items off as we ship.
