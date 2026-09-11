"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExpenseRefundMarkRefundedSchema = exports.ExpenseRefundMDReviewSchema = exports.ExpenseRefundAccountantReviewSchema = exports.ExpenseRefundCreateSchema = exports.ExpenseRefundStatus = void 0;
const zod_1 = require("zod");
// Expense Refund Constants & Schemas
exports.ExpenseRefundStatus = {
    PENDING: 'PENDING',
    ACCOUNTANT_APPROVED: 'ACCOUNTANT_APPROVED',
    MD_APPROVED: 'MD_APPROVED',
    REFUNDED: 'REFUNDED',
    REJECTED_BY_ACCOUNTANT: 'REJECTED_BY_ACCOUNTANT',
    REJECTED_BY_MD: 'REJECTED_BY_MD',
};
exports.ExpenseRefundCreateSchema = zod_1.z.object({
    purpose: zod_1.z.string().min(3, 'Purpose is required'),
    amount: zod_1.z.number().positive('Amount must be greater than 0'),
});
exports.ExpenseRefundAccountantReviewSchema = zod_1.z.object({
    decision: zod_1.z.enum(['APPROVE', 'REJECT']),
    note: zod_1.z.string().optional(),
});
exports.ExpenseRefundMDReviewSchema = zod_1.z.object({
    decision: zod_1.z.enum(['APPROVE', 'REJECT']),
    note: zod_1.z.string().optional(),
});
exports.ExpenseRefundMarkRefundedSchema = zod_1.z.object({});
