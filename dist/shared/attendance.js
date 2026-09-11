"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AttendanceHolidaySchema = exports.AttendanceQRPayloadSchema = exports.LeaveProposalSchema = exports.LateProposalSchema = exports.ChangePasswordSchema = exports.AttendanceStatus = void 0;
const zod_1 = require("zod");
// Attendance Status
exports.AttendanceStatus = {
    PRESENT: 'PRESENT',
    LATE: 'LATE',
    APPROVED_LATE: 'APPROVED_LATE',
    HALF_DAY: 'HALF_DAY',
    APPROVED_HALF_DAY: 'APPROVED_HALF_DAY',
    ABSENT: 'ABSENT',
    LEAVE: 'LEAVE',
};
// Password Change Schema (Forced first login)
exports.ChangePasswordSchema = zod_1.z.object({
    current_password: zod_1.z.string().min(1, 'Current password is required'),
    new_password: zod_1.z
        .string()
        .min(8, 'New password must be at least 8 characters')
        .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
        .regex(/[0-9]/, 'Password must contain at least one number'),
});
// Late Proposal Schema (< 09:30 AM IST)
exports.LateProposalSchema = zod_1.z.object({
    date: zod_1.z.string().min(1, 'Date is required'), // YYYY-MM-DD
    expected_time: zod_1.z.string().min(1, 'Expected arrival time is required'), // HH:mm
    reason: zod_1.z.string().min(5, 'Reason must be at least 5 characters'),
});
// Leave Proposal Schema (>= 1 day advance)
exports.LeaveProposalSchema = zod_1.z.object({
    start_date: zod_1.z.string().min(1, 'Start date is required'),
    end_date: zod_1.z.string().min(1, 'End date is required'),
    reason: zod_1.z.string().min(5, 'Reason must be at least 5 characters'),
});
exports.AttendanceQRPayloadSchema = zod_1.z.object({
    qrPayload: zod_1.z.string().optional(),
    qr_token: zod_1.z.string().optional(),
    payload: zod_1.z.string().optional(),
});
exports.AttendanceHolidaySchema = zod_1.z.object({
    date: zod_1.z.string(),
    name: zod_1.z.string(),
    description: zod_1.z.string().optional(),
});
