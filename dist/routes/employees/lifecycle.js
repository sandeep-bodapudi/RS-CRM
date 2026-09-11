"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../../lib/prisma");
const auth_1 = require("../../middleware/auth");
const authz_1 = require("../../middleware/authz");
const shared_1 = require("../../shared");
const authorization_1 = require("../../authz/authorization");
const notifyEmployee_1 = require("../../utils/notifyEmployee");
const validate_1 = require("../../middleware/validate");
const router = (0, express_1.Router)();
// POST /api/v1/employees/:id/resign - Mark an employee as resigned
router.post('/:id/resign', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.EMPLOYEES_UPDATE), (0, validate_1.validateRequestBody)(shared_1.EmployeeResignSchema), async (req, res) => {
    try {
        const employeeId = parseInt(req.params.id, 10);
        const targetEmployee = await prisma_1.prisma.employee.findUnique({ where: { id: employeeId } });
        if (!targetEmployee) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        if (!(0, authorization_1.can)(req.user, shared_1.Permissions.EMPLOYEES_UPDATE, targetEmployee)) {
            return res
                .status(403)
                .json({ error: 'Forbidden: Cannot update an employee outside your company' });
        }
        const { resignation_date, last_working_day, reason } = req.body;
        const resignedAt = resignation_date ? new Date(resignation_date) : new Date();
        const lastDay = last_working_day ? new Date(last_working_day) : null;
        const updatedEmp = await prisma_1.prisma.$transaction(async (tx) => {
            const emp = await tx.employee.update({
                where: { id: employeeId },
                data: {
                    status: 'RESIGNED',
                    resignation_date: resignedAt,
                    last_working_day: lastDay,
                    token_version: { increment: 1 },
                },
            });
            await tx.authSession.updateMany({
                where: { employee_id: employeeId, revoked: false },
                data: { revoked: true, revocation_reason: 'AUTHORIZATION_CHANGED' },
            });
            await tx.auditEvent.create({
                data: {
                    actor_id: req.user.employeeId || 1,
                    action: 'EMPLOYEE_RESIGNED',
                    entity_type: 'EMPLOYEE',
                    entity_id: employeeId,
                    old_value: JSON.stringify({ status: targetEmployee.status }),
                    new_value: JSON.stringify({
                        status: 'RESIGNED',
                        resignation_date: resignedAt,
                        last_working_day: lastDay,
                    }),
                    reason: reason || null,
                },
            });
            return emp;
        });
        await (0, notifyEmployee_1.notifyEmployee)(employeeId, {
            type: 'STATUS_CHANGED',
            title: '📋 Resignation Recorded',
            message: lastDay
                ? `Your resignation has been recorded. Last working day: ${lastDay.toLocaleDateString('en-IN')}.`
                : 'Your resignation has been recorded. Contact HR for your last working day.',
        });
        return res.status(200).json({ message: 'Employee marked as resigned', employee: updatedEmp });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to record resignation' });
    }
});
// POST /api/v1/employees/:id/promote - Promote an employee (title/salary/role, with an audit trail)
router.post('/:id/promote', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.EMPLOYEES_UPDATE), (0, validate_1.validateRequestBody)(shared_1.EmployeePromoteSchema), async (req, res) => {
    try {
        const employeeId = parseInt(req.params.id, 10);
        const targetEmployee = await prisma_1.prisma.employee.findUnique({ where: { id: employeeId } });
        if (!targetEmployee) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        if (!(0, authorization_1.can)(req.user, shared_1.Permissions.EMPLOYEES_UPDATE, targetEmployee)) {
            return res
                .status(403)
                .json({ error: 'Forbidden: Cannot update an employee outside your company' });
        }
        const canViewSensitive = (0, authorization_1.can)(req.user, shared_1.Permissions.EMPLOYEES_VIEW_SENSITIVE, targetEmployee);
        if (req.body.salary_ctc !== undefined && !canViewSensitive) {
            return res.status(403).json({ error: 'Cannot modify salary' });
        }
        const { job_title, salary_ctc, role_name, reason } = req.body;
        const oldValue = {
            job_title: targetEmployee.job_title,
            salary_ctc: targetEmployee.salary_ctc,
        };
        const updateData = {};
        if (job_title !== undefined)
            updateData.job_title = job_title;
        if (salary_ctc !== undefined)
            updateData.salary_ctc = parseFloat(salary_ctc);
        const updatedEmp = await prisma_1.prisma.$transaction(async (tx) => {
            let roleChanged = false;
            if (role_name) {
                const targetRole = await tx.role.findUnique({ where: { name: role_name } });
                if (targetRole) {
                    const currentRoles = await tx.employeeRole.findMany({
                        where: { employee_id: employeeId },
                        include: { role: true },
                    });
                    roleChanged = !currentRoles.some((r) => r.role.name === role_name);
                    if (roleChanged) {
                        await tx.employeeRole.deleteMany({ where: { employee_id: employeeId } });
                        await tx.employeeRole.create({
                            data: { employee_id: employeeId, role_id: targetRole.id },
                        });
                    }
                }
            }
            if (roleChanged) {
                updateData.token_version = { increment: 1 };
            }
            const emp = await tx.employee.update({
                where: { id: employeeId },
                data: updateData,
                include: { roles: { include: { role: true } } },
            });
            if (roleChanged) {
                await tx.authSession.updateMany({
                    where: { employee_id: employeeId, revoked: false },
                    data: { revoked: true, revocation_reason: 'AUTHORIZATION_CHANGED' },
                });
            }
            await tx.auditEvent.create({
                data: {
                    actor_id: req.user.employeeId || 1,
                    action: 'EMPLOYEE_PROMOTED',
                    entity_type: 'EMPLOYEE',
                    entity_id: employeeId,
                    old_value: JSON.stringify(oldValue),
                    new_value: JSON.stringify({ job_title, salary_ctc, role_name }),
                    reason: reason || null,
                },
            });
            return emp;
        });
        await (0, notifyEmployee_1.notifyEmployee)(employeeId, {
            type: 'ROLE_CHANGED',
            title: '🎉 You Have Been Promoted',
            message: `Congratulations! ${job_title ? `New title: ${job_title}. ` : ''}${role_name ? `New role: ${role_name}. ` : ''}Please check with HR for details.`,
        });
        return res.status(200).json({ message: 'Employee promoted', employee: updatedEmp });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to promote employee' });
    }
});
// POST /api/v1/employees/:id/convert-employment-type - Convert between full-time/part-time/contract/intern
router.post('/:id/convert-employment-type', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.EMPLOYEES_UPDATE), (0, validate_1.validateRequestBody)(shared_1.EmployeeConvertEmploymentTypeSchema), async (req, res) => {
    try {
        const employeeId = parseInt(req.params.id, 10);
        const targetEmployee = await prisma_1.prisma.employee.findUnique({ where: { id: employeeId } });
        if (!targetEmployee) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        if (!(0, authorization_1.can)(req.user, shared_1.Permissions.EMPLOYEES_UPDATE, targetEmployee)) {
            return res
                .status(403)
                .json({ error: 'Forbidden: Cannot update an employee outside your company' });
        }
        const { employment_type } = req.body;
        const oldType = targetEmployee.employment_type;
        const updatedEmp = await prisma_1.prisma.$transaction(async (tx) => {
            const emp = await tx.employee.update({
                where: { id: employeeId },
                data: { employment_type },
            });
            await tx.auditEvent.create({
                data: {
                    actor_id: req.user.employeeId || 1,
                    action: 'EMPLOYEE_EMPLOYMENT_TYPE_CONVERTED',
                    entity_type: 'EMPLOYEE',
                    entity_id: employeeId,
                    old_value: JSON.stringify({ employment_type: oldType }),
                    new_value: JSON.stringify({ employment_type }),
                },
            });
            return emp;
        });
        await (0, notifyEmployee_1.notifyEmployee)(employeeId, {
            type: 'STATUS_CHANGED',
            title: '📄 Employment Type Updated',
            message: `Your employment type has been changed to ${employment_type.replace('_', ' ')}.`,
        });
        return res.status(200).json({ message: 'Employment type updated', employee: updatedEmp });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to convert employment type' });
    }
});
exports.default = router;
