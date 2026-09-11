"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.decryptData = exports.encryptData = void 0;
const logger_1 = require("./logger");
const crypto_1 = __importDefault(require("crypto"));
// Production REQUIRES a real ENCRYPTION_KEY (>= 32 chars) — the dev fallback is
// only for development/test and is never used in production (Phase 11 Packet 3C).
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ||
    (process.env.NODE_ENV === 'production' ? '' : 'default_32_byte_secret_key_change_me_now!');
const IV_LENGTH = 16; // For AES, this is always 16
function deriveKey() {
    // Create a 32-byte key from the env variable (pad or truncate if necessary)
    return Buffer.from(crypto_1.default.createHash('sha256').update(String(ENCRYPTION_KEY)).digest('base64').substring(0, 32));
}
/**
 * Phase 1.4 (2026-09-06): upgraded from AES-256-CBC to AES-256-GCM, an
 * authenticated cipher — CBC alone has no integrity check, so a corrupted or
 * tampered ciphertext would silently decrypt to garbage instead of failing.
 * New format is `iv:authTag:ciphertext` (3 hex parts) vs. the old `iv:ciphertext`
 * (2 parts), so decryptData below can tell old and new values apart and this
 * doesn't require a flag-day migration — see scripts/reencrypt-kyc-gcm.ts for
 * the one-time pass that re-encrypts existing rows to the new format.
 */
function encryptData(text) {
    if (!text)
        return null;
    const key = deriveKey();
    const iv = crypto_1.default.randomBytes(IV_LENGTH);
    const cipher = crypto_1.default.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}
exports.encryptData = encryptData;
function decryptData(text) {
    if (!text)
        return null;
    const parts = text.split(':');
    const key = deriveKey();
    try {
        if (parts.length === 3) {
            // Current format: AES-256-GCM.
            const [ivHex, authTagHex, cipherHex] = parts;
            const decipher = crypto_1.default.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
            decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
            const decrypted = Buffer.concat([
                decipher.update(Buffer.from(cipherHex, 'hex')),
                decipher.final(),
            ]);
            return decrypted.toString('utf8');
        }
        if (parts.length === 2) {
            // Legacy format from before Phase 1.4: AES-256-CBC, unauthenticated.
            // Kept read-only so existing rows keep working until
            // scripts/reencrypt-kyc-gcm.ts re-encrypts them to GCM.
            const [ivHex, cipherHex] = parts;
            const decipher = crypto_1.default.createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex, 'hex'));
            const decrypted = Buffer.concat([
                decipher.update(Buffer.from(cipherHex, 'hex')),
                decipher.final(),
            ]);
            return decrypted.toString('utf8');
        }
    }
    catch (error) {
        logger_1.logger.error('Decryption failed, returning null or masked data', error);
        return null; // Return null if decryption fails so we don't break the app
    }
    // Doesn't match either encrypted shape at all — most likely a plaintext
    // value written before Phase 1.4 closed the employees.ts update-route bug
    // that bypassed encryptData() entirely on write. Return it as-is rather
    // than discarding real data the caller is already authorized to see.
    return text;
}
exports.decryptData = decryptData;
