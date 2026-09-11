import { z } from 'zod';

// Task Constants
export const TaskPriority = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
} as const;

export type TaskPriorityType = (typeof TaskPriority)[keyof typeof TaskPriority];

export const TaskStatus = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  OVERDUE: 'OVERDUE',
} as const;

export type TaskStatusType = (typeof TaskStatus)[keyof typeof TaskStatus];

// Daily Report Schema (with 15-character minimum below_target_reason check)
export const DailyReportSchema = z.object({
  role_name: z.string().min(1),
  metrics: z.record(z.any()), // Role-specific key-value pairs (e.g. callsMade, siteVisits)
  summary_notes: z.string().min(5, 'Summary notes must be at least 5 characters'),
  below_target_reason: z
    .string()
    .min(15, 'Reason for missing target must be at least 15 characters long')
    .optional()
    .or(z.literal(''))
    .or(z.null()),
});

export type DailyReportInput = z.infer<typeof DailyReportSchema>;

// Daily Target Set Schema (for MD & Marketing Director Target Configurator)
export const DailyTargetSetSchema = z.object({
  role_name: z.string().min(1),
  employee_id: z.number().int().optional().nullable(),
  target_type: z.enum(['COUNT', 'CHECKLIST']),
  targets_json: z.record(z.any()),
  form_schema_json: z.array(z.any()).optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional().nullable(),
});

export type DailyTargetSetInput = z.infer<typeof DailyTargetSetSchema>;

// Task Create Schema
export const TaskCreateSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters'),
  description: z.string().optional(),
  assignee_id: z.number().int().positive(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  deadline: z.string().min(1, 'Deadline date/time is required'),
  lead_id: z.number().int().positive().optional().nullable(),
  opportunity_id: z.number().int().positive().optional().nullable(),
  booking_id: z.number().int().positive().optional().nullable(),
});

export type TaskCreateInput = z.infer<typeof TaskCreateSchema>;

// Task Status Update Schema
export const TaskUpdateStatusSchema = z.object({
  status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE']),
});

export type TaskUpdateStatusInput = z.infer<typeof TaskUpdateStatusSchema>;
