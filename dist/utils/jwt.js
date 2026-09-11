"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyRefreshToken = exports.verifyAccessToken = exports.generateRefreshToken = exports.REFRESH_TOKEN_TTL_MS = exports.generateAccessToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
if (!JWT_ACCESS_SECRET || !JWT_REFRESH_SECRET) {
    throw new Error('FATAL: JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be provided.');
}
// § Phase 6: a staff session is now meant to persist until the employee
// explicitly logs out (or gets revoked via token_version) — like Instagram,
// not a 30-minute-idle web app. A KIOSK token has no refresh flow at all
// today (see kiosk-auth.ts), so it needs its own long expiresIn passed
// explicitly rather than relying on the default.
const generateAccessToken = (payload, expiresIn = '24h') => {
    const finalPayload = {
        ...payload,
        tokenVersion: payload.tokenVersion ?? 1,
    };
    return jsonwebtoken_1.default.sign(finalPayload, JWT_ACCESS_SECRET, { expiresIn });
};
exports.generateAccessToken = generateAccessToken;
// 400 days (~13 months) — long enough that an active employee's session
// renews indefinitely via the existing rotating-refresh flow (every use
// issues a fresh 400-day token), while still being a bounded, real
// expiry rather than a literal "never" that some tooling handles oddly.
// Revocation stays instant and independent of this via token_version
// (apps/api/src/middleware/auth.ts) — extending this does NOT weaken that.
exports.REFRESH_TOKEN_TTL_MS = 400 * 24 * 60 * 60 * 1000;
const generateRefreshToken = (payload) => {
    return jsonwebtoken_1.default.sign(payload, JWT_REFRESH_SECRET, { expiresIn: '400d', jwtid: crypto_1.default.randomUUID() });
};
exports.generateRefreshToken = generateRefreshToken;
const verifyAccessToken = (token) => {
    return jsonwebtoken_1.default.verify(token, JWT_ACCESS_SECRET);
};
exports.verifyAccessToken = verifyAccessToken;
const verifyRefreshToken = (token) => {
    return jsonwebtoken_1.default.verify(token, JWT_REFRESH_SECRET);
};
exports.verifyRefreshToken = verifyRefreshToken;
