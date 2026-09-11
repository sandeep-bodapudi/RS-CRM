"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmployeeConvertEmploymentTypeSchema = exports.EmployeePromoteSchema = exports.EmployeeResignSchema = exports.EmployeeRolesUpdateSchema = exports.EmployeeUpdateSchema = exports.EmployeeCreateSchema = exports.EmployeeSelfUpdateSchema = exports.EmptyBodySchema = void 0;
const zod_1 = require("zod");
exports.EmptyBodySchema = zod_1.z.object({}).strict();
exports.EmployeeSelfUpdateSchema = zod_1.z.object({
    full_name: zod_1.z.string().min(1).optional(),
    phone: zod_1.z.string().min(10).optional(),
    secondary_phone: zod_1.z.string().optional().nullable(),
    whatsapp_number: zod_1.z.string().optional().nullable(),
    current_address: zod_1.z.string().optional().nullable(),
    permanent_address: zod_1.z.string().optional().nullable(),
    emergency_contact_name: zod_1.z.string().optional().nullable(),
    emergency_contact_relation: zod_1.z.string().optional().nullable(),
    emergency_contact_phone: zod_1.z.string().optional().nullable(),
    blood_group: zod_1.z.string().optional().nullable(),
    social_links: zod_1.z.string().optional().nullable(),
    pan_number: zod_1.z
        .string()
        .regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Invalid PAN format')
        .optional()
        .nullable(),
    aadhaar_number: zod_1.z
        .string()
        .regex(/^\d{12}$/, 'Aadhaar must be 12 digits')
        .optional()
        .nullable(),
    bank_name: zod_1.z.string().optional().nullable(),
    bank_account_number: zod_1.z.string().optional().nullable(),
    bank_ifsc: zod_1.z
        .string()
        .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC format')
        .optional()
        .nullable(),
    bank_branch: zod_1.z.string().optional().nullable(),
});
exports.EmployeeCreateSchema = zod_1.z.object({
    full_name: zod_1.z.string().min(1, 'Full name is required'),
    phone: zod_1.z.string().min(10, 'Phone is required'),
    role_name: zod_1.z.string().min(1, 'Role name is required'),
    branch_id: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]),
    secondary_phone: zod_1.z.string().optional().nullable(),
    whatsapp_number: zod_1.z.string().optional().nullable(),
    email: zod_1.z.string().email().optional().nullable(),
    blood_group: zod_1.z.string().optional().nullable(),
    social_links: zod_1.z.string().optional().nullable(),
    current_address: zod_1.z.string().optional().nullable(),
    permanent_address: zod_1.z.string().optional().nullable(),
    emergency_contact_name: zod_1.z.string().optional().nullable(),
    emergency_contact_relation: zod_1.z.string().optional().nullable(),
    emergency_contact_phone: zod_1.z.string().optional().nullable(),
    pan_number: zod_1.z
        .string()
        .regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Invalid PAN format')
        .optional()
        .nullable(),
    aadhaar_number: zod_1.z
        .string()
        .regex(/^\d{12}$/, 'Aadhaar must be 12 digits')
        .optional()
        .nullable(),
    bank_name: zod_1.z.string().optional().nullable(),
    bank_account_number: zod_1.z.string().optional().nullable(),
    bank_ifsc: zod_1.z
        .string()
        .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC format')
        .optional()
        .nullable(),
    bank_branch: zod_1.z.string().optional().nullable(),
    job_title: zod_1.z.string().optional().nullable(),
    department: zod_1.z.string().optional().nullable(),
    employment_type: zod_1.z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']).optional().nullable(),
    reporting_manager_id: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).optional().nullable(),
    date_of_joining: zod_1.z.string().optional().nullable(),
    salary_ctc: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).optional().nullable(),
    background_education: zod_1.z.string().optional().nullable(),
    additional_branch_ids: zod_1.z.array(zod_1.z.union([zod_1.z.string(), zod_1.z.number()])).optional(),
    initial_password: zod_1.z
        .string()
        .min(8, 'Password must be at least 8 characters long')
        .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
        .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
        .regex(/[0-9]/, 'Password must contain at least one number')
        .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character')
        .optional()
        .nullable(),
    company_id: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).optional().nullable(),
});
exports.EmployeeUpdateSchema = exports.EmployeeSelfUpdateSchema.extend({
    email: zod_1.z.string().email().optional().nullable(),
    salary_ctc: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).optional().nullable(),
    job_title: zod_1.z.string().optional().nullable(),
    department: zod_1.z.string().optional().nullable(),
    employment_type: zod_1.z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']).optional().nullable(),
    report_required: zod_1.z.boolean().optional().nullable(),
    reporting_manager_id: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).optional().nullable(),
    date_of_joining: zod_1.z.string().optional().nullable(),
    background_education: zod_1.z.string().optional().nullable(),
    branch_id: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).optional().nullable(),
    status: zod_1.z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'RESIGNED']).optional().nullable(),
    attendance_required: zod_1.z.boolean().optional().nullable(),
    role_name: zod_1.z.string().optional().nullable(),
});
exports.EmployeeRolesUpdateSchema = zod_1.z.object({
    role_names: zod_1.z.array(zod_1.z.string()).min(1, 'At least one role is required'),
});
exports.EmployeeResignSchema = zod_1.z.object({
    resignation_date: zod_1.z.string().optional(),
    last_working_day: zod_1.z.string().optional(),
    reason: zod_1.z.string().optional(),
});
exports.EmployeePromoteSchema = zod_1.z
    .object({
    job_title: zod_1.z.string().min(1).optional(),
    salary_ctc: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).optional(),
    role_name: zod_1.z.string().optional(),
    reason: zod_1.z.string().optional(),
})
    .refine((data) => data.job_title || data.salary_ctc !== undefined || data.role_name, {
    message: 'At least one of job_title, salary_ctc, or role_name must be provided',
});
exports.EmployeeConvertEmploymentTypeSchema = zod_1.z.object({
    employment_type: zod_1.z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']),
});
