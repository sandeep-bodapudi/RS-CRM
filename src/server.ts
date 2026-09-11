import { logger } from './utils/logger';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';

import healthRoutes from './routes/health';
import authRoutes from './routes/auth';
import attendanceRoutes from './routes/attendance';
import mdRoutes from './routes/md';
import reportRoutes from './routes/reports';
import taskRoutes from './routes/tasks';
import performanceRoutes from './routes/performance';
import notificationRoutes from './routes/notifications';
import targetRoutes from './routes/targets';
import employeeRoutes from './routes/employees';
import leadRoutes from './routes/leads';
import propertyRoutes from './routes/properties';
import opportunityRoutes from './routes/opportunities';
import installmentRoutes from './routes/installment.routes';
import projectRoutes from './routes/projects';
import kioskAuthRoutes from './routes/kiosk-auth';
import webauthnRoutes from './routes/webauthn';
import feedbackRoutes from './routes/feedback';

import siteVisitRoutes from './routes/siteVisits';
import demoRoutes from './routes/demos';
import customerRoutes from './routes/customers';
import publicRoutes from './routes/public';
import publicWebsiteRoutes from './routes/publicWebsite';
import adminRoutes from './routes/admin';
import expenseRefundRoutes from './routes/expenseRefunds';
import pushRoutes from './routes/pushSubscriptions';
import announcementRoutes from './routes/announcement';
import bookingRoutes from './routes/booking.routes';
import paymentRoutes from './routes/payment.routes';
import integrationRoutes from './routes/integration.routes';
import complaintRoutes from './routes/complaint.routes';
import analyticsRoutes from './routes/analytics';
import aiSearchRoutes from './routes/aiSearch';
import messageTemplateRoutes from './routes/messageTemplates';
import pmRoutingRoutes from './routes/pm-routing';
import whatsappRoutes from './routes/whatsapp';
import rolesRoutes from './routes/roles';
import amenityRoutes from './routes/amenities';

import { PortalWorker } from './services/portalWorker';
import compression from 'compression';

const app = express();
const port = process.env.PORT || 3000;

// Proxy Awareness for Rate Limiting (Render architecture)
app.set('trust proxy', 1);

// Security Middlewares
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:4173',
  'https://rscrm.radharealhomeproperties.com',
];
if (process.env.APP_URL && !allowedOrigins.includes(process.env.APP_URL)) {
  allowedOrigins.push(process.env.APP_URL);
}

// Public-website apex domains (and their subdomains) allowed to call the
// public API — consolidation plan Decision 5: Sonthillu/Radha now call
// apps/api directly from the browser instead of through their own BFFs.
// NOTE: both 'radharealhomeproperties.com' and 'radharealhome.com' are
// listed because the codebase itself is inconsistent about which is the
// real production domain (apps/api's own pre-existing config used the
// former; the Radha frontend's own SITE_CONFIG defaults to the latter) —
// flagged to Sandeep to confirm the real one; harmless to allow both until
// then since each is still an exact, anchored match, not a wildcard.
const allowedPublicApexDomains = [
  'radharealhomeproperties.com',
  'radharealhome.com',
  'sonthilluconstructions.com',
];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);

      // Allow known origins, or an allowed apex domain and its subdomains
      // (anchored match — NOT a substring check, so
      // "https://radharealhomeproperties.com.attacker.io" is rejected).
      let originHost = '';
      try {
        originHost = new URL(origin).hostname;
      } catch {
        // Malformed origin header — fall through and reject below.
      }
      const matchesApexDomain = allowedPublicApexDomains.some(
        (domain) => originHost === domain || originHost.endsWith(`.${domain}`),
      );
      if (allowedOrigins.includes(origin) || matchesApexDomain) {
        return callback(null, true);
      }

      // Reject without an Error — passing an Error here makes the `cors`
      // middleware forward it to Express's error handler, which returns a
      // raw 500 instead of simply omitting CORS headers (the browser then
      // reports a normal, expected CORS failure instead of a server error).
      logger.warn(`CORS blocked for origin: ${origin}`);
      callback(null, false);
    },
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(compression({ threshold: 0 }) as any);

// Body Parser
app.use(express.json());

// Enforce max pagination cap of 100 globally
import { enforceMaxPagination } from './middleware/pagination';
app.use(enforceMaxPagination);

import { setupSwagger } from './utils/swagger';
setupSwagger(app);

import { apiRateLimiter } from './middleware/rateLimiter';

