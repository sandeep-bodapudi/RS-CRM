"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebAuthnService = void 0;
/**
 * webauthn.service.ts — § Phase 6 app-lock.
 *
 * A registered WebAuthn credential (Windows Hello / Touch ID / Android
 * fingerprint, or the platform's PIN fallback) is used ONLY to gate the
 * app-lock unlock flow — it never issues a session by itself. Unlocking
 * proves "the person in front of this device" and then the frontend calls
 * the pre-existing, already-secure /auth/refresh flow (rotating refresh
 * token, still valid in its httpOnly cookie the whole time) to get a fresh
 * access token back into memory. This keeps WebAuthn verification decoupled
 * from token issuance — no new token-minting code path, just a gate in
 * front of the one that already exists.
 *
 * Challenges are held in-process (a single Node instance is the deployment
 * target here — see PortalWorker/scheduler comments elsewhere in this repo
 * making the same assumption) rather than in the DB: they're short-lived,
 * single-use, and losing one on a restart just means the in-flight
 * ceremony has to be retried, not a security or data-loss issue.
 */
const server_1 = require("@simplewebauthn/server");
const helpers_1 = require("@simplewebauthn/server/helpers");
const prisma_1 = require("../lib/prisma");
const p = prisma_1.prisma;
const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes to complete a ceremony
const registrationChallenges = new Map();
const authenticationChallenges = new Map();
function getRpConfig() {
    // Same source of truth server.ts already uses for the CORS-allowed
    // frontend origin — one env var, not a second place to keep in sync.
    const origin = process.env.APP_URL || 'http://localhost:5173';
    const rpID = new URL(origin).hostname; // WebAuthn rpID is a bare domain, no protocol/port
    return { rpID, rpName: 'RRH CRM', origin };
}
function storeChallenge(map, employeeId, challenge) {
    map.set(employeeId, { challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS });
}
function takeChallenge(map, employeeId) {
    const entry = map.get(employeeId);
    map.delete(employeeId); // single-use regardless of outcome
    if (!entry || entry.expiresAt < Date.now()) {
        throw { status: 400, message: 'Challenge expired or not found — please try again.' };
    }
    return entry.challenge;
}
class WebAuthnService {
    static async hasAppLockEnabled(employeeId) {
        const count = await p.webAuthnCredential.count({ where: { employee_id: employeeId } });
        return count > 0;
    }
    static async listCredentials(employeeId) {
        return p.webAuthnCredential.findMany({
            where: { employee_id: employeeId },
            select: { id: true, device_label: true, created_at: true, last_used_at: true },
            orderBy: { created_at: 'desc' },
        });
    }
    static async deleteCredential(employeeId, credentialRowId) {
        const cred = await p.webAuthnCredential.findFirst({
            where: { id: credentialRowId, employee_id: employeeId },
        });
        if (!cred)
            throw { status: 404, message: 'Credential not found' };
        await p.webAuthnCredential.delete({ where: { id: cred.id } });
        return { deleted: true };
    }
    /** Step 1 of enabling app lock: generate options for navigator.credentials.create(). */
    static async startRegistration(employeeId, employeeName) {
        const { rpID, rpName } = getRpConfig();
        const existing = await p.webAuthnCredential.findMany({
            where: { employee_id: employeeId },
            select: { credential_id: true, transports: true },
        });
        const options = await (0, server_1.generateRegistrationOptions)({
            rpName,
            rpID,
            userName: employeeName,
            userID: helpers_1.isoUint8Array.fromUTF8String(String(employeeId)),
            attestationType: 'none',
            excludeCredentials: existing.map((c) => ({
                id: c.credential_id,
                transports: c.transports ? c.transports.split(',') : undefined,
            })),
            authenticatorSelection: {
                residentKey: 'preferred',
                userVerification: 'required', // must actually prove presence (biometric/PIN), not just "a key exists"
            },
        });
        storeChallenge(registrationChallenges, employeeId, options.challenge);
        return options;
    }
    /** Step 2: verify the browser's attestation and persist the credential. */
    static async finishRegistration(employeeId, response, deviceLabel) {
        const { rpID, origin } = getRpConfig();
        const expectedChallenge = takeChallenge(registrationChallenges, employeeId);
        const verification = await (0, server_1.verifyRegistrationResponse)({
            response,
            expectedChallenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
            requireUserVerification: true,
        });
        if (!verification.verified || !verification.registrationInfo) {
            throw { status: 400, message: 'Could not verify the new device — please try again.' };
        }
        const { credential } = verification.registrationInfo;
        await p.webAuthnCredential.create({
            data: {
                employee_id: employeeId,
                credential_id: credential.id,
                public_key: helpers_1.isoBase64URL.fromBuffer(credential.publicKey),
                counter: credential.counter,
                device_label: deviceLabel || null,
                transports: credential.transports ? credential.transports.join(',') : null,
            },
        });
        return { verified: true };
    }
    /** Step 1 of unlocking: generate options for navigator.credentials.get(). */
    static async startAuthentication(employeeId) {
        const { rpID } = getRpConfig();
        const credentials = await p.webAuthnCredential.findMany({
            where: { employee_id: employeeId },
            select: { credential_id: true, transports: true },
        });
        if (credentials.length === 0) {
            throw { status: 404, message: 'No app-lock device registered for this account.' };
        }
        const options = await (0, server_1.generateAuthenticationOptions)({
            rpID,
            allowCredentials: credentials.map((c) => ({
                id: c.credential_id,
                transports: c.transports ? c.transports.split(',') : undefined,
            })),
            userVerification: 'required',
        });
        storeChallenge(authenticationChallenges, employeeId, options.challenge);
        return options;
    }
    /** Step 2: verify the assertion. Does NOT issue any token — the caller
     * (the /auth/app-lock/unlock route) only returns `verified`; the frontend
     * then calls the existing /auth/refresh flow itself. */
    static async finishAuthentication(employeeId, response) {
        const { rpID, origin } = getRpConfig();
        const expectedChallenge = takeChallenge(authenticationChallenges, employeeId);
        const stored = await p.webAuthnCredential.findFirst({
            where: { employee_id: employeeId, credential_id: response.id },
        });
        if (!stored) {
            throw { status: 400, message: 'Unrecognized device for this account.' };
        }
        const credential = {
            id: stored.credential_id,
            publicKey: helpers_1.isoBase64URL.toBuffer(stored.public_key),
            counter: stored.counter,
            transports: stored.transports ? stored.transports.split(',') : undefined,
        };
        const verification = await (0, server_1.verifyAuthenticationResponse)({
            response,
            expectedChallenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
            credential,
            requireUserVerification: true,
        });
        if (!verification.verified) {
            throw {
                status: 401,
                message: 'Could not verify — try again or use a different registered device.',
            };
        }
        // Replay-attack defense: the authenticator's own signature counter must
        // strictly increase. Persisting the new value here is what makes a
        // cloned/replayed authenticator detectable on its next real use.
        await p.webAuthnCredential.update({
            where: { id: stored.id },
            data: { counter: verification.authenticationInfo.newCounter, last_used_at: new Date() },
        });
        return { verified: true };
    }
}
exports.WebAuthnService = WebAuthnService;
