import { z } from 'zod';

// Expense Refund Constants & Schemas
export const ExpenseRefundStatus = {
  PENDING: 'PENDING',
  ACCOUNTANT_APPROVED: 'ACCOUNTANT_APPROVED',
  MD_APPROVED: 'MD_APPROVED',
  REFUNDED: 'REFUNDED',
  REJECTED_BY_ACCOUNTANT: 'REJECTED_BY_ACCOUNTANT',
  REJECTED_BY_MD: 'REJECTED_BY_MD',
} as const;

export type ExpenseRefundStatusType = typeof ExpenseRefundStatus[keyof typeof ExpenseRefundStatus];

export const ExpenseRefundCreateSchema = z.object({
  purpose: z.string().min(3, 'Purpose is required'),
  amount: z.number().positive('Amount must be greater than 0'),
});

export type ExpenseRefundCreateInput = z.infer<typeof ExpenseRefundCreateSchema>;

export const ExpenseRefundAccountantReviewSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().optional(),
});

export type ExpenseRefundAccountantReviewInput = z.infer<typeof ExpenseRefundAccountantReviewSchema>;

export const ExpenseRefundMDReviewSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().optional(),
});

export type ExpenseRefundMDReviewInput = z.infer<typeof ExpenseRefundMDReviewSchema>;

export const ExpenseRefundMarkRefundedSchema = z.object({});

export type ExpenseRefundMarkRefundedInput = z.infer<typeof ExpenseRefundMarkRefundedSchema>;
