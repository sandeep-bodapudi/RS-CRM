"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("./utils/logger");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const health_1 = __importDefault(require("./routes/health"));
const auth_1 = __importDefault(require("./routes/auth"));
const attendance_1 = __importDefault(require("./routes/attendance"));
const md_1 = __importDefault(require("./routes/md"));
const reports_1 = __importDefault(require("./routes/reports"));
const tasks_1 = __importDefault(require("./routes/tasks"));
const performance_1 = __importDefault(require("./routes/performance"));
const notifications_1 = __importDefault(require("./routes/notifications"));
const targets_1 = __importDefault(require("./routes/targets"));
const employees_1 = __importDefault(require("./routes/employees"));
const leads_1 = __importDefault(require("./routes/leads"));
const properties_1 = __importDefault(require("./routes/properties"));
const opportunities_1 = __importDefault(require("./routes/opportunities"));
const installment_routes_1 = __importDefault(require("./routes/installment.routes"));
const projects_1 = __importDefault(require("./routes/projects"));
const kiosk_auth_1 = __importDefault(require("./routes/kiosk-auth"));
const webauthn_1 = __importDefault(require("./routes/webauthn"));
const feedback_1 = __importDefault(require("./routes/feedback"));
const siteVisits_1 = __importDefault(require("./routes/siteVisits"));
const customers_1 = __importDefault(require("./routes/customers"));
const public_1 = __importDefault(require("./routes/public"));
const publicWebsite_1 = __importDefault(require("./routes/publicWebsite"));
const admin_1 = __importDefault(require("./routes/admin"));
const expenseRefunds_1 = __importDefault(require("./routes/expenseRefunds"));
const pushSubscriptions_1 = __importDefault(require("./routes/pushSubscriptions"));
const announcement_1 = __importDefault(require("./routes/announcement"));
const booking_routes_1 = __importDefault(require("./routes/booking.routes"));
const payment_routes_1 = __importDefault(require("./routes/payment.routes"));
const integration_routes_1 = __importDefault(require("./routes/integration.routes"));
const complaint_routes_1 = __importDefault(require("./routes/complaint.routes"));
const analytics_1 = __importDefault(require("./routes/analytics"));
const aiSearch_1 = __importDefault(require("./routes/aiSearch"));
const messageTemplates_1 = __importDefault(require("./routes/messageTemplates"));
const pm_routing_1 = __importDefault(require("./routes/pm-routing"));
const whatsapp_1 = __importDefault(require("./routes/whatsapp"));
const roles_1 = __importDefault(require("./routes/roles"));
const amenities_1 = __importDefault(require("./routes/amenities"));
const portalWorker_1 = require("./services/portalWorker");
const compression_1 = __importDefault(require("compression"));
const app = (0, express_1.default)();
const port = process.env.PORT || 3000;
// Proxy Awareness for Rate Limiting (Render architecture)
app.set('trust proxy', 1);
// Security Middlewares
app.use((0, helmet_1.default)({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
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
app.use((0, cors_1.default)({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps, curl, server-to-server)
        if (!origin)
            return callback(null, true);
        // Allow known origins, or an allowed apex domain and its subdomains
        // (anchored match — NOT a substring check, so
        // "https://radharealhomeproperties.com.attacker.io" is rejected).
        let originHost = '';
        try {
            originHost = new URL(origin).hostname;
        }
        catch {
            // Malformed origin header — fall through and reject below.
        }
        const matchesApexDomain = allowedPublicApexDomains.some((domain) => originHost === domain || originHost.endsWith(`.${domain}`));
        if (allowedOrigins.includes(origin) || matchesApexDomain) {
            return callback(null, true);
        }
        // Reject without an Error — passing an Error here makes the `cors`
        // middleware forward it to Express's error handler, which returns a
        // raw 500 instead of simply omitting CORS headers (the browser then
        // reports a normal, expected CORS failure instead of a server error).
        logger_1.logger.warn(`CORS blocked for origin: ${origin}`);
        callback(null, false);
    },
    credentials: true,
}));
app.use((0, cookie_parser_1.default)());
app.use((0, compression_1.default)({ threshold: 0 }));
// Body Parser
app.use(express_1.default.json());
// Enforce max pagination cap of 100 globally
const pagination_1 = require("./middleware/pagination");
app.use(pagination_1.enforceMaxPagination);
const swagger_1 = require("./utils/swagger");
(0, swagger_1.setupSwagger)(app);
const rateLimiter_1 = require("./middleware/rateLimiter");
// Serve property and profile images publicly.
const uploadDir = process.env.UPLOAD_DIR || path_1.default.join(process.cwd(), 'uploads');
const propertiesDir = path_1.default.join(uploadDir, 'properties');
const profilesDir = path_1.default.join(uploadDir, 'profiles');
const expenseProofsDir = path_1.default.join(uploadDir, 'expense-proofs');
// Project layout/site-plan images, media (cover/gallery/brochure/plans) and
// documents (RERA/approval/legal) — all written via getStorageService's
// LocalStorageService, one subdir per kind. Public the same way property
// images are: no sensitive data lives here (that's expense-proofs, kept out).
const projectsLayoutDir = path_1.default.join(uploadDir, 'projects-layout');
const projectsMediaDir = path_1.default.join(uploadDir, 'projects-media');
const projectsDocumentsDir = path_1.default.join(uploadDir, 'projects-documents');
if (!fs_1.default.existsSync(propertiesDir))
    fs_1.default.mkdirSync(propertiesDir, { recursive: true });
if (!fs_1.default.existsSync(profilesDir))
    fs_1.default.mkdirSync(profilesDir, { recursive: true });
if (!fs_1.default.existsSync(expenseProofsDir))
    fs_1.default.mkdirSync(expenseProofsDir, { recursive: true });
if (!fs_1.default.existsSync(projectsLayoutDir))
    fs_1.default.mkdirSync(projectsLayoutDir, { recursive: true });
if (!fs_1.default.existsSync(projectsMediaDir))
    fs_1.default.mkdirSync(projectsMediaDir, { recursive: true });
if (!fs_1.default.existsSync(projectsDocumentsDir))
    fs_1.default.mkdirSync(projectsDocumentsDir, { recursive: true });
app.use('/uploads/properties', express_1.default.static(propertiesDir));
app.use('/uploads/profiles', express_1.default.static(profilesDir));
app.use('/uploads/projects-layout', express_1.default.static(projectsLayoutDir));
app.use('/uploads/projects-media', express_1.default.static(projectsMediaDir));
app.use('/uploads/projects-documents', express_1.default.static(projectsDocumentsDir));
// expense-proofs is intentionally NOT served statically — these are private
// financial documents. They're only served via the authenticated,
// ownership-checked GET /expense-refunds/:id/proof route (expenseRefunds.ts),
// which the frontend already uses exclusively.
// Global API Rate Limiter
app.use('/api/', rateLimiter_1.apiRateLimiter);
const PROCESS_ROLE = (process.env.PROCESS_ROLE || 'all');
const mountInternal = PROCESS_ROLE === 'all' || PROCESS_ROLE === 'internal';
const mountPublic = PROCESS_ROLE === 'all' || PROCESS_ROLE === 'public';
const mountPortal = PROCESS_ROLE === 'all' || PROCESS_ROLE === 'portal';
logger_1.logger.info(`[server] PROCESS_ROLE=${PROCESS_ROLE} (internal=${mountInternal} public=${mountPublic} portal=${mountPortal})`);
// Every role needs a health check (deployment platforms poll this).
app.use('/api/v1/health', health_1.default);
if (mountInternal) {
    app.use('/api/v1/auth', auth_1.default);
    app.use('/api/v1/auth/app-lock', webauthn_1.default);
    app.use('/api/v1/feedback', feedback_1.default);
    app.use('/api/v1/kiosk-auth', kiosk_auth_1.default);
    app.use('/api/v1/kiosk-credentials', kiosk_auth_1.default);
    app.use('/api/v1/attendance', attendance_1.default);
    app.use('/api/v1/md', md_1.default);
    app.use('/api/v1/reports', reports_1.default);
    app.use('/api/v1/tasks', tasks_1.default);
    app.use('/api/v1/performance', performance_1.default);
    app.use('/api/v1/notifications', notifications_1.default);
    app.use('/api/v1/targets', targets_1.default);
    app.use('/api/v1/employees', employees_1.default);
    app.use('/api/v1/leads', leads_1.default);
    app.use('/api/v1/customers', customers_1.default);
    app.use('/api/v1/properties', properties_1.default);
    app.use('/api/v1/opportunities', opportunities_1.default);
    app.use('/api/v1/installments', installment_routes_1.default);
    app.use('/api/v1/projects', projects_1.default);
    app.use('/api/v1/site-visits', siteVisits_1.default);
    app.use('/api/v1/admin', admin_1.default);
    app.use('/api/v1/expense-refunds', expenseRefunds_1.default);
    app.use('/api/v1/push', pushSubscriptions_1.default);
    app.use('/api/v1/announcement', announcement_1.default);
    app.use('/api/v1/bookings', booking_routes_1.default);
    app.use('/api/v1/payments', payment_routes_1.default);
    app.use('/api/v1/integration', integration_routes_1.default);
    app.use('/api/v1/complaints', complaint_routes_1.default);
    app.use('/api/v1/analytics', analytics_1.default);
    app.use('/api/v1/ai', aiSearch_1.default);
    app.use('/api/v1/message-templates', messageTemplates_1.default);
    app.use('/api/v1/pm-routing', pm_routing_1.default);
    app.use('/api/v1/whatsapp', whatsapp_1.default);
    app.use('/api/v1/roles', roles_1.default);
    app.use('/api/v1/amenities', amenities_1.default);
}
if (mountPublic) {
    app.use('/api/v1/public', public_1.default);
    app.use('/api/v1/public', publicWebsite_1.default);
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
    app.use(express_1.default.static(path_1.default.join(process.cwd(), 'apps/web/dist')));
}
// Handle React routing or return basic API status if static files don't exist
app.get('*', (req, res) => {
    const indexPath = path_1.default.join(process.cwd(), 'apps/web/dist/index.html');
    if (fs_1.default.existsSync(indexPath)) {
        res.sendFile(indexPath);
    }
    else {
        res.status(200).json({ status: 'API is running', message: 'Frontend is hosted separately.' });
    }
});
// Global Error Handler
app.use((err, req, res, next) => {
    if (err && (err.name === 'AppError' || err.statusCode || err.status)) {
        return res.status(err.statusCode || err.status || 400).json({ error: err.message });
    }
    if (err && err.name === 'ZodError') {
        return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }
    // 3. Prisma Errors
    if (err && err.name === 'PrismaClientKnownRequestError') {
        logger_1.logger.error('PKE:', err);
        if (err.code === 'P2002')
            return res.status(409).json({ error: 'Conflict' });
        if (err.code === 'P2003')
            return res.status(400).json({ error: 'Invalid request' });
        if (err.code === 'P2025')
            return res.status(404).json({ error: 'Not found' });
        return res.status(400).json({ error: 'Invalid request' });
    }
    if (err && err.name === 'PrismaClientValidationError') {
        logger_1.logger.error('PVE:', err.message);
        return res.status(400).json({ error: 'Invalid request' });
    }
    logger_1.logger.error(err.stack);
    res.status(500).json({ error: 'Internal Server Error' });
});
// Ensure required JWT secrets are present before starting
if (process.env.NODE_ENV === 'production') {
    if (!process.env.JWT_ACCESS_SECRET || process.env.JWT_ACCESS_SECRET.length < 32) {
        logger_1.logger.warn('WARNING: JWT_ACCESS_SECRET is missing or too short for production.');
    }
    if (!process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET.length < 32) {
        logger_1.logger.warn('WARNING: JWT_REFRESH_SECRET is missing or too short for production.');
    }
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length < 32) {
        logger_1.logger.warn('WARNING: ENCRYPTION_KEY is missing or too short for production. KYC data cannot be encrypted safely.');
    }
    if (!process.env.QR_HMAC_SECRET || process.env.QR_HMAC_SECRET.length < 32) {
        logger_1.logger.warn('WARNING: QR_HMAC_SECRET is missing or too short for production. Kiosk QR codes cannot be securely signed.');
    }
}
const scheduler_1 = require("./jobs/scheduler");
// In a Serverless environment (like Vercel), we must not call app.listen() or start background cron jobs
// because Vercel handles the port binding and crons keep the event loop alive, causing timeouts/crashes.
if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
    app.listen(port, () => {
        logger_1.logger.info(`[server]: API running at http://localhost:${port}`);
        // Initialize background jobs
        (0, scheduler_1.initJobs)();
        // Portal worker is DISABLED by default (PORTAL_WORKER_ENABLED=false).
        // Enable explicitly when the Customer Portal is available.
        portalWorker_1.PortalWorker.start();
    });
}
exports.default = app; // clean commit test
