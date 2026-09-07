import { logger } from './utils/logger';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { prisma } from './lib/prisma';
import bcrypt from 'bcryptjs';
import { Roles } from './shared';

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

import siteVisitRoutes from './routes/siteVisits';
import customerRoutes from './routes/customers';
import publicRoutes from './routes/public';
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

import { PortalWorker } from './services/portalWorker';
import compression from 'compression';

const app = express();
const port = process.env.PORT || 3000;

const p = prisma;

// Proxy Awareness for Rate Limiting (Render architecture)
app.set('trust proxy', 1);

// Security Middlewares
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:4173',
  'https://rscrm.radharealhomeproperties.com',
];
if (process.env.APP_URL && !allowedOrigins.includes(process.env.APP_URL)) {
  allowedOrigins.push(process.env.APP_URL);
}

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);

      // Allow known origins or any vercel preview URL
      if (
        allowedOrigins.includes(origin) ||
        origin.endsWith('.vercel.app') ||
        origin.includes('radharealhomeproperties.com')
      ) {
        return callback(null, true);
      }

      logger.warn(`CORS blocked for origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
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
app.use(apiRateLimiter);

// Serve property and profile images publicly.
const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
const propertiesDir = path.join(uploadDir, 'properties');
const profilesDir = path.join(uploadDir, 'profiles');
const expenseProofsDir = path.join(uploadDir, 'expense-proofs');

if (!fs.existsSync(propertiesDir)) fs.mkdirSync(propertiesDir, { recursive: true });
if (!fs.existsSync(profilesDir)) fs.mkdirSync(profilesDir, { recursive: true });
if (!fs.existsSync(expenseProofsDir)) fs.mkdirSync(expenseProofsDir, { recursive: true });

app.use('/uploads/properties', express.static(propertiesDir));
app.use('/uploads/profiles', express.static(profilesDir));
// expense-proofs is intentionally NOT served statically -- these are private
// financial documents. They are only served via the authenticated,
// ownership-checked GET /expense-refunds/:id/proof route (expenseRefunds.ts),
// which the frontend already uses exclusively.

// Global API Rate Limiter
app.use('/api/', apiRateLimiter);

// Routes
app.use('/api/v1/health', healthRoutes);
app.use('/api/v1/auth', authRoutes);
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
app.use('/api/v1/public', publicRoutes);
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

// =========================================
// NEW NAMESPACE ROUTING (Phase 1 Migration)
// =========================================
const internalRouter = express.Router();
internalRouter.use('/health', healthRoutes);
internalRouter.use('/auth', authRoutes);
internalRouter.use('/kiosk-auth', kioskAuthRoutes);
internalRouter.use('/kiosk-credentials', kioskAuthRoutes);
internalRouter.use('/attendance', attendanceRoutes);
internalRouter.use('/md', mdRoutes);
internalRouter.use('/reports', reportRoutes);
internalRouter.use('/tasks', taskRoutes);
internalRouter.use('/performance', performanceRoutes);
internalRouter.use('/notifications', notificationRoutes);
internalRouter.use('/targets', targetRoutes);
internalRouter.use('/employees', employeeRoutes);
internalRouter.use('/leads', leadRoutes);
internalRouter.use('/customers', customerRoutes);
internalRouter.use('/properties', propertyRoutes);
internalRouter.use('/opportunities', opportunityRoutes);
internalRouter.use('/installments', installmentRoutes);
internalRouter.use('/projects', projectRoutes);
internalRouter.use('/site-visits', siteVisitRoutes);
internalRouter.use('/admin', adminRoutes);
internalRouter.use('/expense-refunds', expenseRefundRoutes);
internalRouter.use('/push', pushRoutes);
internalRouter.use('/announcement', announcementRoutes);
internalRouter.use('/bookings', bookingRoutes);
internalRouter.use('/payments', paymentRoutes);
internalRouter.use('/integration', integrationRoutes);
internalRouter.use('/complaints', complaintRoutes);
internalRouter.use('/analytics', analyticsRoutes);
internalRouter.use('/ai', aiSearchRoutes);
internalRouter.use('/message-templates', messageTemplateRoutes);
internalRouter.use('/pm-routing', pmRoutingRoutes);
internalRouter.use('/whatsapp', whatsappRoutes);
internalRouter.use('/roles', rolesRoutes);

app.use('/api/v1/internal', internalRouter);
// Note: publicRoutes is already mounted at /api/v1/public above
// =========================================

// Fallback for unknown API routes
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

// Serve frontend static files from apps/web/dist
app.use(express.static(path.join(process.cwd(), 'apps/web/dist')));

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

// Auto-seed Hostinger MySQL Database on startup if empty
const bootstrapHostingerDatabase = async () => {
  try {
    const company = await p.company.upsert({
      where: { code: 'RRH' },
      update: { name: 'Radha Real Homes' },
      create: { name: 'Radha Real Homes', code: 'RRH', property_type_group: 'RADHA_REAL_HOMES' },
    });

    const mainBranch =
      (await p.branch.findFirst({
        where: { company_id: company.id, name: 'Miyapur (Main Branch)' },
      })) ||
      (await p.branch.create({ data: { company_id: company.id, name: 'Miyapur (Main Branch)' } }));

    const secondaryBranch =
      (await p.branch.findFirst({ where: { company_id: company.id, name: 'Tarnaka Branch' } })) ||
      (await p.branch.create({ data: { company_id: company.id, name: 'Tarnaka Branch' } }));

    const rolesToSeed = [
      { name: Roles.MD, is_system: true, is_invisible: false },
      { name: Roles.ADMIN, is_system: true, is_invisible: true },
      { name: Roles.HR_MANAGER, is_system: false, is_invisible: false },
      { name: Roles.MARKETING_DIRECTOR, is_system: false, is_invisible: false },
      { name: Roles.PROJECT_MANAGER, is_system: false, is_invisible: false },
      { name: Roles.DIGITAL_LEAD_OPERATOR, is_system: false, is_invisible: false },
      { name: Roles.TELECALLER, is_system: false, is_invisible: false },

      { name: Roles.DIGITAL_MARKETING_HEAD, is_system: false, is_invisible: false },
      { name: Roles.FINANCE, is_system: false, is_invisible: false },
      { name: Roles.AGENT, is_system: false, is_invisible: false },

      { name: Roles.DIGITAL_MARKETING_EXECUTIVE, is_system: false, is_invisible: false },
    ];

    const roleMap: Record<string, any> = {};
    for (const rDef of rolesToSeed) {
      const role = await p.role.upsert({
        where: { name: rDef.name },
        update: { is_invisible: rDef.is_invisible, is_system: rDef.is_system },
        create: rDef,
      });
      roleMap[rDef.name] = role;
    }

    const empCount = await p.employee.count();
    if (empCount > 0) {
      logger.info(
        `[database]: Connected to Hostinger MySQL (${empCount} active employee records loaded)`,
      );
      return;
    }

    logger.info('[database]: Seeding Hostinger MySQL database with full team roster...');

    const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD;
    if (!defaultPassword) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'FATAL: DEFAULT_ADMIN_PASSWORD must be provided in production for initial bootstrap.',
        );
      }
      logger.warn('WARNING: Using insecure default admin password for development bootstrap.');
    }
    const passwordHash = await bcrypt.hash(defaultPassword || 'Radhareal@123', 12);

    const initialEmployees = [
      {
        roleName: Roles.ADMIN,
        code: 'RRH-ADMIN-001',
        name: 'Technical Admin',
        phone: '+91 99999 00001',
        email: 'admin@radharealhomes.com',
        dept: 'IT Systems',
        title: 'System Technical Admin',
        salary: 120000,
        exempt: true,
        branchId: mainBranch.id,
      },
    ];

    for (const empDef of initialEmployees) {
      await p.employee.create({
        data: {
          employee_code: empDef.code,
          full_name: empDef.name,
          phone: empDef.phone,
          email: empDef.email,
          company_id: company.id,
          branch_id: empDef.branchId,
          password_hash: passwordHash,
          status: 'ACTIVE',
          attendance_required: !empDef.exempt,
          first_login_done: true,
          job_title: empDef.title,
          department: empDef.dept,
          employment_type: 'FULL_TIME',
          report_required: true,
          salary_ctc: empDef.salary,
          current_address: 'Flat 402, Royal Residency, Miyapur, Hyderabad, TS - 500049',
          permanent_address: 'Plot 88, Green Meadows, Hyderabad, TS - 500081',
          blood_group: 'O+',
          pan_number: `${empDef.code.substring(4, 7)}DE1234F`,
          aadhaar_number: '123456789012',
          bank_name: 'HDFC Bank',
          bank_account_number: '5010023456789',
          bank_ifsc: 'HDFC0001234',
          bank_branch: 'Miyapur Main',
          emergency_contact_name: 'Emergency Contact',
          emergency_contact_relation: 'Spouse',
          emergency_contact_phone: '+91 99887 76600',
          background_education: 'B.Tech / MBA (First Class)',
          date_of_joining: new Date('2024-01-15T00:00:00.000Z'),
          roles: {
            create: { role_id: roleMap[empDef.roleName].id },
          },
        },
      });
    }

    logger.info('[database]: Hostinger MySQL database seeded successfully on startup!');
  } catch (err: any) {
    logger.error('[database error]:', err.message);
  }
};

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
    bootstrapHostingerDatabase();
    // Portal worker is DISABLED by default (PORTAL_WORKER_ENABLED=false).
    // Enable explicitly when the Customer Portal is available.
    PortalWorker.start();
  });
}

export default app; // clean commit test
