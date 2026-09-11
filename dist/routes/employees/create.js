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
const crypto_1 = require("../../utils/crypto");
const validate_1 = require("../../middleware/validate");
const router = (0, express_1.Router)();
// POST /api/v1/employees - Add new employee with all 20 industrial fields
router.post('/', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.EMPLOYEES_CREATE), (0, validate_1.validateRequestBody)(shared_1.EmployeeCreateSchema), async (req, res) => {
    try {
        const { full_name, phone, secondary_phone, whatsapp_number, email, blood_group, social_links, current_address, permanent_address, emergency_contact_name, emergency_contact_relation, emergency_contact_phone, pan_number, aadhaar_number, bank_name, bank_account_number, bank_ifsc, bank_branch, job_title, department, employment_type, reporting_manager_id, date_of_joining, salary_ctc, background_education, role_name, branch_id, additional_branch_ids, initial_password, } = req.body;
        if (!role_name || !branch_id || !full_name || !phone) {
            return res
                .status(400)
                .json({ error: 'Full Name, Primary Phone, Role, and Branch are required fields' });
        }
        const userRoles = req.user.roles;
        const isUserAdmin = userRoles.includes(shared_1.Roles.ADMIN);
        const isUserMD = userRoles.includes(shared_1.Roles.MD);
        if (role_name === shared_1.Roles.ADMIN && !isUserAdmin) {
            return res.status(403).json({ error: 'Forbidden: Only ADMIN can create ADMIN accounts' });
        }
        if (role_name === shared_1.Roles.MD && !isUserAdmin && !isUserMD) {
            return res
                .status(403)
                .json({ error: 'Forbidden: Only ADMIN or MD can create MD accounts' });
        }
        const parsedBranchId = parseInt(branch_id, 10);
        const branch = await prisma_1.prisma.branch.findUnique({ where: { id: parsedBranchId } });
        if (!branch) {
            return res.status(404).json({ error: 'Branch not found' });
        }
        if (!isUserAdmin && branch.company_id !== req.user.companyId) {
            return res
                .status(403)
                .json({ error: "Forbidden: Cannot create employee in another company's branch" });
        }
        const validAdditionalBranchIds = [];
        if (Array.isArray(additional_branch_ids)) {
            const additionalBranches = await prisma_1.prisma.branch.findMany({
                where: {
                    id: { in: additional_branch_ids.map((id) => parseInt(id, 10)) },
                    company_id: isUserAdmin && req.body.company_id
                        ? parseInt(req.body.company_id, 10)
                        : req.user.companyId,
                },
            });
            for (const b of additionalBranches) {
                if (b.id !== parsedBranchId)
                    validAdditionalBranchIds.push(b.id);
            }
        }
        // Resolve target company ID (Admin can specify, otherwise forced to actor's company)
        const targetCompanyId = isUserAdmin && req.body.company_id
            ? parseInt(req.body.company_id, 10)
            : req.user.companyId;
        const deptCode = shared_1.DepartmentCodes[role_name] || 'EX';
        let employeeCode = '';
        let isUnique = false;
        while (!isUnique) {
            const randomNum = Math.floor(1000 + Math.random() * 9000); // 4-digit random number
            employeeCode = `RRH-${deptCode}-${randomNum}`;
            const existing = await prisma_1.prisma.employee.findFirst({
                where: { employee_code: employeeCode },
            });
            if (!existing) {
                isUnique = true;
            }
        }
        const role = await prisma_1.prisma.role.findUnique({
            where: { name: role_name },
        });
        if (!role) {
            return res.status(400).json({ error: 'Invalid role specified' });
        }
        const passwordHash = await bcryptjs_1.default.hash(initial_password || 'Radhareal@123', 12);
        const isExempt = [shared_1.Roles.MD, shared_1.Roles.HR_MANAGER, shared_1.Roles.ADMIN, shared_1.Roles.MARKETING_DIRECTOR].includes(role_name);
        const newEmp = await prisma_1.prisma.employee.create({
            data: {
                employee_code: employeeCode,
                full_name,
                phone,
                secondary_phone,
                whatsapp_number: whatsapp_number || phone,
                email,
                blood_group: blood_group || 'O+',
                social_links,
                current_address,
                permanent_address: permanent_address || current_address,
                emergency_contact_name,
                emergency_contact_relation,
                emergency_contact_phone,
                pan_number: (0, crypto_1.encryptData)(pan_number),
                aadhaar_number: (0, crypto_1.encryptData)(aadhaar_number),
                bank_name: (0, crypto_1.encryptData)(bank_name),
                bank_account_number: (0, crypto_1.encryptData)(bank_account_number),
                bank_ifsc: (0, crypto_1.encryptData)(bank_ifsc),
                bank_branch: (0, crypto_1.encryptData)(bank_branch),
                job_title: job_title || role_name,
                department: department || 'Operations',
                employment_type: employment_type || 'FULL_TIME',
                report_required: employment_type === 'FULL_TIME',
                reporting_manager_id: reporting_manager_id ? parseInt(reporting_manager_id, 10) : null,
                date_of_joining: date_of_joining ? new Date(date_of_joining) : new Date(),
                salary_ctc: salary_ctc ? parseFloat(salary_ctc) : 35000,
                background_education,
                company_id: targetCompanyId,
                branch_id: parsedBranchId,
                password_hash: passwordHash,
                status: 'ACTIVE',
                attendance_required: !isExempt,
                first_login_done: false,
                roles: {
                    create: {
                        role_id: role.id,
                    },
                },
                branches: {
                    create: validAdditionalBranchIds.map((id) => ({ branch_id: id })),
                },
            },
            include: {
                branch: true,
                roles: { include: { role: true } },
                branches: { include: { branch: true } },
            },
        });
        return res.status(201).json({
            message: 'Employee created successfully',
            employee: {
                id: newEmp.id,
                employeeCode: newEmp.employee_code,
                fullName: newEmp.full_name,
                branch: newEmp.branch?.name || 'All Branches',
                additionalBranches: newEmp.branches.map((b) => b.branch.name),
                status: newEmp.status,
                attendanceRequired: newEmp.attendance_required,
                roles: newEmp.roles.map((r) => r.role.name),
                defaultPassword: initial_password || 'Radhareal@123',
            },
        });
    }
    catch (error) {
        logger_1.logger.error('Create employee error:', error);
        return res.status(500).json({ error: 'Failed to create employee' });
    }
});
exports.default = router;
