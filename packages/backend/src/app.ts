import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { config } from './config';
import { errorHandler } from './middleware/errorHandler';
import { authLimiter, apiLimiter } from './middleware/rateLimit';
import { orgContext } from './middleware/orgContext';

// Route imports
import authRoutes from './routes/auth';
import locationRoutes from './routes/locations';
import sessionRoutes from './routes/sessions';
import bookingRoutes from './routes/bookings';
import membershipRoutes from './routes/memberships';
import memberRoutes from './routes/members';
import staffRoutes, { staffPublicRouter } from './routes/staff';
import conversationRoutes from './routes/conversations';
import reportRoutes from './routes/reports';
import notificationRoutes from './routes/notifications';
import accountRoutes from './routes/account';
import passwordResetRoutes from './routes/passwordReset';
import auditLogRoutes from './routes/auditLogs';
import webhookRoutes from './routes/webhooks';
import oauthRoutes from './routes/oauth';
import twoFactorRoutes from './routes/twoFactor';
import emailVerificationRoutes from './routes/emailVerification';
import promoCodeRoutes from './routes/promoCodes';
import coachNoteRoutes from './routes/coachNotes';
import goalRoutes from './routes/goals';
import formRoutes from './routes/forms';
import programRoutes from './routes/programs';
import locationRevenueRoutes from './routes/locationRevenue';
import onboardingRoutes from './routes/onboarding';
import schoolRoutes from './routes/schools';
import schoolCoachAuthRoutes from './routes/schoolCoachAuth';
import schoolCoachDashboardRoutes from './routes/schoolCoachDashboard';
import sessionTypeConfigRoutes from './routes/sessionTypeConfigs';
import integrationRoutes from './routes/integrations';
import revenueRoutes from './routes/revenue';
import kioskRoutes from './routes/kiosk';
import outsideCoachRoutes from './routes/outsideCoaches';
import settingsRoutes from './routes/settings';
import educationalResourcesRoutes from './routes/educationalResources';
import waiverRoutes from './routes/waivers';
import inboundEmailRoutes from './routes/inboundEmail';
import roleRoutes from './routes/roles';
import partnerDashboardRoutes from './routes/partnerDashboard';
import leadRoutes from './routes/leads';
import publicLeadIntakeRoutes from './routes/publicLeadIntake';
import tagRoutes from './routes/tags';
import customFieldRoutes from './routes/customFields';
import workflowRoutes from './routes/workflows';
import outboundWebhookRoutes from './routes/webhooks.outbound';
import marketingFormRoutes from './routes/marketingForms';
import referralRoutes from './routes/referrals';
import searchRoutes from './routes/search';
import consultationRoutes from './routes/consultations';
import twilioRoutes from './routes/twilio';
import reviewRoutes from './routes/reviews';
import swiftImportRoutes from './routes/swiftImport';
import screeningRoutes from './routes/screenings';
import campaignRoutes from './routes/campaigns';
import emailPreviewRoutes from './routes/emailPreview';
import { membershipGuard } from './middleware/membershipGuard';

const app = express();

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(helmet({
  // Allow Stripe.js + our own CDN-hosted fonts. CSP is permissive on
  // purpose because we run our React frontend on a different origin
  // (Vercel) and the API only serves JSON. The frontend has its own
  // CSP set via next.config.ts headers.
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
// Gzip/Brotli — saves 50-70% on JSON payload size on every API response.
// `threshold: 1024` skips tiny bodies where compression overhead > savings.
app.use(compression({ threshold: 1024 }));
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (proxied through Next.js, mobile apps)
    if (!origin) return callback(null, true);
    if (origin === config.frontendUrl) return callback(null, true);
    // In dev, allow all localhost variants
    if (!config.isProduction && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// Stripe webhooks need raw body for signature verification
// This MUST come before express.json()
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));

// All other routes use JSON parsing
app.use(express.json());

// Rate limiting
app.use('/api/auth', authLimiter);
app.use('/api', apiLimiter);

// Organization context — attaches req.org on every /api request. Must run
// before routes but after body parsing. See ARCHITECTURE.md for the resolution
// order and fallback behavior.
app.use('/api', orgContext);

// Membership guard — enforces "dummy mode" for clients without active membership
// Checks JWT (if present) and blocks non-payment routes for suspended/past-due/cancelled members
// Allowlisted paths (account, memberships, auth, webhooks, locations, notifications) are always accessible
app.use('/api', membershipGuard);

// ============================================================
// ROUTES
// ============================================================

app.get('/api/health', (_req, res) => {
  // Lazy import to avoid circular deps at startup
  const { getCronStatus } = require('./services/cronService');
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    cron: getCronStatus(),
  });
});

