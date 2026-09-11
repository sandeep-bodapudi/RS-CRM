import { logger } from '../utils/logger';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma';

const p = prisma;
const skipRateLimitInTests = (req: any) =>
  process.env.NODE_ENV === 'test' && req.headers['x-strict-rate-limit'] !== 'true';

export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 3000,
  skip: skipRateLimitInTests,
  message: { error: 'Too many API requests, please try again later', code: 'RATE_LIMIT_EXCEEDED' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const refreshRateLimiter = rateLimit({
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

export const publicReadLimiter = rateLimit({
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

export const publicWriteLimiter = rateLimit({
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
export const appLockRateLimiter = rateLimit({
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
export const feedbackRateLimiter = rateLimit({
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

export const loginRateLimiter = rateLimit({
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
    } catch (err) {
      logger.error('Failed to log rate limit audit event', err);
    }

    res.status(options.statusCode).json(options.message);
  },
});

// AI Search endpoint — conservative because each call invokes a provider (costly + slow).
// Follows the existing express-rate-limit conventions (IP-based window, test skip).
export const aiSearchLimiter = rateLimit({
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
