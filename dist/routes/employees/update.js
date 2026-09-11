"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../../lib/prisma");
const auth_1 = require("../../middleware/auth");
const authz_1 = require("../../middleware/authz");
const shared_1 = require("../../shared");
const authorization_1 = require("../../authz/authorization");
const notifyEmployee_1 = require("../../utils/notifyEmployee");
const crypto_1 = require("../../utils/crypto");
const validate_1 = require("../../middleware/validate");
const router = (0, express_1.Router)();
// PATCH /api/v1/employees/:id - Update employee status, branch, roles or any profile detail
router.patch('/:id', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.EMPLOYEES_UPDATE), (0, validate_1.validateRequestBody)(shared_1.EmployeeUpdateSchema), async (req, res) => {
    try {
        const employeeId = parseInt(req.params.id, 10);
        const targetEmployee = await prisma_1.prisma.employee.findUnique({ where: { id: employeeId } });
        if (!targetEmployee) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        // Phase 4: Record-level and company-level authorization
        if (!(0, authorization_1.can)(req.user, shared_1.Permissions.EMPLOYEES_UPDATE, targetEmployee)) {
            return res
                .status(403)
                .json({ error: 'Forbidden: Cannot update an employee outside your company' });
        }
        const canViewSensitive = (0, authorization_1.can)(req.user, shared_1.Permissions.EMPLOYEES_VIEW_SENSITIVE, targetEmployee);
        const body = req.body;
        // Privilege Escalation Check: Prevent self-promotion or assigning Admin/MD roles unless authorized
        if (body.role_name) {
            if (employeeId === req.user.employeeId && body.role_name !== targetEmployee.job_title) {
                return res
                    .status(403)
                    .json({ error: 'Forbidden: Cannot self-promote or change own role' });
            }
            if (body.role_name === shared_1.Roles.ADMIN && !req.user.roles.includes(shared_1.Roles.ADMIN)) {
                return res.status(403).json({ error: 'Forbidden: Only Admin can assign Admin role' });
            }
            if (body.role_name === shared_1.Roles.MD &&
                !req.user.roles.includes(shared_1.Roles.ADMIN) &&
                !req.user.roles.includes(shared_1.Roles.MD)) {
                return res.status(403).json({ error: 'Forbidden: Only MD or Admin can assign MD role' });
            }
        }
        const updateData = {};
        if (body.full_name !== undefined)
            updateData.full_name = body.full_name;
        if (body.phone !== undefined)
            updateData.phone = body.phone;
        if (body.secondary_phone !== undefined)
            updateData.secondary_phone = body.secondary_phone;
        if (body.whatsapp_number !== undefined)
            updateData.whatsapp_number = body.whatsapp_number;
        if (body.email !== undefined)
            updateData.email = body.email;
        if (body.blood_group !== undefined)
            updateData.blood_group = body.blood_group;
        if (body.social_links !== undefined)
            updateData.social_links = body.social_links;
        if (body.current_address !== undefined)
            updateData.current_address = body.current_address;
        if (body.permanent_address !== undefined)
            updateData.permanent_address = body.permanent_address;
        if (body.emergency_contact_name !== undefined)
            updateData.emergency_contact_name = body.emergency_contact_name;
        if (body.emergency_contact_relation !== undefined)
            updateData.emergency_contact_relation = body.emergency_contact_relation;
        if (body.emergency_contact_phone !== undefined)
            updateData.emergency_contact_phone = body.emergency_contact_phone;
        // Reject attempt to modify sensitive fields if unauthorized (BEFORE generic auth)
        if (!canViewSensitive) {
            if (body.pan_number !== undefined ||
                body.aadhaar_number !== undefined ||
                body.bank_name !== undefined ||
                body.bank_account_number !== undefined ||
                body.bank_ifsc !== undefined ||
                body.bank_branch !== undefined ||
                body.salary_ctc !== undefined) {
                return res.status(403).json({ error: 'Cannot modify sensitive fields' });
            }
        }
        else {
            // KYC — encrypted at rest (Phase 1.4). Previously written as plaintext
            // here, bypassing encryptData() entirely even though the employee-create
            // path already encrypted these same fields.
            if (body.pan_number !== undefined)
                updateData.pan_number = (0, crypto_1.encryptData)(body.pan_number);
            if (body.aadhaar_number !== undefined)
                updateData.aadhaar_number = (0, crypto_1.encryptData)(body.aadhaar_number);
            if (body.bank_name !== undefined)
                updateData.bank_name = (0, crypto_1.encryptData)(body.bank_name);
            if (body.bank_account_number !== undefined)
                updateData.bank_account_number = (0, crypto_1.encryptData)(body.bank_account_number);
            if (body.bank_ifsc !== undefined)
                updateData.bank_ifsc = (0, crypto_1.encryptData)(body.bank_ifsc);
            if (body.bank_branch !== undefined)
                updateData.bank_branch = (0, crypto_1.encryptData)(body.bank_branch);
            if (body.salary_ctc !== undefined)
                updateData.salary_ctc = parseFloat(body.salary_ctc);
        }
        if (body.job_title !== undefined)
            updateData.job_title = body.job_title;
        if (body.department !== undefined)
            updateData.department = body.department;
        if (body.employment_type !== undefined)
            updateData.employment_type = body.employment_type;
        if (body.report_required !== undefined)
            updateData.report_required = Boolean(body.report_required);
        if (body.reporting_manager_id !== undefined)
            updateData.reporting_manager_id = body.reporting_manager_id
                ? parseInt(body.reporting_manager_id, 10)
                : null;
        if (body.date_of_joining !== undefined)
            updateData.date_of_joining = new Date(body.date_of_joining);
        if (body.background_education !== undefined)
            updateData.background_education = body.background_education;
        if (body.branch_id !== undefined)
            updateData.branch_id = parseInt(body.branch_id, 10);
        if (body.status !== undefined)
            updateData.status = body.status;
        if (body.attendance_required !== undefined)
            updateData.attendance_required = Boolean(body.attendance_required);
        let shouldRevokeSessions = false;
        if (body.status !== undefined && body.status !== targetEmployee.status) {
            shouldRevokeSessions = true;
        }
        const updatedEmp = await prisma_1.prisma.$transaction(async (tx) => {
            if (body.role_name) {
                const targetRole = await tx.role.findUnique({ where: { name: body.role_name } });
                if (targetRole) {
                    const currentRoles = await tx.employeeRole.findMany({
                        where: { employee_id: employeeId },
                        include: { role: true },
                    });
                    const hasDifferentRole = !currentRoles.some((r) => r.role.name === body.role_name);
                    if (hasDifferentRole) {
                        shouldRevokeSessions = true;
                    }
                    await tx.employeeRole.deleteMany({ where: { employee_id: employeeId } });
                    await tx.employeeRole.create({
                        data: {
                            employee_id: employeeId,
                            role_id: targetRole.id,
                        },
                    });
                }
            }
            if (shouldRevokeSessions) {
                updateData.token_version = { increment: 1 };
            }
            const emp = await tx.employee.update({
                where: { id: employeeId },
                data: updateData,
                include: {
                    branch: true,
                    roles: { include: { role: true } },
                },
            });
            if (shouldRevokeSessions) {
                await tx.authSession.updateMany({
                    where: { employee_id: employeeId, revoked: false },
                    data: { revoked: true, revocation_reason: 'AUTHORIZATION_CHANGED' },
                });
            }
            return emp;
        });
        // ── Universal Notifications ──────────────────────────────────
        // Notify the employee for every significant profile change
        const notifyPromises = [];
        if (body.salary_ctc !== undefined) {
            notifyPromises.push((0, notifyEmployee_1.notifyEmployee)(employeeId, {
                type: 'SALARY_CHANGED',
                title: '💰 Your Salary Has Been Updated',
                message: `Your monthly CTC has been updated to ₹${parseFloat(body.salary_ctc).toLocaleString('en-IN')}. Please contact HR for any queries.`,
            }));
        }
        if (body.role_name) {
            notifyPromises.push((0, notifyEmployee_1.notifyEmployee)(employeeId, {
                type: 'ROLE_CHANGED',
                title: '🏷️ Your Role Has Been Updated',
                message: `Your position has been updated to "${body.role_name}". Please check with your manager for next steps.`,
            }));
        }
        if (body.status !== undefined) {
            const statusMessages = {
                ACTIVE: '✅ Your account has been activated.',
                INACTIVE: '⚠️ Your account has been deactivated. Contact HR for details.',
                SUSPENDED: '🚫 Your account has been suspended. Contact HR immediately.',
            };
            const msg = statusMessages[body.status] || `Your account status was changed to ${body.status}.`;
            notifyPromises.push((0, notifyEmployee_1.notifyEmployee)(employeeId, {
                type: 'STATUS_CHANGED',
                title: '🔔 Account Status Changed',
                message: msg,
            }));
        }
        if (body.branch_id !== undefined) {
            notifyPromises.push((0, notifyEmployee_1.notifyEmployee)(employeeId, {
                type: 'BRANCH_CHANGED',
                title: '🏢 Your Branch/Department Has Changed',
                message: `You have been transferred to a new branch/department. Please check with HR for your reporting details.`,
            }));
        }
        if (body.job_title !== undefined) {
            notifyPromises.push((0, notifyEmployee_1.notifyEmployee)(employeeId, {
                type: 'JOB_TITLE_CHANGED',
                title: '💼 Your Job Title Has Been Updated',
                message: `Your job title has been updated to "${body.job_title}".`,
            }));
        }
        await Promise.allSettled(notifyPromises);
        // ─────────────────────────────────────────────────────────────
        // Sensitive-field response filtering (Phase 1.4): the write side above
        // already gates these fields by canViewSensitive; the response was not
        // doing the same, so a caller with EMPLOYEES_UPDATE but not
        // EMPLOYEES_VIEW_SENSITIVE (e.g. updating just job_title) got the
        // target employee's encrypted-or-plaintext KYC/bank fields back
        // anyway. Now decrypted for authorized viewers, stripped otherwise —
        // matching the GET /employees list route's existing behavior.
        const responseEmployee = { ...updatedEmp };
        if (canViewSensitive) {
            responseEmployee.pan_number = (0, crypto_1.decryptData)(updatedEmp.pan_number);
            responseEmployee.aadhaar_number = (0, crypto_1.decryptData)(updatedEmp.aadhaar_number);
            responseEmployee.bank_name = (0, crypto_1.decryptData)(updatedEmp.bank_name);
            responseEmployee.bank_account_number = (0, crypto_1.decryptData)(updatedEmp.bank_account_number);
            responseEmployee.bank_ifsc = (0, crypto_1.decryptData)(updatedEmp.bank_ifsc);
            responseEmployee.bank_branch = (0, crypto_1.decryptData)(updatedEmp.bank_branch);
        }
        else {
            delete responseEmployee.pan_number;
            delete responseEmployee.aadhaar_number;
            delete responseEmployee.bank_name;
            delete responseEmployee.bank_account_number;
            delete responseEmployee.bank_ifsc;
            delete responseEmployee.bank_branch;
            delete responseEmployee.salary_ctc;
        }
        return res.status(200).json({
            message: 'Employee details updated successfully',
            employee: responseEmployee,
        });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to update employee' });
    }
});
exports.default = router;
