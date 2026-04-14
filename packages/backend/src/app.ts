import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import { errorHandler } from './middleware/errorHandler';
import { authLimiter, apiLimiter } from './middleware/rateLimit';

// Route imports
import authRoutes from './routes/auth';
import locationRoutes from './routes/locations';
import sessionRoutes from './routes/sessions';
import bookingRoutes from './routes/bookings';
import membershipRoutes from './routes/memberships';
import memberRoutes from './routes/members';
import staffRoutes from './routes/staff';
import conversationRoutes from './routes/conversations';
import reportRoutes from './routes/reports';
import notificationRoutes from './routes/notifications';
import accountRoutes from './routes/account';
import passwordResetRoutes from './routes/passwordReset';
import auditLogRoutes from './routes/auditLogs';
import webhookRoutes from './routes/webhooks';

const app = express();

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(helmet());
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
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/webhooks', webhookRoutes);

// ============================================================
// ERROR HANDLING
// ============================================================

app.use(errorHandler);

export default app;
