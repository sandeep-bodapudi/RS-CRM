"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiSearchLimiter = exports.loginRateLimiter = exports.feedbackRateLimiter = exports.appLockRateLimiter = exports.publicWriteLimiter = exports.publicReadLimiter = exports.refreshRateLimiter = exports.apiRateLimiter = void 0;
const logger_1 = require("../utils/logger");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const prisma_1 = require("../lib/prisma");
const p = prisma_1.prisma;
const skipRateLimitInTests = (req) => process.env.NODE_ENV === 'test' && req.headers['x-strict-rate-limit'] !== 'true';
exports.apiRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 300,
    skip: skipRateLimitInTests,
    message: { error: 'Too many API requests, please try again later', code: 'RATE_LIMIT_EXCEEDED' },
    standardHeaders: true,
    legacyHeaders: false,
});
exports.refreshRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 20,
    skip: skipRateLimitInTests,
    message: {
        error: 'Too many refresh attempts, please try again later',
        code: 'RATE_LIMIT_EXCEEDED',
    },
    standardHeaders: true,
    legacyHeaders: false,
});
exports.publicReadLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000, // 1 minute
    skip: skipRateLimitInTests,
    max: 120, // 120 public read requests per IP per minute
    message: {
        error: 'Too many requests from this IP, please try again after a minute',
        code: 'RATE_LIMIT_EXCEEDED',
    },
    standardHeaders: true,
    legacyHeaders: false,
});
exports.publicWriteLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000, // 1 minute
    skip: skipRateLimitInTests,
    max: 10, // 10 public lead submissions per IP per minute
    message: {
        error: 'Too many submissions from this IP, please try again after a minute',
        code: 'RATE_LIMIT_EXCEEDED',
    },
    standardHeaders: true,
    legacyHeaders: false,
});
// § Phase 6: app-lock unlock endpoints are intentionally unauthenticated
// (see routes/webauthn.ts's doc comment — the whole point is they run when
// there's no valid access token in memory), so they need their own IP-based
// throttle. More generous than loginRateLimiter since legitimate use means
// "once per lock event, many times a day" for a single returning user,
// potentially several staff sharing one office IP.
exports.appLockRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    skip: skipRateLimitInTests,
    max: 20,
    message: {
        error: 'Too many app-lock attempts, please try again after a minute',
        code: 'RATE_LIMIT_EXCEEDED',
    },
    standardHeaders: true,
    legacyHeaders: false,
});
// § Phase 7: the customer feedback form is reached via a token in a WhatsApp
// link, with no login and no API key — same "unauthenticated but abusable"
// shape as app-lock unlock, so it gets its own throttle rather than sharing
// publicReadLimiter/publicWriteLimiter (those are scoped to the API-key-gated
// routes in routes/public.ts, a different trust boundary).
exports.feedbackRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    skip: skipRateLimitInTests,
    max: 20,
    message: {
        error: 'Too many requests, please try again after a minute',
        code: 'RATE_LIMIT_EXCEEDED',
    },
    standardHeaders: true,
    legacyHeaders: false,
});
exports.loginRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000, // 1 minute
    skip: skipRateLimitInTests,
    max: 5, // Limit each IP to 5 login requests per window
    message: {
        error: 'Too many login attempts from this IP, please try again after a minute',
        code: 'RATE_LIMIT_EXCEEDED',
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: async (req, res, next, options) => {
        const ip = req.ip || req.headers['x-forwarded-for'] || 'UNKNOWN_IP';
        const emailOrCode = req.body?.employee_code || 'UNKNOWN_CODE';
        try {
            await p.auditEvent.create({
                data: {
                    actor_id: 0,
                    action: 'SECURITY_ALERT',
                    entity_type: 'RATE_LIMIT_EXCEEDED',
                    entity_id: 0,
                    new_value: `Login rate limit exceeded for IP: ${ip}, targeting: ${emailOrCode}`,
                },
            });
        }
        catch (err) {
            logger_1.logger.error('Failed to log rate limit audit event', err);
        }
        res.status(options.statusCode).json(options.message);
    },
});
// AI Search endpoint — conservative because each call invokes a provider (costly + slow).
// Follows the existing express-rate-limit conventions (IP-based window, test skip).
exports.aiSearchLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000, // 1 minute
    skip: skipRateLimitInTests,
    max: 10, // 10 AI search requests per IP per minute
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Too many AI search requests, please try again after a minute',
        code: 'RATE_LIMIT_EXCEEDED',
    },
});
