import { z } from 'zod';

export const EmptyBodySchema = z.object({}).strict();

export const EmployeeSelfUpdateSchema = z.object({
  full_name: z.string().min(1).optional(),
  phone: z.string().min(10).optional(),
  secondary_phone: z.string().optional().nullable(),
  whatsapp_number: z.string().optional().nullable(),
  current_address: z.string().optional().nullable(),
  permanent_address: z.string().optional().nullable(),
  emergency_contact_name: z.string().optional().nullable(),
  emergency_contact_relation: z.string().optional().nullable(),
  emergency_contact_phone: z.string().optional().nullable(),
  blood_group: z.string().optional().nullable(),
  social_links: z.string().optional().nullable(),
  pan_number: z
    .string()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Invalid PAN format')
    .optional()
    .nullable(),
  aadhaar_number: z
    .string()
    .regex(/^\d{12}$/, 'Aadhaar must be 12 digits')
    .optional()
    .nullable(),
  bank_name: z.string().optional().nullable(),
  bank_account_number: z.string().optional().nullable(),
  bank_ifsc: z
    .string()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC format')
    .optional()
    .nullable(),
  bank_branch: z.string().optional().nullable(),
});

export const EmployeeCreateSchema = z.object({
  full_name: z.string().min(1, 'Full name is required'),
  phone: z.string().min(10, 'Phone is required'),
  role_name: z.string().min(1, 'Role name is required'),
  branch_id: z.union([z.string(), z.number()]),
  secondary_phone: z.string().optional().nullable(),
  whatsapp_number: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  blood_group: z.string().optional().nullable(),
  social_links: z.string().optional().nullable(),
  current_address: z.string().optional().nullable(),
  permanent_address: z.string().optional().nullable(),
  emergency_contact_name: z.string().optional().nullable(),
  emergency_contact_relation: z.string().optional().nullable(),
  emergency_contact_phone: z.string().optional().nullable(),
  pan_number: z
    .string()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Invalid PAN format')
    .optional()
    .nullable(),
  aadhaar_number: z
    .string()
    .regex(/^\d{12}$/, 'Aadhaar must be 12 digits')
    .optional()
    .nullable(),
  bank_name: z.string().optional().nullable(),
  bank_account_number: z.string().optional().nullable(),
  bank_ifsc: z
    .string()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC format')
    .optional()
    .nullable(),
  bank_branch: z.string().optional().nullable(),
  job_title: z.string().optional().nullable(),
  department: z.string().optional().nullable(),
  employment_type: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']).optional().nullable(),
  reporting_manager_id: z.union([z.string(), z.number()]).optional().nullable(),
  date_of_joining: z.string().optional().nullable(),
  salary_ctc: z.union([z.string(), z.number()]).optional().nullable(),
  background_education: z.string().optional().nullable(),
  additional_branch_ids: z.array(z.union([z.string(), z.number()])).optional(),
  initial_password: z
    .string()
    .min(8, 'Password must be at least 8 characters long')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character')
    .optional()
    .nullable(),
  company_id: z.union([z.string(), z.number()]).optional().nullable(),
});

export const EmployeeUpdateSchema = EmployeeSelfUpdateSchema.extend({
  email: z.string().email().optional().nullable(),
  salary_ctc: z.union([z.string(), z.number()]).optional().nullable(),
  job_title: z.string().optional().nullable(),
  department: z.string().optional().nullable(),
  employment_type: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']).optional().nullable(),
  report_required: z.boolean().optional().nullable(),
  reporting_manager_id: z.union([z.string(), z.number()]).optional().nullable(),
  date_of_joining: z.string().optional().nullable(),
  background_education: z.string().optional().nullable(),
  branch_id: z.union([z.string(), z.number()]).optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'RESIGNED']).optional().nullable(),
  attendance_required: z.boolean().optional().nullable(),
  role_name: z.string().optional().nullable(),
});

export const EmployeeRolesUpdateSchema = z.object({
  role_names: z.array(z.string()).min(1, 'At least one role is required'),
});

export const EmployeeResignSchema = z.object({
  resignation_date: z.string().optional(),
  last_working_day: z.string().optional(),
  reason: z.string().optional(),
});

export const EmployeePromoteSchema = z
  .object({
    job_title: z.string().min(1).optional(),
    salary_ctc: z.union([z.string(), z.number()]).optional(),
    role_name: z.string().optional(),
    reason: z.string().optional(),
  })
  .refine((data) => data.job_title || data.salary_ctc !== undefined || data.role_name, {
    message: 'At least one of job_title, salary_ctc, or role_name must be provided',
  });

export const EmployeeConvertEmploymentTypeSchema = z.object({
  employment_type: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']),
});