// Public staff invite routes (no auth required) — must be before /api/staff authenticated routes
app.use('/api/staff', staffPublicRouter);

// Public lead intake — marketing site forms drop into the CRM here.
// No auth required, hooked into the global apiLimiter for rate-limit, with
// honeypot + email validation in the route handler.
app.use('/api/public', publicLeadIntakeRoutes);

app.use('/api/auth', authRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/memberships', membershipRoutes);
app.use('/api/members', memberRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/auth', passwordResetRoutes);
app.use('/api/auth', oauthRoutes);
// 2FA enrollment + login bridge (#141 / PREMIUM_AUDIT S6).
// Routes inside the file declare their own /2fa/* prefix so this single
// mount serves both /api/auth/2fa/* and /api/auth/login/2fa-verify.
app.use('/api/auth', twoFactorRoutes);
// Email verification (#142 / PREMIUM_AUDIT S4) — /api/auth/email/*.
app.use('/api/auth', emailVerificationRoutes);
// Promo codes (#138). Public lookup (/lookup) + admin CRUD all under one
// router; the route file applies requireAdmin per-handler.
app.use('/api/promo-codes', promoCodeRoutes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/schools', schoolRoutes);

// School coach dashboard — separate auth system (not membership guarded)
app.use('/api/coach-auth', schoolCoachAuthRoutes);
app.use('/api/coach-dashboard', schoolCoachDashboardRoutes);

// New feature routes — protected by membership guard for client users
// The guard checks internally if the path is allowlisted
app.use('/api/coach-notes', coachNoteRoutes);
app.use('/api/goals', goalRoutes);
app.use('/api/forms', formRoutes);
app.use('/api/programs', programRoutes);
app.use('/api/locations', locationRevenueRoutes);
app.use('/api/session-type-configs', sessionTypeConfigRoutes);
app.use('/api/integrations', integrationRoutes);
app.use('/api/revenue', revenueRoutes);
app.use('/api/kiosk', kioskRoutes);
app.use('/api/outside-coaches', outsideCoachRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/educational-resources', educationalResourcesRoutes);
app.use('/api/waivers', waiverRoutes);
// Inbound email + SMS — turns client replies into in-app messages
app.use('/api/webhooks', inboundEmailRoutes);
// Role lookup + invitable-roles list — powers the admin invite UI dropdown
app.use('/api/roles', roleRoutes);
// Partner school dashboard — Partnership Coach + Admin + athletes-on-roster
app.use('/api/partner-dashboard', partnerDashboardRoutes);
// CRM — leads + sales pipeline for Content & Marketing + Admin + Coordinator
app.use('/api/leads', leadRoutes);
// Medical screenings — Renewed Performance integration for Medical + Medical Admin
app.use('/api/screenings', screeningRoutes);
// Marketing email campaigns — Content & Marketing role (fan-out worker lands later)
app.use('/api/campaigns', campaignRoutes);
// Admin-only email template preview + test-send
app.use('/api/email-preview', emailPreviewRoutes);

// Phase 1 foundations — Tagging, Custom Fields, Workflow engine
app.use('/api/tags', tagRoutes);
app.use('/api/custom-fields', customFieldRoutes);
app.use('/api/workflows', workflowRoutes);
// Outbound webhooks — admin-configured fire-on-event subscribers (Zapier-style)
app.use('/api/outbound-webhooks', outboundWebhookRoutes);
// Marketing forms — public form builder + submissions (#133)
app.use('/api/marketing-forms', marketingFormRoutes);
// Referral program — refer-a-friend free-week reward (#134)
app.use('/api/referrals', referralRoutes);
// Global search — powers the Cmd-K command palette (#139)
app.use('/api/search', searchRoutes);
// Consultation calendar — public booking + admin slot management
app.use('/api/consultations', consultationRoutes);
// Twilio webhooks — inbound voice + SMS + missed-call text-back (#8, #9, #42)
// Mounted unauthenticated; Twilio signs requests with X-Twilio-Signature
// (TODO: verify signature in middleware once we get the auth token wired).
app.use('/api/twilio', twilioRoutes);
// Reputation management — Google reviews + AI draft replies (#28, #40)
app.use('/api/reviews', reviewRoutes);
// Swift CSV importer — launch unblocker for migrating off Swift
app.use('/api/admin/swift-import', swiftImportRoutes);

// ============================================================
// ERROR HANDLING
// ============================================================

app.use(errorHandler);

export default app;
