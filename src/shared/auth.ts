import { z } from 'zod';

export const CompanySchema = z.object({
  id: z.number().int(),
  name: z.string().min(2),
  code: z.string(),
  property_type_group: z.enum(['RADHA_REAL_HOMES', 'SONTHILLU']),
});

export type Company = z.infer<typeof CompanySchema>;

// Roles
export const Roles = {
  MD: 'Managing director',
  ADMIN: 'Admin (Technical)',
  MARKETING_DIRECTOR: 'marketing director',
  PROJECT_MANAGER: 'project managers',
  DIGITAL_LEAD_OPERATOR: 'Digital lead operator',
  TELECALLER: 'telecallers',
  DIGITAL_MARKETING_HEAD: 'Digital Marketing head(manager)',
  HR_MANAGER: 'HR',
  FINANCE: 'accountant',
  AGENT: 'Agent',
  DIGITAL_MARKETING_EXECUTIVE: 'digital marketing executive',
  SALES_MANAGER: 'Sales manager',
  CHANNEL_PARTNER_MANAGER: 'Channel partner manager'
} as const;

export type RoleName = typeof Roles[keyof typeof Roles];

// Permanent 2-Letter Department Codes for Employee IDs: RRH-{DEPT_2DIGIT}-{NUMBER_3DIGIT}
// Employee IDs remain static and permanent for life even when promoted!
export const DepartmentCodes: Record<string, string> = {
  [Roles.MD]: 'EX',
  [Roles.ADMIN]: 'EX',
  [Roles.HR_MANAGER]: 'HR',
  [Roles.TELECALLER]: 'SL',
  [Roles.AGENT]: 'SL',
  [Roles.PROJECT_MANAGER]: 'OP',
  [Roles.DIGITAL_MARKETING_EXECUTIVE]: 'MK',
  [Roles.DIGITAL_MARKETING_HEAD]: 'MK',
  [Roles.DIGITAL_LEAD_OPERATOR]: 'MK',
  [Roles.FINANCE]: 'FN',
  [Roles.MARKETING_DIRECTOR]: 'MK',
  [Roles.SALES_MANAGER]: 'SL',
  [Roles.CHANNEL_PARTNER_MANAGER]: 'CP',
};

