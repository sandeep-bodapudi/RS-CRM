import { z } from 'zod';

// Attendance Status
export const AttendanceStatus = {
  PRESENT: 'PRESENT',
  LATE: 'LATE',
  APPROVED_LATE: 'APPROVED_LATE',
  HALF_DAY: 'HALF_DAY',
  APPROVED_HALF_DAY: 'APPROVED_HALF_DAY',
  ABSENT: 'ABSENT',
  LEAVE: 'LEAVE',
} as const;

export type AttendanceStatusType = (typeof AttendanceStatus)[keyof typeof AttendanceStatus];

// Password Change Schema (Forced first login)
export const ChangePasswordSchema = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password: z
    .string()
    .min(8, 'New password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
});

export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

// Late Proposal Schema (< 09:30 AM IST)
export const LateProposalSchema = z.object({
  date: z.string().min(1, 'Date is required'), // YYYY-MM-DD
  expected_time: z.string().min(1, 'Expected arrival time is required'), // HH:mm
  reason: z.string().min(5, 'Reason must be at least 5 characters'),
});

export type LateProposalInput = z.infer<typeof LateProposalSchema>;

// Leave Proposal Schema (>= 1 day advance)
export const LeaveProposalSchema = z.object({
  start_date: z.string().min(1, 'Start date is required'),
  end_date: z.string().min(1, 'End date is required'),
  reason: z.string().min(5, 'Reason must be at least 5 characters'),
});

export type LeaveProposalInput = z.infer<typeof LeaveProposalSchema>;

export const AttendanceQRPayloadSchema = z.object({
  qrPayload: z.string().optional(),
  qr_token: z.string().optional(),
  payload: z.string().optional(),
});

export const AttendanceHolidaySchema = z.object({
  date: z.string(),
  name: z.string(),
  description: z.string().optional(),
});
