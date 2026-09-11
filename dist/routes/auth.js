"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("../utils/logger");
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const crypto_1 = __importDefault(require("crypto"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const jwt_1 = require("../utils/jwt");
const auth_1 = require("../middleware/auth");
const shared_1 = require("../shared");
const validate_1 = require("../middleware/validate");
const rateLimiter_1 = require("../middleware/rateLimiter");
const media_1 = require("../utils/media");
const router = (0, express_1.Router)();
const p = prisma_1.prisma;
// POST /api/v1/auth/login
router.post('/login', rateLimiter_1.loginRateLimiter, (0, validate_1.validateRequestBody)(shared_1.LoginSchema), async (req, res) => {
    try {
        const { employee_code, password } = req.body;
        // Find active employee by employee_code
        const employee = await p.employee.findUnique({
            where: { employee_code },
            include: {
                company: true,
                branch: true,
                roles: {
                    include: {
                        role: {
                            include: { permissions: { include: { permission: true } } },
                        },
                    },
                },
                permission_overrides: { include: { permission: true } },
            },
        });
        if (!employee || employee.status !== 'ACTIVE') {
            await p.auditEvent.create({
                data: {
                    actor_id: 0,
                    action: 'SECURITY_ALERT',
                    entity_type: 'AUTH_FAILED',
                    entity_id: 0,
                    new_value: `Attempted login with invalid/inactive code`,
                },
            });
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const isMatch = await bcryptjs_1.default.compare(password, employee.password_hash);
        if (!isMatch) {
            await p.auditEvent.create({
                data: {
                    actor_id: employee.id,
                    action: 'SECURITY_ALERT',
                    entity_type: 'AUTH_FAILED',
                    entity_id: employee.id,
                    new_value: `Invalid password attempt`,
                },
            });
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const roleNames = employee.roles.map((r) => r.role.name);
        const permissionsSet = new Set();
        employee.roles.forEach((r) => {
            if (r.role.permissions) {
                r.role.permissions.forEach((rp) => permissionsSet.add(rp.permission.name));
            }
        });
        if (employee.permission_overrides) {
            employee.permission_overrides.forEach((po) => {
                if (po.is_granted)
                    permissionsSet.add(po.permission.name);
                else
                    permissionsSet.delete(po.permission.name);
            });
        }
        const permissions = Array.from(permissionsSet);
        const tokenPayload = {
            employeeId: employee.id,
            employeeCode: employee.employee_code,
            companyId: employee.company_id,
            branchId: employee.branch_id,
            roles: roleNames,
            permissions,
            tokenVersion: employee.token_version,
        };
        const accessToken = (0, jwt_1.generateAccessToken)(tokenPayload);
        const refreshToken = (0, jwt_1.generateRefreshToken)(tokenPayload);
        const refreshTokenHash = crypto_1.default.createHash('sha256').update(refreshToken).digest('hex');
        const familyToken = crypto_1.default.randomUUID();
        await p.authSession.create({
            data: {
                employee_id: employee.id,
                family_token: familyToken,
                refresh_token_hash: refreshTokenHash,
                expires_at: new Date(Date.now() + jwt_1.REFRESH_TOKEN_TTL_MS),
            },
        });
        // Reset rate limiter on success
        const ip = req.ip || req.headers['x-forwarded-for'] || 'UNKNOWN_IP';
        rateLimiter_1.loginRateLimiter.resetKey(ip);
        // Set httpOnly refresh cookie
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: jwt_1.REFRESH_TOKEN_TTL_MS,
        });
        return res.status(200).json({
            message: 'Login successful',
            accessToken,
            refreshToken, // Return in body for IndexedDB storage fallback
            firstLoginDone: employee.first_login_done,
            attendanceRequired: employee.attendance_required,
            user: {
                id: employee.id,
                employeeCode: employee.employee_code,
                fullName: employee.full_name,
                department: employee.department,
                company: employee.company?.name || 'RS CRM',
                branch: employee.branch?.name || 'All Branches',
                roles: roleNames,
                permissions,
                attendanceRequired: employee.attendance_required,
                firstLoginDone: employee.first_login_done,
                phone: employee.phone,
                secondaryPhone: employee.secondary_phone,
                whatsappNumber: employee.whatsapp_number,
                email: employee.email,
                bloodGroup: employee.blood_group,
                socialLinks: employee.social_links,
                currentAddress: employee.current_address,
                permanentAddress: employee.permanent_address,
                emergencyContactName: employee.emergency_contact_name,
                emergencyContactRelation: employee.emergency_contact_relation,
                emergencyContactPhone: employee.emergency_contact_phone,
                profileImageUrl: (0, media_1.publicAssetUrl)(employee.profile_image_url),
                panNumber: employee.pan_number,
                aadhaarNumber: employee.aadhaar_number,
                bankName: employee.bank_name,
                bankAccountNumber: employee.bank_account_number,
                bankIfsc: employee.bank_ifsc,
                bankBranch: employee.bank_branch,
            },
        });
    }
    catch (error) {
        logger_1.logger.error('Login error:', error);
        return res.status(500).json({ error: 'Authentication failed' });
    }
});
// POST /api/v1/auth/change-password
router.post('/change-password', auth_1.authenticateToken, (0, validate_1.validateRequestBody)(shared_1.ChangePasswordSchema), async (req, res) => {
    try {
        const { current_password, new_password } = req.body;
        const employeeId = req.user.employeeId;
        const employee = await p.employee.findUnique({
            where: { id: employeeId },
        });
        if (!employee) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        const match = await bcryptjs_1.default.compare(current_password, employee.password_hash);
        if (!match) {
            return res.status(400).json({ error: 'Current password is incorrect' });
        }
        const newHash = await bcryptjs_1.default.hash(new_password, 12);
        await p.$transaction(async (tx) => {
            await tx.employee.update({
                where: { id: employeeId },
                data: {
                    password_hash: newHash,
                    first_login_done: true,
                    token_version: { increment: 1 },
                },
            });
            await tx.authSession.updateMany({
                where: { employee_id: employeeId, revoked: false },
                data: { revoked: true, revocation_reason: 'PASSWORD_CHANGED' },
            });
        });
        // Fetch updated employee for new token version
        const updatedEmployee = await p.employee.findUnique({
            where: { id: employeeId },
            include: {
                roles: {
                    include: { role: { include: { permissions: { include: { permission: true } } } } },
                },
                permission_overrides: { include: { permission: true } },
                company: true,
                branch: true,
            },
        });
        if (!updatedEmployee) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        const roleNames = updatedEmployee.roles.map((r) => r.role.name);
        const permissionsSet = new Set();
        updatedEmployee.roles.forEach((r) => {
            if (r.role.permissions) {
                r.role.permissions.forEach((rp) => permissionsSet.add(rp.permission.name));
            }
        });
        if (updatedEmployee.permission_overrides) {
            updatedEmployee.permission_overrides.forEach((po) => {
                if (po.is_granted)
                    permissionsSet.add(po.permission.name);
                else
                    permissionsSet.delete(po.permission.name);
            });
        }
        const permissions = Array.from(permissionsSet);
        const tokenPayload = {
            employeeId: updatedEmployee.id,
            employeeCode: updatedEmployee.employee_code,
            companyId: updatedEmployee.company_id,
            branchId: updatedEmployee.branch_id,
            roles: roleNames,
            permissions,
            tokenVersion: updatedEmployee.token_version,
        };
        const accessToken = (0, jwt_1.generateAccessToken)(tokenPayload);
        const refreshToken = (0, jwt_1.generateRefreshToken)(tokenPayload);
        const refreshTokenHash = crypto_1.default.createHash('sha256').update(refreshToken).digest('hex');
        const familyToken = crypto_1.default.randomUUID();
        await p.authSession.create({
            data: {
                employee_id: updatedEmployee.id,
                family_token: familyToken,
                refresh_token_hash: refreshTokenHash,
                expires_at: new Date(Date.now() + jwt_1.REFRESH_TOKEN_TTL_MS),
            },
        });
        // Set httpOnly refresh cookie
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: jwt_1.REFRESH_TOKEN_TTL_MS,
        });
        return res.status(200).json({
            message: 'Password updated successfully',
            accessToken,
            refreshToken, // Return in body for IndexedDB storage fallback
            firstLoginDone: true,
            user: {
                id: updatedEmployee.id,
                employeeCode: updatedEmployee.employee_code,
                fullName: updatedEmployee.full_name,
                department: updatedEmployee.department,
                company: updatedEmployee.company?.name || 'RS CRM',
                branch: updatedEmployee.branch?.name || 'All Branches',
                roles: roleNames,
                permissions,
                attendanceRequired: updatedEmployee.attendance_required,
                firstLoginDone: updatedEmployee.first_login_done,
            },
        });
    }
    catch (error) {
        logger_1.logger.error('Change password error:', error);
        return res.status(500).json({ error: 'Failed to update password' });
    }
});
// GET /api/v1/auth/me
router.get('/me', auth_1.authenticateToken, async (req, res) => {
    try {
        const employee = await p.employee.findUnique({
            where: { id: req.user.employeeId },
            include: {
                company: true,
                branch: true,
                roles: {
                    include: { role: { include: { permissions: { include: { permission: true } } } } },
                },
                permission_overrides: { include: { permission: true } },
            },
        });
        if (!employee) {
            return res.status(404).json({ error: 'User profile not found' });
        }
        const roleNames = employee.roles.map((r) => r.role.name);
        const permissionsSet = new Set();
        employee.roles.forEach((r) => {
            if (r.role.permissions) {
                r.role.permissions.forEach((rp) => permissionsSet.add(rp.permission.name));
            }
        });
        if (employee.permission_overrides) {
            employee.permission_overrides.forEach((po) => {
                if (po.is_granted)
                    permissionsSet.add(po.permission.name);
                else
                    permissionsSet.delete(po.permission.name);
            });
        }
        const permissions = Array.from(permissionsSet);
        return res.status(200).json({
            user: {
                id: employee.id,
                employeeCode: employee.employee_code,
                fullName: employee.full_name,
                company: employee.company.name,
                branch: employee.branch?.name || 'All Branches',
                department: employee.department,
                roles: roleNames,
                permissions,
                attendanceRequired: employee.attendance_required,
                firstLoginDone: employee.first_login_done,
                phone: employee.phone,
                secondaryPhone: employee.secondary_phone,
                whatsappNumber: employee.whatsapp_number,
                email: employee.email,
                bloodGroup: employee.blood_group,
                socialLinks: employee.social_links,
                currentAddress: employee.current_address,
                permanentAddress: employee.permanent_address,
                emergencyContactName: employee.emergency_contact_name,
                emergencyContactRelation: employee.emergency_contact_relation,
                emergencyContactPhone: employee.emergency_contact_phone,
                profileImageUrl: (0, media_1.publicAssetUrl)(employee.profile_image_url),
                panNumber: employee.pan_number,
                aadhaarNumber: employee.aadhaar_number,
                bankName: employee.bank_name,
                bankAccountNumber: employee.bank_account_number,
                bankIfsc: employee.bank_ifsc,
                bankBranch: employee.bank_branch,
            },
        });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to fetch user profile' });
    }
});
const zod_1 = require("zod");
const EmptyBodySchema = zod_1.z.object({}).strict();
router.post('/refresh', rateLimiter_1.refreshRateLimiter, (0, validate_1.validateRequestBody)(EmptyBodySchema), async (req, res) => {
    try {
        const refreshToken = req.cookies?.refreshToken || req.headers['x-refresh-token'];
        if (!refreshToken) {
            return res.status(401).json({ error: 'Refresh token required', code: 'UNAUTHORIZED' });
        }
        try {
            jsonwebtoken_1.default.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
        }
        catch (err) {
            return res
                .status(401)
                .json({ error: 'Invalid or expired refresh token', code: 'TOKEN_EXPIRED' });
        }
        const refreshTokenHash = crypto_1.default.createHash('sha256').update(refreshToken).digest('hex');
        // Find session inside transaction to prevent concurrent refresh races
        const result = await p.$transaction(async (tx) => {
            const session = await tx.authSession.findFirst({
                where: { refresh_token_hash: refreshTokenHash },
            });
            if (!session)
                return { error: 'Invalid session', status: 401 };
            if (session.revoked)
                return { error: 'Session revoked', status: 401 };
            if (session.consumed) {
                // Reuse detection!
                await tx.authSession.updateMany({
                    where: { family_token: session.family_token },
                    data: { revoked: true, revocation_reason: 'REFRESH_TOKEN_REUSE_DETECTED' },
                });
                await tx.auditEvent.create({
                    data: {
                        actor_id: session.employee_id,
                        action: 'SECURITY_ALERT',
                        entity_type: 'TOKEN_FAMILY_REVOKED',
                        entity_id: session.employee_id,
                        new_value: `Refresh token reuse detected`,
                    },
                });
                return { error: 'Session compromised', status: 401 };
            }
            // Mark old token as consumed ATOMICALLY
            const updateResult = await tx.authSession.updateMany({
                where: { id: session.id, consumed: false },
                data: { consumed: true },
            });
            if (updateResult.count === 0) {
                // Concurrent refresh race condition: another request just consumed it!
                await tx.authSession.updateMany({
                    where: { family_token: session.family_token },
                    data: { revoked: true, revocation_reason: 'REFRESH_TOKEN_REUSE_DETECTED' },
                });
                await tx.auditEvent.create({
                    data: {
                        actor_id: session.employee_id,
                        action: 'SECURITY_ALERT',
                        entity_type: 'TOKEN_FAMILY_REVOKED',
                        entity_id: session.employee_id,
                        new_value: `Refresh token reuse detected`,
                    },
                });
                return { error: 'Session compromised', status: 401 };
            }
            return { session };
        });
        if (result.error) {
            res.clearCookie('refreshToken');
            return res.status(result.status).json({ error: result.error, code: 'UNAUTHORIZED' });
        }
        const session = result.session;
        if (!session) {
            res.clearCookie('refreshToken');
            return res.status(401).json({ error: 'Invalid session data', code: 'UNAUTHORIZED' });
        }
        // Fetch employee for fresh permissions
        const employee = await p.employee.findUnique({
            where: { id: session.employee_id },
            include: {
                roles: {
                    include: { role: { include: { permissions: { include: { permission: true } } } } },
                },
                permission_overrides: { include: { permission: true } },
            },
        });
        if (!employee || employee.status !== 'ACTIVE') {
            res.clearCookie('refreshToken');
            return res.status(401).json({ error: 'Account inactive', code: 'UNAUTHORIZED' });
        }
        const roleNames = employee.roles.map((r) => r.role.name);
        const permissionsSet = new Set();
        employee.roles.forEach((r) => {
            if (r.role.permissions) {
                r.role.permissions.forEach((rp) => permissionsSet.add(rp.permission.name));
            }
        });
        if (employee.permission_overrides) {
            employee.permission_overrides.forEach((po) => {
                if (po.is_granted)
                    permissionsSet.add(po.permission.name);
                else
                    permissionsSet.delete(po.permission.name);
            });
        }
        const tokenPayload = {
            employeeId: employee.id,
            employeeCode: employee.employee_code,
            companyId: employee.company_id,
            branchId: employee.branch_id,
            roles: roleNames,
            permissions: Array.from(permissionsSet),
            tokenVersion: employee.token_version,
        };
        const newAccessToken = (0, jwt_1.generateAccessToken)(tokenPayload);
        const newRefreshToken = (0, jwt_1.generateRefreshToken)(tokenPayload);
        const newRefreshTokenHash = crypto_1.default.createHash('sha256').update(newRefreshToken).digest('hex');
        await p.authSession.create({
            data: {
                employee_id: employee.id,
                family_token: session.family_token,
                refresh_token_hash: newRefreshTokenHash,
                expires_at: new Date(Date.now() + jwt_1.REFRESH_TOKEN_TTL_MS),
            },
        });
        res.cookie('refreshToken', newRefreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: jwt_1.REFRESH_TOKEN_TTL_MS,
        });
        return res.status(200).json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
    }
    catch (error) {
        logger_1.logger.error('Refresh error:', error);
        return res.status(500).json({ error: 'Refresh failed' });
    }
});
router.post('/logout', (0, validate_1.validateRequestBody)(EmptyBodySchema), async (req, res) => {
    const refreshToken = req.cookies?.refreshToken || req.headers['x-refresh-token'];
    if (refreshToken) {
        const refreshTokenHash = crypto_1.default.createHash('sha256').update(refreshToken).digest('hex');
        await p.authSession.updateMany({
            where: { refresh_token_hash: refreshTokenHash },
            data: { revoked: true, revocation_reason: 'LOGGED_OUT' },
        });
    }
    res.clearCookie('refreshToken', { path: '/' });
    return res.status(200).json({ message: 'Logged out successfully' });
});
exports.default = router;
