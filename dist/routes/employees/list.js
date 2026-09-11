"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("../../utils/logger");
const express_1 = require("express");
const prisma_1 = require("../../lib/prisma");
const auth_1 = require("../../middleware/auth");
const authz_1 = require("../../middleware/authz");
const shared_1 = require("../../shared");
const authorization_1 = require("../../authz/authorization");
const crypto_1 = require("../../utils/crypto");
const dataScope_1 = require("../../authz/dataScope");
const router = (0, express_1.Router)();
// GET /api/v1/employees - List all active/inactive employees (Admin invisible filtered)
router.get('/', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.EMPLOYEES_READ), async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
        const offset = Math.max(parseInt(req.query.offset) || 0, 0);
        const whereClause = await (0, dataScope_1.buildEmployeeScope)(req.user);
        const roleQuery = req.query.role;
        if (roleQuery) {
            const roleCondition = {
                roles: {
                    some: {
                        role: {
                            name: {
                                equals: roleQuery,
                            },
                        },
                    },
                },
            };
            if (whereClause.AND) {
                whereClause.AND.push(roleCondition);
            }
            else {
                whereClause.AND = [roleCondition];
            }
        }
        const employees = await prisma_1.prisma.employee.findMany({
            take: limit,
            skip: offset,
            where: whereClause,
            include: {
                branch: true,
                roles: { include: { role: true } },
            },
            orderBy: { created_at: 'desc' },
        });
        const formatted = employees.map((emp) => ({
            id: emp.id,
            employeeCode: emp.employee_code,
            fullName: emp.full_name || emp.employee_code,
            branchId: emp.branch_id,
            branch: emp.branch?.name || 'All Branches',
            status: emp.status,
            attendanceRequired: emp.attendance_required,
            firstLoginDone: emp.first_login_done,
            roles: emp.roles.map((r) => r.role.name),
            createdAt: emp.created_at,
            phone: emp.phone || '',
            secondaryPhone: emp.secondary_phone || '',
            whatsappNumber: emp.whatsapp_number || '',
            email: emp.email || '',
            bloodGroup: emp.blood_group || '',
            socialLinks: emp.social_links || '',
            currentAddress: emp.current_address || '',
            permanentAddress: emp.permanent_address || '',
            emergencyContactName: emp.emergency_contact_name || '',
            emergencyContactRelation: emp.emergency_contact_relation || '',
            emergencyContactPhone: emp.emergency_contact_phone || '',
            // Decrypted here; the canViewSensitive check below still strips these
            // for unauthorized viewers before the response is sent.
            panNumber: (0, crypto_1.decryptData)(emp.pan_number) || '',
            aadhaarNumber: (0, crypto_1.decryptData)(emp.aadhaar_number) || '',
            bankName: (0, crypto_1.decryptData)(emp.bank_name) || '',
            bankAccountNumber: (0, crypto_1.decryptData)(emp.bank_account_number) || '',
            bankIfsc: (0, crypto_1.decryptData)(emp.bank_ifsc) || '',
            bankBranch: (0, crypto_1.decryptData)(emp.bank_branch) || '',
            jobTitle: emp.job_title || '',
            department: emp.department || '',
            employmentType: emp.employment_type || 'FULL_TIME',
            reportRequired: emp.report_required !== false,
            reportingManagerId: emp.reporting_manager_id,
            dateOfJoining: emp.date_of_joining ? emp.date_of_joining.toISOString().split('T')[0] : '',
            backgroundEducation: emp.background_education || '',
        }));
        // SENSITIVE DATA FILTERING (Stage 2)
        const canViewSensitive = (0, authorization_1.can)(req.user, shared_1.Permissions.EMPLOYEES_VIEW_SENSITIVE, {
            company_id: req.user.companyId,
        });
        if (!canViewSensitive) {
            formatted.forEach((emp) => {
                delete emp.panNumber;
                delete emp.aadhaarNumber;
                delete emp.bankName;
                delete emp.bankAccountNumber;
                delete emp.bankIfsc;
                delete emp.bankBranch;
                delete emp.salaryCtc;
            });
        }
        return res.status(200).json({ employees: formatted, pagination: { limit, offset } });
    }
    catch (error) {
        logger_1.logger.error('Fetch employees error:', error);
        return res.status(500).json({ error: 'Failed to fetch employees list' });
    }
});
// GET /api/v1/employees/branches - Get all branches for dropdown
// GET /api/v1/employees/branches - Get all branches for dropdown
router.get('/branches', auth_1.authenticateToken, async (req, res) => {
    try {
        const branches = await prisma_1.prisma.branch.findMany({
            where: {},
        });
        return res.status(200).json({ branches });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to fetch branches' });
    }
});
// GET /api/v1/employees/managers - Get list of reporting managers
// GET /api/v1/employees/managers - Get list of reporting managers
router.get('/managers', auth_1.authenticateToken, async (req, res) => {
    try {
        const managers = await prisma_1.prisma.employee.findMany({
            where: {
                company_id: req.user.companyId,
                roles: {
                    some: {
                        role: {
                            name: {
                                in: [
                                    shared_1.Roles.MD,
                                    shared_1.Roles.HR_MANAGER,
                                    shared_1.Roles.PROJECT_MANAGER,
                                    shared_1.Roles.MARKETING_DIRECTOR,
                                    shared_1.Roles.DIGITAL_MARKETING_HEAD,
                                ],
                            },
                        },
                    },
                },
            },
            select: {
                id: true,
                employee_code: true,
                full_name: true,
                job_title: true,
            },
        });
        const formatted = managers.map((m) => ({
            id: m.id,
            label: `${m.full_name || m.employee_code} (${m.job_title || 'Manager'}) - ${m.employee_code}`,
        }));
        return res.status(200).json({ managers: formatted });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to fetch managers' });
    }
});
// GET /api/v1/employees/demo-assignees - Eligible employees for manual demo-handler
// assignment (§ Phase 2/6): PM, Agent, Sales Manager, Channel Partner Manager, and
// the Managing Director (self-assign) — explicitly excludes Telecaller.
router.get('/demo-assignees', auth_1.authenticateToken, async (req, res) => {
    try {
        const assignees = await prisma_1.prisma.employee.findMany({
            where: {
                company_id: req.user.companyId,
                status: 'ACTIVE',
                roles: {
                    some: {
                        role: {
                            name: {
                                in: [
                                    shared_1.Roles.PROJECT_MANAGER,
                                    shared_1.Roles.AGENT,
                                    shared_1.Roles.SALES_MANAGER,
                                    shared_1.Roles.CHANNEL_PARTNER_MANAGER,
                                    shared_1.Roles.MD,
                                ],
                            },
                        },
                    },
                },
            },
            select: {
                id: true,
                employee_code: true,
                full_name: true,
                job_title: true,
                roles: { include: { role: true } },
            },
        });
        const formatted = assignees.map((e) => ({
            id: e.id,
            label: `${e.full_name || e.employee_code} (${e.job_title || e.roles.map((r) => r.role.name).join(', ')})`,
        }));
        return res.status(200).json({ assignees: formatted });
    }
    catch (error) {
        logger_1.logger.error('Fetch demo assignees error:', error);
        return res.status(500).json({ error: 'Failed to fetch eligible demo assignees' });
    }
});
exports.default = router;