// Serve property and profile images publicly.
const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
const propertiesDir = path.join(uploadDir, 'properties');
const profilesDir = path.join(uploadDir, 'profiles');
const expenseProofsDir = path.join(uploadDir, 'expense-proofs');
// Project layout/site-plan images, media (cover/gallery/brochure/plans) and
// documents (RERA/approval/legal) — all written via getStorageService's
// LocalStorageService, one subdir per kind. Public the same way property
// images are: no sensitive data lives here (that's expense-proofs, kept out).
const projectsLayoutDir = path.join(uploadDir, 'projects-layout');
const projectsMediaDir = path.join(uploadDir, 'projects-media');
const projectsDocumentsDir = path.join(uploadDir, 'projects-documents');

if (!fs.existsSync(propertiesDir)) fs.mkdirSync(propertiesDir, { recursive: true });
if (!fs.existsSync(profilesDir)) fs.mkdirSync(profilesDir, { recursive: true });
if (!fs.existsSync(expenseProofsDir)) fs.mkdirSync(expenseProofsDir, { recursive: true });
if (!fs.existsSync(projectsLayoutDir)) fs.mkdirSync(projectsLayoutDir, { recursive: true });
if (!fs.existsSync(projectsMediaDir)) fs.mkdirSync(projectsMediaDir, { recursive: true });
if (!fs.existsSync(projectsDocumentsDir)) fs.mkdirSync(projectsDocumentsDir, { recursive: true });

app.use('/uploads/properties', express.static(propertiesDir));
app.use('/uploads/profiles', express.static(profilesDir));
app.use('/uploads/projects-layout', express.static(projectsLayoutDir));
app.use('/uploads/projects-media', express.static(projectsMediaDir));
app.use('/uploads/projects-documents', express.static(projectsDocumentsDir));
// expense-proofs is intentionally NOT served statically — these are private
// financial documents. They're only served via the authenticated,
// ownership-checked GET /expense-refunds/:id/proof route (expenseRefunds.ts),
// which the frontend already uses exclusively.

// Global API Rate Limiter
app.use('/api/', apiRateLimiter);

// ─────────────────────────────────────────────────────────────
// PROCESS_ROLE — lets this exact codebase run as one, two, or three
// separately-deployed processes without a rewrite. Today (Render free tier)
// everything defaults to 'all', unchanged from before this existed. Once
// public-site traffic and (eventually) the customer portal move to their
// own instances — each with their own Prisma `connection_limit` — this
// single env var is the switch: 'internal' mounts only staff/CRM routes,
// 'public' mounts only the two marketing-site routers, 'portal' mounts the
// (future) customer-portal routes. See docs/PENDING-PRODUCTION-CHANGES.md /
// the consolidation plan for when to actually split these.
// ─────────────────────────────────────────────────────────────
type ProcessRole = 'all' | 'internal' | 'public' | 'portal';
const PROCESS_ROLE = (process.env.PROCESS_ROLE || 'all') as ProcessRole;
const mountInternal = PROCESS_ROLE === 'all' || PROCESS_ROLE === 'internal';
const mountPublic = PROCESS_ROLE === 'all' || PROCESS_ROLE === 'public';
const mountPortal = PROCESS_ROLE === 'all' || PROCESS_ROLE === 'portal';
logger.info(
  `[server] PROCESS_ROLE=${PROCESS_ROLE} (internal=${mountInternal} public=${mountPublic} portal=${mountPortal})`,
);

// Every role needs a health check (deployment platforms poll this).
app.use('/api/v1/health', healthRoutes);