// Canonical Permissions Model (Phase 1 - Stage 2 Blueprint Section 7)
export const Permissions = {
  EMPLOYEES_CREATE: 'employees.create',
  EMPLOYEES_READ: 'employees.read',
  EMPLOYEES_UPDATE: 'employees.update',
  EMPLOYEES_DELETE: 'employees.delete',
  EMPLOYEES_VIEW_SENSITIVE: 'employees.view_sensitive',
  EMPLOYEES_MANAGE_DEFAULT_ALL: 'employees.manage_default:all',
  EMPLOYEES_RESET_PASSWORD: 'employees.reset_password',
  
  LEADS_CREATE: 'leads.create',
  LEADS_READ: 'leads.read',
  LEADS_UPDATE: 'leads.update',
  LEADS_DELETE: 'leads.delete',
  LEADS_ASSIGN: 'leads.assign',
  LEADS_BULK_UPLOAD: 'leads.bulk_upload',
  LEADS_DISTRIBUTION_MONITOR: 'leads.distribution_monitor',
  LEADS_WHATSAPP_PROPOSAL: 'leads.whatsapp_proposal',
  
  CUSTOMERS_CREATE: 'customers.create',
  CUSTOMERS_READ: 'customers.read',
  CUSTOMERS_UPDATE: 'customers.update',
  CUSTOMERS_DELETE: 'customers.delete',
  CUSTOMERS_CONVERT: 'customers.convert',
  CUSTOMERS_KYC_WRITE: 'customers.kyc_write',
  
  PROPERTIES_CREATE: 'properties.create',
  PROPERTIES_READ: 'properties.read',
  PROPERTIES_UPDATE: 'properties.update',
  PROPERTIES_DELETE: 'properties.delete',
  PROPERTIES_VERIFY: 'properties.verify',
  PROPERTIES_DM_POLISH: 'properties.dm_polish',
  PROPERTIES_MD_APPROVE: 'properties.md_approve',
  
  SITE_VISITS_CREATE: 'site_visits.create',
  SITE_VISITS_READ: 'site_visits.read',
  SITE_VISITS_VERIFY: 'site_visits.verify',
  SITE_VISITS_ASSIGN_AGENT: 'site_visits.assign_agent',
  SITE_VISITS_COMPLETE: 'site_visits.complete',
  
  PROJECTS_CREATE: 'projects.create',
  PROJECTS_READ: 'projects.read',
  PROJECTS_UPDATE: 'projects.update',
  PROJECTS_DELETE: 'projects.delete',
  
  BOOKINGS_CREATE: 'bookings.create',
  BOOKINGS_READ: 'bookings.read',
  BOOKINGS_UPDATE: 'bookings.update',
  BOOKINGS_CANCEL: 'bookings.cancel',
  BOOKINGS_CONFIRM: 'bookings.confirm',
  BOOKINGS_FORM_SUBMIT: 'bookings.form_submit',     // Digital Lead Operator fills & submits the initiation form
  BOOKINGS_MD_APPROVE: 'bookings.md_approve',       // MD-only: approve or reject submitted booking forms
  BOOKINGS_LEGACY_CREATE: 'bookings.legacy_create', // Create backdated legacy/old bookings
  
  PAYMENTS_CREATE: 'payments.create',
  PAYMENTS_READ: 'payments.read',
  PAYMENTS_UPDATE: 'payments.update',
  PAYMENTS_CANCEL: 'payments.cancel',
  
  TASKS_CREATE: 'tasks.create',
  TASKS_READ: 'tasks.read',
  TASKS_UPDATE: 'tasks.update',
  TASKS_ASSIGN: 'tasks.assign',
  
  ATTENDANCE_READ_OWN: 'attendance.read_own',
  ATTENDANCE_SCAN: 'attendance.scan',
  ATTENDANCE_LATE_PROPOSAL: 'attendance.late_proposal',
  ATTENDANCE_LEAVE_PROPOSAL: 'attendance.leave_proposal',
  ATTENDANCE_PROPOSALS_QUEUE: 'attendance.proposals_queue',
  ATTENDANCE_LIVE_MONITOR: 'attendance.live_monitor',
  
  REPORTS_CREATE: 'reports.create',
  REPORTS_READ_OWN: 'reports.read_own',
  REPORTS_READ_TEAM: 'reports.read_team',
  REPORTS_TARGETS_CONFIGURE: 'reports.targets.configure',
  
  EXPENSES_CREATE: 'expenses.create',
  EXPENSES_READ_OWN: 'expenses.read_own',
  EXPENSES_REVIEW: 'expenses.review',
  EXPENSES_MD_APPROVE: 'expenses.md_approve',
  EXPENSES_MARK_REFUNDED: 'expenses.mark_refunded',
  
  PERFORMANCE_READ_OWN: 'performance.read_own',
  PERFORMANCE_READ_TEAM: 'performance.read_team',
  PERFORMANCE_HISTORY: 'performance.history',
  
  ADMIN_SYSTEM_METRICS: 'admin.system_metrics',
  ADMIN_AUDIT_LOGS: 'admin.audit_logs',
  ADMIN_SECURITY_ALERTS: 'admin.security_alerts',
  ADMIN_EMERGENCY_LOCKDOWN: 'admin.emergency_lockdown',
  MESSAGE_TEMPLATES_MANAGE: 'message_templates.manage', // §5 admin template editor
  
  PUBLIC_PROPERTIES_READ: 'public.properties.read',
  PUBLIC_LEADS_CREATE: 'public.leads.create',

  AI_SEARCH: 'ai.search',
  
  DOCUMENTS_CREATE: 'documents.create',
  DOCUMENTS_READ: 'documents.read',
  DOCUMENTS_VERIFY: 'documents.verify',
  DOCUMENTS_DELETE: 'documents.delete',
  COMPLAINTS_CREATE: 'complaints.create',
  COMPLAINTS_READ: 'complaints.read',
  COMPLAINTS_UPDATE: 'complaints.update',
  COMPLAINTS_ASSIGN: 'complaints.assign',
  COMPLAINTS_RESOLVE: 'complaints.resolve',
  COMPLAINTS_CLOSE: 'complaints.close',
} as const;

