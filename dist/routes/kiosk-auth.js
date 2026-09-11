"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KioskCredentialUpdateSchema = exports.KioskCredentialCreateSchema = exports.KioskLoginSchema = void 0;
const logger_1 = require("../utils/logger");
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
const jwt_1 = require("../utils/jwt");
const auth_1 = require("../middleware/auth");
const shared_1 = require("../shared");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const validate_1 = require("../middleware/validate");
const zod_1 = require("zod");
const router = (0, express_1.Router)();
const p = prisma_1.prisma;
// ── Kiosk schemas ──────────────────────────────────────────────────────────
exports.KioskLoginSchema = zod_1.z.object({
    username: zod_1.z.string().trim().min(1, 'username is required'),
    password: zod_1.z.string().min(1, 'password is required'),
});
exports.KioskCredentialCreateSchema = zod_1.z.object({
    branch_id: zod_1.z.number().int().positive('branch_id is required'),
    label: zod_1.z.string().trim().min(1, 'label is required'),
    username: zod_1.z.string().trim().min(1, 'username is required'),
    password: zod_1.z.string().min(8, 'password must be at least 8 characters'),
});
exports.KioskCredentialUpdateSchema = zod_1.z.object({
    label: zod_1.z.string().trim().min(1).optional(),
    password: zod_1.z.string().min(8).optional(),
    is_active: zod_1.z.boolean().optional(),
    branch_id: zod_1.z.number().int().positive().optional(),
});
// ── POST /api/v1/kiosk-auth/login ──────────────────────────────────────────
// No auth middleware — this IS the login endpoint.
router.post('/login', (0, validate_1.validateRequestBody)(exports.KioskLoginSchema), async (req, res) => {
    try {
        const body = req.body;
        const { username, password } = body;
        const creds = await p.kioskCredential.findMany({
            where: { username },
            include: { branch: true, company: true },
        });
        if (creds.length === 0) {
            return res.status(401).json({ error: 'Invalid kiosk credentials', code: 'UNAUTHORIZED' });
        }
        let matchedCred = null;
        for (const c of creds) {
            if (!c.is_active)
                continue;
            const match = await bcryptjs_1.default.compare(password, c.password_hash);
            if (match) {
                matchedCred = c;
                break;
            }
        }
        if (!matchedCred) {
            return res.status(401).json({ error: 'Invalid kiosk credentials', code: 'UNAUTHORIZED' });
        }
        const companyId = matchedCred.company_id;
        const tokenPayload = {
            type: 'KIOSK',
            companyId,
            branchId: matchedCred.branch_id,
            kioskCredentialId: matchedCred.id,
            credentialVersion: matchedCred.credential_version,
            createdAt: Date.now(),
        };
        // § Phase 6: kiosk tokens have no refresh flow at all (they're not staff
        // sessions), so they used to just die after the shared 24h default and
        // need re-login. Confirmed acceptable to extend indefinitely: a kiosk
        // token carries no employee identity/permissions, is scoped only to
        // attendance-scan endpoints (authenticateKioskToken), and revocation
        // stays instant via credential_version (rotating the kiosk password or
        // toggling it inactive immediately invalidates every outstanding token
        // for that device) — "never expires by time" here still means
        // "always revocable on demand."
        const accessToken = (0, jwt_1.generateAccessToken)(tokenPayload, '3650d');
        await p.auditEvent.create({
            data: {
                actor_id: matchedCred.id,
                action: 'KIOSK_LOGIN',
                entity_type: 'KIOSK_CREDENTIAL',
                entity_id: matchedCred.id,
                new_value: JSON.stringify({
                    branch_name: matchedCred.branch.name,
                    label: matchedCred.label,
                }),
            },
        });
        return res.status(200).json({
            message: 'Kiosk login successful',
            accessToken,
            branchId: matchedCred.branch_id,
            branchName: matchedCred.branch.name,
            label: matchedCred.label,
        });
    }
    catch (error) {
        logger_1.logger.error('Kiosk login error:', error);
        return res.status(500).json({ error: 'Kiosk authentication failed' });
    }
});
// ── POST /api/v1/kiosk-credentials ──────────────────────────────────────────
router.post('/', auth_1.authenticateToken, (0, auth_1.requireRole)([shared_1.Roles.MD, shared_1.Roles.ADMIN]), (0, validate_1.validateRequestBody)(exports.KioskCredentialCreateSchema), async (req, res) => {
    try {
        const body = req.body;
        const { branch_id, label, username, password } = body;
        const companyId = req.user.companyId;
        const employeeId = req.user.employeeId;
        const branch = await p.branch.findUnique({ where: { id: branch_id } });
        if (!branch || branch.company_id !== companyId) {
            return res.status(400).json({ error: 'Branch does not belong to your company' });
        }
        const existing = await p.kioskCredential.findFirst({
            where: { company_id: companyId, username },
        });
        if (existing) {
            return res.status(409).json({ error: 'Username already exists in this company' });
        }
        const passwordHash = await bcryptjs_1.default.hash(password, 12);
        const cred = await p.kioskCredential.create({
            data: {
                company_id: companyId,
                branch_id,
                label,
                username,
                password_hash: passwordHash,
                is_active: true,
                credential_version: 1,
                created_by_id: employeeId,
            },
        });
        const branchName = (await p.branch.findUnique({ where: { id: branch_id } })).name;
        await p.auditEvent.create({
            data: {
                actor_id: employeeId,
                action: 'KIOSK_CREDENTIAL_CREATED',
                entity_type: 'KIOSK_CREDENTIAL',
                entity_id: cred.id,
                new_value: JSON.stringify({
                    branch_id,
                    branch_name: branchName,
                    label,
                    username,
                    company_id: companyId,
                }),
            },
        });
        return res.status(201).json({
            message: 'Kiosk credential created',
            credential: {
                id: cred.id,
                branch_id: cred.branch_id,
                branch_name: branchName,
                label: cred.label,
                username: cred.username,
                is_active: cred.is_active,
                credential_version: cred.credential_version,
                created_by_id: cred.created_by_id,
                created_at: cred.created_at,
            },
        });
    }
    catch (error) {
        logger_1.logger.error('Kiosk credential create error:', error);
        if (error.code === 'P2002') {
            return res.status(409).json({ error: 'Username already exists in this company' });
        }
        return res.status(500).json({ error: 'Failed to create kiosk credential' });
    }
});
// ── PATCH /api/v1/kiosk-credentials/:id ────────────────────────────────────
router.patch('/:id', auth_1.authenticateToken, (0, auth_1.requireRole)([shared_1.Roles.MD, shared_1.Roles.ADMIN]), (0, validate_1.validateRequestBody)(exports.KioskCredentialUpdateSchema), async (req, res) => {
    try {
        const { id } = req.params;
        const body = req.body;
        const { label, password, is_active, branch_id } = body;
        const companyId = req.user.companyId;
        const existing = await p.kioskCredential.findUnique({
            where: { id: Number(id) },
            include: { branch: true },
        });
        if (!existing) {
            return res.status(404).json({ error: 'Kiosk credential not found' });
        }
        if (existing.company_id !== companyId) {
            return res.status(403).json({ error: 'Credential does not belong to your company' });
        }
        const updateData = {};
        const changedFields = [];
        if (label !== undefined) {
            updateData.label = label;
            changedFields.push('label');
        }
        if (is_active !== undefined) {
            updateData.is_active = is_active;
            changedFields.push('is_active');
        }
        const versionBumpNeeded = password !== undefined || is_active !== undefined;
        if (password !== undefined) {
            updateData.password_hash = await bcryptjs_1.default.hash(password, 12);
            changedFields.push('password');
        }
        if (branch_id !== undefined) {
            const newBranch = await p.branch.findUnique({ where: { id: branch_id } });
            if (!newBranch || newBranch.company_id !== companyId) {
                return res.status(400).json({ error: 'New branch does not belong to your company' });
            }
            updateData.branch_id = branch_id;
            changedFields.push('branch_id');
        }
        if (versionBumpNeeded) {
            updateData.credential_version = { increment: 1 };
        }
        const updated = await p.kioskCredential.update({
            where: { id: Number(id) },
            data: updateData,
        });
        const newBranchName = branch_id !== undefined
            ? (await p.branch.findUnique({ where: { id: branch_id } })).name
            : existing.branch.name;
        await p.auditEvent.create({
            data: {
                actor_id: req.user.employeeId,
                action: 'KIOSK_CREDENTIAL_UPDATED',
                entity_type: 'KIOSK_CREDENTIAL',
                entity_id: updated.id,
                old_value: JSON.stringify({
                    label: existing.label,
                    is_active: existing.is_active,
                    credential_version: existing.credential_version,
                    branch_id: existing.branch_id,
                    branch_name: existing.branch.name,
                }),
                new_value: JSON.stringify({
                    label: updated.label,
                    is_active: updated.is_active,
                    credential_version: updated.credential_version,
                    branch_id: updated.branch_id,
                    branch_name: newBranchName,
                    changed_fields: changedFields,
                }),
            },
        });
        return res.status(200).json({
            message: 'Kiosk credential updated',
            credential: {
                id: updated.id,
                branch_id: updated.branch_id,
                branch_name: newBranchName,
                label: updated.label,
                username: updated.username,
                is_active: updated.is_active,
                credential_version: updated.credential_version,
                created_by_id: updated.created_by_id,
                created_at: updated.created_at,
                updated_at: updated.updated_at,
            },
        });
    }
    catch (error) {
        logger_1.logger.error('Kiosk credential update error:', error);
        return res.status(500).json({ error: 'Failed to update kiosk credential' });
    }
});
// ── GET /api/v1/kiosk-credentials ───────────────────────────────────────────
router.get('/', auth_1.authenticateToken, (0, auth_1.requireRole)([shared_1.Roles.MD, shared_1.Roles.ADMIN]), async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const credentials = await p.kioskCredential.findMany({
            where: { company_id: companyId },
            orderBy: { created_at: 'desc' },
        });
        // Fetch branch names for all credentials in one query
        const branchIds = credentials.map((c) => c.branch_id);
        const branches = await p.branch.findMany({
            where: { id: { in: branchIds } },
            select: { id: true, name: true },
        });
        const branchMap = new Map(branches.map((b) => [b.id, b.name]));
        return res.status(200).json({
            credentials: credentials.map((c) => ({
                id: c.id,
                branch_id: c.branch_id,
                branch_name: branchMap.get(c.branch_id) || 'Unknown',
                label: c.label,
                username: c.username,
                is_active: c.is_active,
                credential_version: c.credential_version,
                created_by_id: c.created_by_id,
                created_at: c.created_at,
                updated_at: c.updated_at,
                company_id: c.company_id,
            })),
        });
    }
    catch (error) {
        logger_1.logger.error('Kiosk credentials list error:', error);
        return res.status(500).json({ error: 'Failed to list kiosk credentials' });
    }
});
exports.default = router;