if (mountInternal) {
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/auth/app-lock', webauthnRoutes);
  app.use('/api/v1/feedback', feedbackRoutes);
  app.use('/api/v1/kiosk-auth', kioskAuthRoutes);
  app.use('/api/v1/kiosk-credentials', kioskAuthRoutes);
  app.use('/api/v1/attendance', attendanceRoutes);
  app.use('/api/v1/md', mdRoutes);
  app.use('/api/v1/reports', reportRoutes);
  app.use('/api/v1/tasks', taskRoutes);
  app.use('/api/v1/performance', performanceRoutes);
  app.use('/api/v1/notifications', notificationRoutes);
  app.use('/api/v1/targets', targetRoutes);
  app.use('/api/v1/employees', employeeRoutes);
  app.use('/api/v1/leads', leadRoutes);
  app.use('/api/v1/customers', customerRoutes);
  app.use('/api/v1/properties', propertyRoutes);
  app.use('/api/v1/opportunities', opportunityRoutes);
  app.use('/api/v1/installments', installmentRoutes);
  app.use('/api/v1/projects', projectRoutes);
  app.use('/api/v1/site-visits', siteVisitRoutes);
  app.use('/api/v1/demos', demoRoutes);
  app.use('/api/v1/admin', adminRoutes);
  app.use('/api/v1/expense-refunds', expenseRefundRoutes);
  app.use('/api/v1/push', pushRoutes);
  app.use('/api/v1/announcement', announcementRoutes);
  app.use('/api/v1/bookings', bookingRoutes);
  app.use('/api/v1/payments', paymentRoutes);
  app.use('/api/v1/integration', integrationRoutes);
  app.use('/api/v1/complaints', complaintRoutes);
  app.use('/api/v1/analytics', analyticsRoutes);
  app.use('/api/v1/ai', aiSearchRoutes);
  app.use('/api/v1/message-templates', messageTemplateRoutes);
  app.use('/api/v1/pm-routing', pmRoutingRoutes);
  app.use('/api/v1/whatsapp', whatsappRoutes);
  app.use('/api/v1/roles', rolesRoutes);
  app.use('/api/v1/amenities', amenityRoutes);
}

if (mountPublic) {
  app.use('/api/v1/public', publicRoutes);
  app.use('/api/v1/public', publicWebsiteRoutes);
}

if (mountPortal) {
  // The customer-portal login/booking/payment-proof/document routes land
  // here once built (consolidation plan, Decision 1) — deliberately kept
  // separate from `mountInternal` so a future portal-only process doesn't
  // also carry the full internal CRM surface.
}

// Fallback for unknown API routes
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

// Serve frontend static files from apps/web/dist — the internal CRM's own
// bundle, so only the internal role (or 'all', today's default) serves it.
if (mountInternal) {
  app.use(express.static(path.join(process.cwd(), 'apps/web/dist')));
}

// Handle React routing or return basic API status if static files don't exist
app.get('*', (req, res) => {
  const indexPath = path.join(process.cwd(), 'apps/web/dist/index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(200).json({ status: 'API is running', message: 'Frontend is hosted separately.' });
  }
});

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err && (err.name === 'AppError' || err.statusCode || err.status)) {
    return res.status(err.statusCode || err.status || 400).json({ error: err.message });
  }
  if (err && err.name === 'ZodError') {
    return res.status(400).json({ error: 'Validation failed', details: err.errors });
  }
  // 3. Prisma Errors
  if (err && err.name === 'PrismaClientKnownRequestError') {
    logger.error('PKE:', err);
    if (err.code === 'P2002') return res.status(409).json({ error: 'Conflict' });
    if (err.code === 'P2003') return res.status(400).json({ error: 'Invalid request' });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    return res.status(400).json({ error: 'Invalid request' });
  }
  if (err && err.name === 'PrismaClientValidationError') {
    logger.error('PVE:', err.message);
    return res.status(400).json({ error: 'Invalid request' });
  }
  logger.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Ensure required JWT secrets are present before starting
if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_ACCESS_SECRET || process.env.JWT_ACCESS_SECRET.length < 32) {
    logger.warn('WARNING: JWT_ACCESS_SECRET is missing or too short for production.');
  }
  if (!process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET.length < 32) {
    logger.warn('WARNING: JWT_REFRESH_SECRET is missing or too short for production.');
  }
  if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length < 32) {
    logger.warn(
      'WARNING: ENCRYPTION_KEY is missing or too short for production. KYC data cannot be encrypted safely.',
    );
  }
  if (!process.env.QR_HMAC_SECRET || process.env.QR_HMAC_SECRET.length < 32) {
    logger.warn(
      'WARNING: QR_HMAC_SECRET is missing or too short for production. Kiosk QR codes cannot be securely signed.',
    );
  }
}

import { initJobs } from './jobs/scheduler';

// In a Serverless environment (like Vercel), we must not call app.listen() or start background cron jobs
// because Vercel handles the port binding and crons keep the event loop alive, causing timeouts/crashes.
if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  app.listen(port, () => {
    logger.info(`[server]: API running at http://localhost:${port}`);

    // Initialize background jobs
    initJobs();
    // Portal worker is DISABLED by default (PORTAL_WORKER_ENABLED=false).
    // Enable explicitly when the Customer Portal is available.
    PortalWorker.start();
  });
}

export default app; // clean commit test