export type Permission = typeof Permissions[keyof typeof Permissions];

export const ALL_PERMISSIONS = Object.values(Permissions);

// Role -> Permission Matrix (Phase 1 - Stage 2 Blueprint Section 8)
export const RolePermissionsMatrix: Record<RoleName, string[]> = {
  [Roles.MD]: ALL_PERMISSIONS, // MD gets all permissions
  
  [Roles.ADMIN]: ALL_PERMISSIONS, // Admin is a second fully-privileged account alongside MD (2026-09-07 -- previously a curated list that excluded EMPLOYEES_VIEW_SENSITIVE and all LEADS_* permissions, which blocked real Admin usage; product decision was to match MD instead of narrowing the gaps one by one).
  
  [Roles.HR_MANAGER]: [
    Permissions.EMPLOYEES_CREATE,
    Permissions.EMPLOYEES_READ,
    Permissions.EMPLOYEES_UPDATE,
    Permissions.EMPLOYEES_RESET_PASSWORD,
    Permissions.EMPLOYEES_VIEW_SENSITIVE,
    Permissions.ATTENDANCE_PROPOSALS_QUEUE,
    Permissions.ATTENDANCE_LIVE_MONITOR,
    Permissions.TASKS_CREATE,
    Permissions.TASKS_READ,
    Permissions.TASKS_UPDATE,
    Permissions.TASKS_ASSIGN,
    Permissions.REPORTS_READ_TEAM,
    Permissions.PERFORMANCE_READ_TEAM,
    Permissions.DOCUMENTS_CREATE,
    Permissions.DOCUMENTS_READ,
    Permissions.CUSTOMERS_KYC_WRITE,
    Permissions.EXPENSES_CREATE,
    Permissions.EXPENSES_READ_OWN,
  ],

  [Roles.FINANCE]: [
    Permissions.EXPENSES_REVIEW,
    Permissions.EXPENSES_MARK_REFUNDED,
    Permissions.EXPENSES_CREATE,
    Permissions.EXPENSES_READ_OWN,
    Permissions.EMPLOYEES_VIEW_SENSITIVE, // Finance receives authorized sensitive fields
    Permissions.BOOKINGS_READ,
    Permissions.BOOKINGS_UPDATE,
    Permissions.PAYMENTS_CREATE,
    Permissions.PAYMENTS_READ,
    Permissions.PAYMENTS_UPDATE,
    Permissions.PAYMENTS_CANCEL,
    Permissions.DOCUMENTS_CREATE,
    Permissions.DOCUMENTS_READ,
    Permissions.DOCUMENTS_VERIFY,
    Permissions.CUSTOMERS_KYC_WRITE,
    Permissions.COMPLAINTS_READ,
    // Phase-19 audit #4: Finance now sees a "My Active Leads" count on its
    // dashboard, scoped in the query layer to leads assigned to that employee.
    Permissions.LEADS_READ,
  ],
  
[Roles.MARKETING_DIRECTOR]: [
    Permissions.TASKS_CREATE,
    Permissions.LEADS_CREATE,
    Permissions.LEADS_READ,
    Permissions.LEADS_UPDATE,
    Permissions.LEADS_DELETE,
    Permissions.LEADS_ASSIGN,
    Permissions.LEADS_BULK_UPLOAD,
    Permissions.CUSTOMERS_CREATE,
    Permissions.CUSTOMERS_READ,
    Permissions.CUSTOMERS_UPDATE,
    Permissions.CUSTOMERS_DELETE,
    Permissions.CUSTOMERS_CONVERT,
    // EMPLOYEES_READ is required so this role can see the employee list when
    // assigning a property to a Digital Marketing Executive for DM Polish
    // (PropertyManagement.tsx's "Assign to Digital Marketing Executive"
    // dropdown queries GET /employees, which 403s without this).
    Permissions.EMPLOYEES_READ,
    // PROPERTIES_READ is required alongside DM_POLISH/MD_APPROVE, not just the
    // two action permissions — there is no single-property fetch endpoint in
    // this codebase (routes/properties/crud.ts has GET '/' only), so without
    // it GET /properties itself 403s and this role can never even see the
    // list to find a property needing polish or approval. Found via the
    // Phase 5.3 manual QA pass.
    Permissions.PROPERTIES_READ,
    Permissions.PROPERTIES_DM_POLISH,
    Permissions.PROPERTIES_MD_APPROVE, // Per Section 8 participation
    Permissions.SITE_VISITS_READ,
    Permissions.REPORTS_TARGETS_CONFIGURE,
    Permissions.REPORTS_READ_TEAM,
    Permissions.PERFORMANCE_READ_TEAM,
    Permissions.BOOKINGS_READ,
    Permissions.PAYMENTS_READ,
    Permissions.DOCUMENTS_CREATE,
    Permissions.DOCUMENTS_READ,
      Permissions.EXPENSES_CREATE,
    Permissions.EXPENSES_READ_OWN,
  ],
  
  [Roles.PROJECT_MANAGER]: [
    Permissions.PROJECTS_CREATE,
    Permissions.PROJECTS_READ,
    Permissions.PROJECTS_UPDATE,
    Permissions.PROJECTS_DELETE,
    Permissions.PROPERTIES_CREATE,
    Permissions.PROPERTIES_VERIFY,
    Permissions.PROPERTIES_READ,
    Permissions.PROPERTIES_UPDATE,
    Permissions.SITE_VISITS_READ,
    Permissions.SITE_VISITS_ASSIGN_AGENT,
    Permissions.TASKS_CREATE,
    Permissions.TASKS_READ,
    Permissions.TASKS_UPDATE,
    Permissions.TASKS_ASSIGN,
    Permissions.LEADS_READ,
    Permissions.CUSTOMERS_READ,
    Permissions.CUSTOMERS_UPDATE,
    Permissions.REPORTS_READ_OWN,
    Permissions.BOOKINGS_READ,
    Permissions.PAYMENTS_READ,
    Permissions.DOCUMENTS_CREATE,
    Permissions.DOCUMENTS_READ,
    Permissions.COMPLAINTS_CREATE,
    Permissions.COMPLAINTS_READ,
    Permissions.COMPLAINTS_UPDATE,
    Permissions.COMPLAINTS_ASSIGN,
    Permissions.COMPLAINTS_RESOLVE,
    Permissions.COMPLAINTS_CLOSE,
    Permissions.EXPENSES_CREATE,
    Permissions.EXPENSES_READ_OWN,
  ],

  [Roles.DIGITAL_LEAD_OPERATOR]: [
    Permissions.LEADS_CREATE,
    Permissions.LEADS_READ,
    Permissions.LEADS_UPDATE,
    Permissions.LEADS_ASSIGN,
    Permissions.LEADS_BULK_UPLOAD,
    Permissions.LEADS_DISTRIBUTION_MONITOR,
    Permissions.CUSTOMERS_CREATE,
    Permissions.CUSTOMERS_READ,
    Permissions.CUSTOMERS_UPDATE,
    Permissions.CUSTOMERS_DELETE,
    Permissions.CUSTOMERS_CONVERT,
    Permissions.SITE_VISITS_CREATE,
    Permissions.SITE_VISITS_VERIFY,
    Permissions.REPORTS_TARGETS_CONFIGURE,
    Permissions.BOOKINGS_CREATE,
    Permissions.BOOKINGS_READ,
    Permissions.BOOKINGS_UPDATE,
    Permissions.BOOKINGS_FORM_SUBMIT,
    Permissions.BOOKINGS_LEGACY_CREATE,
    Permissions.PAYMENTS_CREATE,
    Permissions.PAYMENTS_READ,
    Permissions.DOCUMENTS_CREATE,
    Permissions.DOCUMENTS_READ,
    Permissions.COMPLAINTS_READ,
    Permissions.COMPLAINTS_UPDATE,
    Permissions.EXPENSES_CREATE,
    Permissions.EXPENSES_READ_OWN,
    Permissions.EMPLOYEES_READ,
  ],

  [Roles.TELECALLER]: [
    Permissions.PROJECTS_READ,
    Permissions.LEADS_CREATE,
    Permissions.LEADS_READ,
    Permissions.LEADS_UPDATE,
    Permissions.LEADS_WHATSAPP_PROPOSAL,
    Permissions.CUSTOMERS_READ,
    Permissions.CUSTOMERS_UPDATE,
    Permissions.CUSTOMERS_CONVERT,
    Permissions.SITE_VISITS_CREATE,
    Permissions.SITE_VISITS_READ,
    Permissions.TASKS_READ,
    Permissions.TASKS_UPDATE,
    Permissions.ATTENDANCE_READ_OWN,
    Permissions.ATTENDANCE_SCAN,
    Permissions.ATTENDANCE_LATE_PROPOSAL,
    Permissions.ATTENDANCE_LEAVE_PROPOSAL,
    Permissions.REPORTS_CREATE,
    Permissions.REPORTS_READ_OWN,
    Permissions.PERFORMANCE_READ_OWN,
    Permissions.BOOKINGS_READ,
    Permissions.PAYMENTS_READ,
    Permissions.DOCUMENTS_READ,
      Permissions.EXPENSES_CREATE,
    Permissions.EXPENSES_READ_OWN,
  ],
  
  [Roles.DIGITAL_MARKETING_HEAD]: [
    Permissions.PROPERTIES_DM_POLISH,
    Permissions.PROPERTIES_READ,
    Permissions.LEADS_READ,
    Permissions.REPORTS_TARGETS_CONFIGURE,
    Permissions.PERFORMANCE_READ_TEAM,
    Permissions.EXPENSES_CREATE,
    Permissions.EXPENSES_READ_OWN,
    Permissions.EMPLOYEES_READ,
  ],
  
  [Roles.AGENT]: [
    Permissions.SITE_VISITS_READ,
    Permissions.SITE_VISITS_COMPLETE,
    Permissions.CUSTOMERS_READ,
    Permissions.CUSTOMERS_UPDATE,
    Permissions.CUSTOMERS_CONVERT,
    Permissions.TASKS_READ,
    Permissions.TASKS_UPDATE,
    Permissions.ATTENDANCE_READ_OWN,
    Permissions.ATTENDANCE_SCAN,
    Permissions.REPORTS_CREATE,
    Permissions.REPORTS_READ_OWN,
    Permissions.PERFORMANCE_READ_OWN,
    Permissions.BOOKINGS_READ,
    Permissions.PAYMENTS_READ,
    Permissions.DOCUMENTS_READ,
    Permissions.COMPLAINTS_CREATE,
    Permissions.COMPLAINTS_READ,
    Permissions.COMPLAINTS_UPDATE,
    Permissions.COMPLAINTS_ASSIGN,
    Permissions.COMPLAINTS_RESOLVE,
    Permissions.COMPLAINTS_CLOSE,
    Permissions.EXPENSES_CREATE,
    Permissions.EXPENSES_READ_OWN,
    // Phase-19 audit #4: Agent now sees a "My Active Leads" count on its
    // dashboard, scoped in the query layer to leads assigned to that employee.
    Permissions.LEADS_READ,
  ],

  [Roles.DIGITAL_MARKETING_EXECUTIVE]: [
    Permissions.LEADS_READ,
    Permissions.LEADS_UPDATE,
    // PROPERTIES_READ is required alongside PROPERTIES_DM_POLISH -- GET
    // /properties 403s without it, which blocks this role from ever seeing
    // the properties assigned to them for content polish (found while
    // verifying the new dedicated DM Executive dashboard, Phase-19 #8/#11).
    Permissions.PROPERTIES_READ,
    Permissions.SITE_VISITS_READ,
    Permissions.TASKS_READ,
    Permissions.TASKS_UPDATE,
    Permissions.REPORTS_CREATE,
    Permissions.REPORTS_READ_OWN,
    Permissions.ATTENDANCE_READ_OWN,
    Permissions.ATTENDANCE_SCAN,
    Permissions.PERFORMANCE_READ_OWN,
      Permissions.EXPENSES_CREATE,
    Permissions.EXPENSES_READ_OWN,
    Permissions.PROPERTIES_DM_POLISH,
    Permissions.EMPLOYEES_READ,
  ],
  
  [Roles.SALES_MANAGER]: [
    Permissions.TASKS_CREATE,
    Permissions.LEADS_READ,
    Permissions.LEADS_UPDATE,
    Permissions.LEADS_ASSIGN,
    Permissions.LEADS_DISTRIBUTION_MONITOR,
    Permissions.LEADS_WHATSAPP_PROPOSAL,
    Permissions.CUSTOMERS_READ,
    Permissions.CUSTOMERS_UPDATE,
    Permissions.SITE_VISITS_READ,
    Permissions.SITE_VISITS_ASSIGN_AGENT,
    Permissions.TASKS_READ,
    Permissions.TASKS_UPDATE,
    Permissions.TASKS_ASSIGN,
    Permissions.REPORTS_READ_TEAM,
    Permissions.REPORTS_TARGETS_CONFIGURE,
    Permissions.PERFORMANCE_READ_TEAM,
    Permissions.BOOKINGS_READ,
    Permissions.EXPENSES_CREATE,
    Permissions.EXPENSES_READ_OWN,
  ],

  [Roles.CHANNEL_PARTNER_MANAGER]: [
    Permissions.LEADS_CREATE,
    Permissions.LEADS_READ,
    Permissions.LEADS_UPDATE,
    Permissions.CUSTOMERS_READ,
    Permissions.CUSTOMERS_UPDATE,
    Permissions.SITE_VISITS_CREATE,
    Permissions.SITE_VISITS_READ,
    Permissions.SITE_VISITS_COMPLETE,
    Permissions.PROJECTS_READ,
    Permissions.PROPERTIES_READ,
    Permissions.REPORTS_READ_OWN,
    Permissions.ATTENDANCE_READ_OWN,
    Permissions.ATTENDANCE_SCAN,
    Permissions.PERFORMANCE_READ_OWN,
    Permissions.TASKS_READ,
    Permissions.TASKS_UPDATE,
      Permissions.EXPENSES_CREATE,
    Permissions.EXPENSES_READ_OWN,
    Permissions.CUSTOMERS_CONVERT,
  ]
};

// Employee Code Regex: e.g. RRH-EX-001 (MD), RRH-EX-002 (Admin), RRH-HR-001 (HR), RRH-SL-001 (Sales/Telecaller), DEV-SM-001
export const EMPLOYEE_CODE_REGEX = /^(RRH|DEV|SON)-[A-Z]{2,5}-\d{3,5}$/;


// Login Request Schema
export const LoginSchema = z.object({
  employee_code: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, 'Employee ID is required')
    .regex(
      EMPLOYEE_CODE_REGEX,
      'Invalid Employee ID format. Expected format: RRH-XX-000'
    ),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export type LoginInput = z.infer<typeof LoginSchema>;
