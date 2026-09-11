"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskUpdateStatusSchema = exports.TaskCreateSchema = exports.DailyTargetSetSchema = exports.DailyReportSchema = exports.TaskStatus = exports.TaskPriority = void 0;
const zod_1 = require("zod");
// Task Constants
exports.TaskPriority = {
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
    URGENT: 'URGENT',
};
exports.TaskStatus = {
    PENDING: 'PENDING',
    IN_PROGRESS: 'IN_PROGRESS',
    COMPLETED: 'COMPLETED',
    OVERDUE: 'OVERDUE',
};
// Daily Report Schema (with 15-character minimum below_target_reason check)
exports.DailyReportSchema = zod_1.z.object({
    role_name: zod_1.z.string().min(1),
    metrics: zod_1.z.record(zod_1.z.any()), // Role-specific key-value pairs (e.g. callsMade, siteVisits)
    summary_notes: zod_1.z.string().min(5, 'Summary notes must be at least 5 characters'),
    below_target_reason: zod_1.z
        .string()
        .min(15, 'Reason for missing target must be at least 15 characters long')
        .optional()
        .or(zod_1.z.literal(''))
        .or(zod_1.z.null()),
});
// Daily Target Set Schema (for MD & Marketing Director Target Configurator)
exports.DailyTargetSetSchema = zod_1.z.object({
    role_name: zod_1.z.string().min(1),
    employee_id: zod_1.z.number().int().optional().nullable(),
    target_type: zod_1.z.enum(['COUNT', 'CHECKLIST']),
    targets_json: zod_1.z.record(zod_1.z.any()),
    form_schema_json: zod_1.z.array(zod_1.z.any()).optional(),
    start_date: zod_1.z.string().optional(),
    end_date: zod_1.z.string().optional().nullable(),
});
// Task Create Schema
exports.TaskCreateSchema = zod_1.z.object({
    title: zod_1.z.string().min(3, 'Title must be at least 3 characters'),
    description: zod_1.z.string().optional(),
    assignee_id: zod_1.z.number().int().positive(),
    priority: zod_1.z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
    deadline: zod_1.z.string().min(1, 'Deadline date/time is required'),
    lead_id: zod_1.z.number().int().positive().optional().nullable(),
    opportunity_id: zod_1.z.number().int().positive().optional().nullable(),
    booking_id: zod_1.z.number().int().positive().optional().nullable(),
});
// Task Status Update Schema
exports.TaskUpdateStatusSchema = zod_1.z.object({
    status: zod_1.z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE']),
});
