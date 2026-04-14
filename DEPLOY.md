# PPL App — Deployment Guide

## Architecture

- **Frontend**: Next.js on Vercel
- **Backend**: Express API on AWS (App Runner or ECS)
- **Database**: PostgreSQL on Supabase
- **Payments**: Stripe
- **SMS**: Twilio
- **Email**: Gmail SMTP or SendGrid

---

## Step 1: Supabase Database

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Choose a region close to your users (US East for Texas)
3. Set a strong database password — save it somewhere safe
4. Once the project is created, go to **Settings → Database**
5. Copy the **Connection string (URI)** — this is your `DATABASE_URL`
   - Use the **Transaction (port 6543)** URL for `DATABASE_URL`
   - Use the **Session (port 5432)** URL for `DIRECT_URL`
6. Replace `[YOUR-PASSWORD]` in both URLs with your database password

**Push the schema to Supabase:**

```bash
cd packages/backend

# Set the production DATABASE_URL temporarily
export DATABASE_URL="postgresql://postgres.[ref]:[password]@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
export DIRECT_URL="postgresql://postgres.[ref]:[password]@aws-0-us-east-1.pooler.supabase.com:5432/postgres"

# Push schema
npx prisma db push

# Seed with initial data (locations, plans, admin account)
npm run db:seed
```

---

## Step 2: Backend on AWS

### Option A: AWS App Runner (Recommended — Simplest)

1. Push the backend code to a GitHub repo (or use ECR)
2. Go to **AWS Console → App Runner → Create Service**
3. Source: Connect your GitHub repo, point to `packages/backend`
4. Runtime: **Docker** (uses the Dockerfile we created)
5. Port: `4000`
6. Set environment variables (see `.env.production.example`):
   - `DATABASE_URL` — from Supabase Step 1
   - `DIRECT_URL` — from Supabase Step 1
   - `JWT_SECRET` — generate with: `openssl rand -base64 64`
   - `STRIPE_SECRET_KEY` — from Stripe dashboard (live key)
   - `STRIPE_WEBHOOK_SECRET` — set after Step 3
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
   - `NODE_ENV` = `production`
   - `FRONTEND_URL` = your Vercel domain (e.g., `https://app.pitchingperformancelab.com`)
7. Deploy — App Runner gives you a URL like `https://xxxxx.us-east-1.awsapprunner.com`

### Option B: AWS ECS Fargate (More Control)

1. Build and push Docker image to ECR:
   ```bash
   cd packages/backend
   docker build -t ppl-backend .
   aws ecr create-repository --repository-name ppl-backend
   docker tag ppl-backend:latest [account].dkr.ecr.[region].amazonaws.com/ppl-backend:latest
   docker push [account].dkr.ecr.[region].amazonaws.com/ppl-backend:latest
   ```
2. Create an ECS cluster, task definition, and service
3. Set environment variables in the task definition
4. Attach an ALB (Application Load Balancer) for HTTPS

---

## Step 3: Stripe Webhook

Once your backend has a public URL:

1. Go to [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/webhooks)
2. Click **Add endpoint**
3. URL: `https://your-backend-url.com/api/webhooks/stripe`
4. Events to listen for:
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
   - `customer.subscription.deleted`
   - `customer.subscription.updated`
5. After creating, copy the **Signing secret** (`whsec_...`)
6. Add it as `STRIPE_WEBHOOK_SECRET` in your backend environment variables
7. Redeploy the backend

---

## Step 4: Frontend on Vercel

1. Go to [vercel.com](https://vercel.com) and import your GitHub repo
2. Set the **Root Directory** to `packages/frontend`
3. Framework: Next.js (auto-detected)
4. Set environment variables:
   - `NEXT_PUBLIC_API_URL` = your backend URL (e.g., `https://xxxxx.awsapprunner.com/api`)
   - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` = your Stripe publishable key (`pk_live_...`)
   - `BACKEND_URL` = your backend URL without `/api` (for the Next.js rewrite proxy)
5. Deploy
6. Add your custom domain in Vercel settings (e.g., `app.pitchingperformancelab.com`)

---

## Step 5: DNS + Custom Domain

1. In your domain registrar, add:
   - `app.pitchingperformancelab.com` → CNAME to Vercel
2. Update `FRONTEND_URL` in your backend env to match the custom domain
3. Redeploy backend

---

## Step 6: Smoke Test

Run through this checklist after deployment:

- [ ] Visit the app URL — login page loads
- [ ] Log in as admin (`cmart@pitchingperformancelab.com`)
- [ ] Dashboard shows stats
- [ ] Create a test session from the schedule
- [ ] Register a new test client account
- [ ] Select a membership plan → Stripe checkout appears
- [ ] Complete a test payment (use Stripe test card `4242 4242 4242 4242`)
- [ ] Verify credits appear on client dashboard
- [ ] Book a session as the test client
- [ ] Check that booking confirmation email is received
- [ ] Cancel the booking — verify credit is restored
- [ ] Check Stripe dashboard for the webhook events

---

## Going Live Checklist

Before switching from test to live Stripe:

- [ ] Switch `STRIPE_SECRET_KEY` from `sk_test_` to `sk_live_`
- [ ] Switch `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` from `pk_test_` to `pk_live_`
- [ ] Create a new webhook endpoint for live mode in Stripe
- [ ] Update `STRIPE_WEBHOOK_SECRET` with the live signing secret
- [ ] Set up real Twilio credentials for SMS
- [ ] Set up Gmail App Password or SendGrid for email
- [ ] Generate a new strong `JWT_SECRET` for production
- [ ] Verify CORS allows only your production domain
- [ ] Test the full payment flow with a real card

---

## Useful Commands

```bash
# Local development
docker compose up -d          # Start PostgreSQL + Redis
npm run dev                   # Start backend + frontend

# Database
npm run db:setup              # Generate + push + seed
npm run db:studio             # Open Prisma Studio (visual DB browser)
npm run db:reset              # Wipe and re-seed

# Type checking
npm run typecheck             # Check both backend + frontend

# Build
npm run build                 # Build both packages
```

---

## Account Credentials (Development Seed)

All seeded accounts use password: `password123`

| Role | Email | Notes |
|------|-------|-------|
| Admin | cmart@pitchingperformancelab.com | Full access, assigned to both locations |
| Coach | coach.mike@ppl.dev | PPL Southlake |
| Coach | coach.sarah@ppl.dev | PPL Southlake |
| Coach | coach.derek@ppl.dev | PPL Keller |
| Client | jake.wilson@test.dev | Unlimited plan, Southlake |
| Client | max.anderson@test.dev | No membership (test signup flow) |
