"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("../../utils/logger");
const express_1 = require("express");
const prisma_1 = require("../../lib/prisma");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const auth_1 = require("../../middleware/auth");
const authz_1 = require("../../middleware/authz");
const shared_1 = require("../../shared");
const authorization_1 = require("../../authz/authorization");
const notifyEmployee_1 = require("../../utils/notifyEmployee");
const validate_1 = require("../../middleware/validate");
const router = (0, express_1.Router)();
// POST /api/v1/employees/:id/reset-password - Admin 1-click Password Reset
router.post('/:id/reset-password', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.EMPLOYEES_RESET_PASSWORD), (0, validate_1.validateRequestBody)(shared_1.EmptyBodySchema), async (req, res) => {
    try {
        const employeeId = parseInt(req.params.id, 10);
        const targetEmployee = await prisma_1.prisma.employee.findUnique({ where: { id: employeeId } });
        if (!targetEmployee) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        if (!(0, authorization_1.can)(req.user, shared_1.Permissions.EMPLOYEES_RESET_PASSWORD, targetEmployee)) {
            return res
                .status(403)
                .json({ error: 'Forbidden: Cannot reset password for employee outside your company' });
        }
        const newHash = await bcryptjs_1.default.hash('Radhareal@123', 12);
        await prisma_1.prisma.$transaction(async (tx) => {
            await tx.employee.update({
                where: { id: employeeId },
                data: {
                    password_hash: newHash,
                    first_login_done: false,
                    token_version: { increment: 1 },
                },
            });
            await tx.authSession.updateMany({
                where: { employee_id: employeeId, revoked: false },
                data: { revoked: true, revocation_reason: 'ADMIN_PASSWORD_RESET' },
            });
        });
        // Notify employee their password was reset by admin
        await (0, notifyEmployee_1.notifyEmployee)(employeeId, {
            type: 'PASSWORD_RESET',
            title: '🔐 Your Password Has Been Reset',
            message: 'An administrator has reset your password to the default. Please log in and change it immediately.',
        });
        return res.status(200).json({
            message: 'Password reset to default (Password@123) successfully',
        });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to reset employee password' });
    }
});
// PUT /api/v1/employees/:id/roles - Update an employee's roles
router.put('/:id/roles', auth_1.authenticateToken, (0, validate_1.validateRequestBody)(shared_1.EmployeeRolesUpdateSchema), async (req, res) => {
    try {
        const employeeId = parseInt(req.params.id, 10);
        const { role_names } = req.body;
        if (!Array.isArray(role_names)) {
            return res.status(400).json({ error: 'role_names must be an array of strings' });
        }
        const userRoles = req.user.roles;
        const isUserAdmin = userRoles.includes(shared_1.Roles.ADMIN);
        const isUserMD = userRoles.includes(shared_1.Roles.MD);
        if (!isUserAdmin && !isUserMD) {
            return res.status(403).json({ error: 'Forbidden: Only MD or ADMIN can assign roles' });
        }
        const targetEmployee = await prisma_1.prisma.employee.findUnique({
            where: { id: employeeId },
            include: { branch: true },
        });
        if (!targetEmployee) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        // Tenant check: target employee must be in same company_id
        if (targetEmployee.branch?.company_id !== req.user.companyId && !isUserAdmin) {
            return res
                .status(403)
                .json({ error: 'Forbidden: Cannot manage roles for an employee outside your company' });
        }
        // Check if roles are valid according to shared constants
        const validRolesSet = new Set(Object.values(shared_1.Roles));
        for (const role of role_names) {
            if (!validRolesSet.has(role)) {
                return res.status(400).json({ error: `Invalid role: ${role}` });
            }
        }
        // Privilege escalation check
        if (role_names.includes(shared_1.Roles.ADMIN) && !isUserAdmin) {
            return res.status(403).json({ error: 'Forbidden: Only ADMIN can assign ADMIN role' });
        }
        // Check if removing the last MD in the company
        const currentRoles = await prisma_1.prisma.employeeRole.findMany({
            where: { employee_id: employeeId },
            include: { role: true },
        });
        const wasMD = currentRoles.some((r) => r.role.name === shared_1.Roles.MD);
        const willBeMD = role_names.includes(shared_1.Roles.MD);
        if (wasMD && !willBeMD) {
            const companyId = targetEmployee.branch?.company_id;
            if (companyId) {
                const otherMDs = await prisma_1.prisma.employeeRole.count({
                    where: {
                        role: { name: shared_1.Roles.MD },
                        employee_id: { not: employeeId },
                        employee: { branch: { company_id: companyId } },
                    },
                });
                if (otherMDs === 0) {
                    return res
                        .status(400)
                        .json({ error: 'Cannot remove the last Managing Director from the company' });
                }
            }
        }
        // Fetch role DB IDs
        const targetRoles = await prisma_1.prisma.role.findMany({
            where: { name: { in: role_names } },
        });
        if (targetRoles.length !== role_names.length) {
            return res.status(400).json({ error: 'One or more roles do not exist in the database' });
        }
        await prisma_1.prisma.$transaction(async (tx) => {
            // Clear existing roles
            await tx.employeeRole.deleteMany({ where: { employee_id: employeeId } });
            // Add new roles
            await tx.employeeRole.createMany({
                data: targetRoles.map((r) => ({
                    employee_id: employeeId,
                    role_id: r.id,
                })),
            });
            // Invalidate sessions
            await tx.employee.update({
                where: { id: employeeId },
                data: { token_version: { increment: 1 } },
            });
            await tx.authSession.updateMany({
                where: { employee_id: employeeId, revoked: false },
                data: { revoked: true, revocation_reason: 'AUTHORIZATION_CHANGED' },
            });
        });
        await (0, notifyEmployee_1.notifyEmployee)(employeeId, {
            type: 'ROLE_CHANGED',
            title: '🏷️ Your Roles Have Been Updated',
            message: 'Your system roles have been updated by an administrator. Please log in again to apply changes.',
        });
        return res.status(200).json({ message: 'Roles updated successfully' });
    }
    catch (error) {
        logger_1.logger.error('Update roles error:', error);
        return res.status(500).json({ error: 'Failed to update roles' });
    }
});
exports.default = router;
