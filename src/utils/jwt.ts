import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

if (!JWT_ACCESS_SECRET || !JWT_REFRESH_SECRET) {
  throw new Error('FATAL: JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be provided.');
}

export interface TokenPayload {
  employeeId: number;
  employeeCode: string;
  companyId: number;
  branchId: number | null;
  roles: string[];
  permissions: string[];
  tokenVersion?: number;
  /** Kiosk-only fields — only present when type === 'KIOSK' */
  type?: 'KIOSK' | 'EMPLOYEE';
  kioskCredentialId?: number;
  credentialVersion?: number;
  createdAt?: number;
}

// § Phase 6: a staff session is now meant to persist until the employee
// explicitly logs out (or gets revoked via token_version) — like Instagram,
// not a 30-minute-idle web app. A KIOSK token has no refresh flow at all
// today (see kiosk-auth.ts), so it needs its own long expiresIn passed
// explicitly rather than relying on the default.
export const generateAccessToken = (payload: TokenPayload, expiresIn: string = '24h'): string => {
  const finalPayload = {
    ...payload,
    tokenVersion: payload.tokenVersion ?? 1,
  };
  return jwt.sign(finalPayload, JWT_ACCESS_SECRET, { expiresIn } as jwt.SignOptions);
};

// 400 days (~13 months) — long enough that an active employee's session
// renews indefinitely via the existing rotating-refresh flow (every use
// issues a fresh 400-day token), while still being a bounded, real
// expiry rather than a literal "never" that some tooling handles oddly.
// Revocation stays instant and independent of this via token_version
// (apps/api/src/middleware/auth.ts) — extending this does NOT weaken that.
export const REFRESH_TOKEN_TTL_MS = 400 * 24 * 60 * 60 * 1000;

export const generateRefreshToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: '400d', jwtid: crypto.randomUUID() });
};

export const verifyAccessToken = (token: string): TokenPayload => {
  return jwt.verify(token, JWT_ACCESS_SECRET) as TokenPayload;
};

export const verifyRefreshToken = (token: string): TokenPayload => {
  return jwt.verify(token, JWT_REFRESH_SECRET) as TokenPayload;
};
