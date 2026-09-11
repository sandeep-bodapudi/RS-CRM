"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntegrationMetricsResponseSchema = exports.IntegrationMetricsQuerySchema = exports.CustomerNotificationResponseSchema = exports.CustomerNotificationReadSchema = exports.CustomerNotificationType = exports.InstallmentStatusChangedSchema = exports.INSTALLMENT_EVENT_TYPE = exports.PaymentCallbackSchema = exports.PaymentStatusChangedSchema = exports.PAYMENT_EVENT_TYPE = exports.KycCallbackSchema = exports.KycStatusChangedSchema = exports.CustomerKycWriteSchema = exports.KYC_STATUSES = exports.KycStatus = exports.PortalCallbackSchema = exports.PortalCallbackStatus = void 0;
const zod_1 = require("zod");
// ─────────────────────────────────────────────────────────────
// CUSTOMER PORTAL INTEGRATION — Phase 11 Packet 3B
// ─────────────────────────────────────────────────────────────
exports.PortalCallbackStatus = {
    COMPLETED: 'completed',
    FAILED: 'failed',
};
exports.PortalCallbackSchema = zod_1.z.object({
    idempotency_key: zod_1.z.string().min(1),
    event_type: zod_1.z.literal('BOOKING_PORTAL_HANDOFF'),
    status: zod_1.z.enum(['completed', 'failed']),
    portal_customer_id: zod_1.z.string().optional().nullable(),
    portal_booking_id: zod_1.z.string().optional().nullable(),
    company_id: zod_1.z.number().int().positive(),
    crms_booking_id: zod_1.z.number().int().positive(),
    message: zod_1.z.string().optional().nullable(),
});
// ─────────────────────────────────────────────────────────────
// CUSTOMER KYC — Phase 11 Packet 3C (KYC Data Bridge)
// ─────────────────────────────────────────────────────────────
exports.KycStatus = {
    PENDING: 'PENDING',
    PARTIAL: 'PARTIAL',
    VERIFIED: 'VERIFIED',
    REJECTED: 'REJECTED',
};
exports.KYC_STATUSES = Object.values(exports.KycStatus);
/**
 * CRM-internal KYC write/update path. Encrypted at rest before persistence.
 * Raw PAN/Aadhaar NEVER cross the CRM ↔ Portal boundary (Packet 3C §3.4).
 */
exports.CustomerKycWriteSchema = zod_1.z.object({
    pan_number: zod_1.z.string().regex(/^[A-Z0-9]{10}$/, 'PAN must be 10 alphanumeric characters').optional(),
    aadhaar_number: zod_1.z.string().regex(/^\d{12}$/, 'Aadhaar must be 12 digits').optional(),
});
/**
 * Outbound CRM → Portal KYC status push payload (Packet 3C §3).
 * Contains ONLY status + masked PAN — never raw PAN/Aadhaar/bank data.
 */
exports.KycStatusChangedSchema = zod_1.z.object({
    event_type: zod_1.z.literal('CUSTOMER_KYC_STATUS_CHANGED'),
    company_id: zod_1.z.number().int().positive(),
    crms_customer_id: zod_1.z.number().int().positive(),
    crms_booking_id: zod_1.z.number().int().positive().nullable(),
    kyc_status: zod_1.z.enum(['PENDING', 'PARTIAL', 'VERIFIED', 'REJECTED']),
    masked_pan: zod_1.z.string().nullable(),
    verified_at: zod_1.z.string().datetime().nullable(),
});
// ─────────────────────────────────────────────────────────────
// PORTAL → CRM KYC SUBMISSION CALLBACK — Phase 11 Packet 3D
// ─────────────────────────────────────────────────────────────
/**
 * Inbound Portal → CRM KYC submission callback (Packet 3D).
 * The Portal may report ONLY "submitted" — verification authority stays
 * exclusively in CRM. Raw PAN/Aadhaar/bank/document data is NEVER part of
 * this contract (Packet 3C §3.4 / §4.2).
 */
exports.KycCallbackSchema = zod_1.z.object({
    idempotency_key: zod_1.z.string().min(1),
    event_type: zod_1.z.literal('CUSTOMER_KYC_STATUS_CHANGED'),
    status: zod_1.z.literal('submitted'),
    portal_customer_id: zod_1.z.string().optional().nullable(),
    company_id: zod_1.z.number().int().positive(),
    crms_customer_id: zod_1.z.number().int().positive(),
    crms_booking_id: zod_1.z.number().int().positive().optional().nullable(),
}).strict();
// ─────────────────────────────────────────────────────────────
// PAYMENT SYNCHRONIZATION — Phase 11 Packet 3F
// ─────────────────────────────────────────────────────────────
exports.PAYMENT_EVENT_TYPE = 'PAYMENT_STATUS_CHANGED';
/**
 * Outbound CRM → Portal payment status push payload (Packet 3F §4).
 * Contains ONLY amounts + identifiers — NEVER card/UPI/bank credentials,
 * CVV, or any raw financial secret (3A–3E sensitive-data policy).
 */
exports.PaymentStatusChangedSchema = zod_1.z.object({
    event_type: zod_1.z.literal(exports.PAYMENT_EVENT_TYPE),
    company_id: zod_1.z.number().int().positive(),
    crms_customer_id: zod_1.z.number().int().positive(),
    crms_booking_id: zod_1.z.number().int().positive(),
    payment_id: zod_1.z.number().int().positive(),
    payment_code: zod_1.z.string().min(1),
    installment_id: zod_1.z.number().int().positive().nullable(),
    amount: zod_1.z.number().positive(),
    status: zod_1.z.enum(['SUCCESS', 'REFUNDED']),
    payment_date: zod_1.z.string().datetime(),
    reference_number: zod_1.z.string().nullable().optional(),
});
/**
 * Inbound Portal → CRM payment callback (Packet 3F §5).
 * The Portal may report ONLY "completed" / "failed" — it may never claim
 * SUCCESS/REFUNDED (CRM owns verification, enforced at the schema boundary).
 * References the outbound PAYMENT_STATUS_CHANGED IntegrationEvent via its
 * idempotency key; it NEVER creates a new IntegrationEvent.
 */
exports.PaymentCallbackSchema = zod_1.z.object({
    idempotency_key: zod_1.z.string().min(1),
    event_type: zod_1.z.literal(exports.PAYMENT_EVENT_TYPE),
    status: zod_1.z.enum(['completed', 'failed']),
    company_id: zod_1.z.number().int().positive(),
    crms_customer_id: zod_1.z.number().int().positive(),
    crms_booking_id: zod_1.z.number().int().positive(),
    payment_id: zod_1.z.number().int().positive(),
    portal_payment_id: zod_1.z.string().optional().nullable(),
    message: zod_1.z.string().optional().nullable(),
}).strict();
// ─────────────────────────────────────────────────────────────
// INSTALLMENT / FINANCIAL STATUS SYNC — Phase 11 Packet 3H
// ─────────────────────────────────────────────────────────────
exports.INSTALLMENT_EVENT_TYPE = 'INSTALLMENT_STATUS_CHANGED';
/**
 * Outbound CRM → Portal installment financial status push (Packet 3H §5).
 *
 * Emitted atomically inside verifyPayment's transaction whenever an
 * installment's PERSISTED status genuinely transitions (PENDING →
 * PARTIALLY_RECEIVED / RECEIVED, PARTIALLY_RECEIVED → RECEIVED). OVERDUE is
 * read-derived in the CRM (lazy, never persisted) and therefore is never
 * emitted here.
 *
 * Contains ONLY identifiers + amounts + status — NEVER PAN/Aadhaar, bank
 * data, salary, credentials, or secrets (3A–3G sensitive-data policy).
 * remaining_amount = expected_amount - received_amount is the Portal's
 * derived outstanding figure. CRM remains the financial source of truth.
 */
exports.InstallmentStatusChangedSchema = zod_1.z.object({
    event_type: zod_1.z.literal(exports.INSTALLMENT_EVENT_TYPE),
    company_id: zod_1.z.number().int().positive(),
    crms_customer_id: zod_1.z.number().int().positive(),
    crms_booking_id: zod_1.z.number().int().positive(),
    installment_id: zod_1.z.number().int().positive(),
    installment_number: zod_1.z.number().int().positive(),
    status: zod_1.z.enum(['PENDING', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']),
    expected_amount: zod_1.z.number().positive(),
    received_amount: zod_1.z.number().nonnegative(),
    remaining_amount: zod_1.z.number().nonnegative(),
    changed_at: zod_1.z.string().datetime(),
});
// ─────────────────────────────────────────────────────────────
// CUSTOMER NOTIFICATIONS — Phase 11 Packet 3E
// ─────────────────────────────────────────────────────────────
exports.CustomerNotificationType = {
    PORTAL_ACTIVATED: 'PORTAL_ACTIVATED',
    KYC_STATUS_UPDATED: 'KYC_STATUS_UPDATED',
    PAYMENT_STATUS_UPDATED: 'PAYMENT_STATUS_UPDATED', // Phase 11 Packet 3F
};
/**
 * Read-only query for the Portal-facing customer-notifications API (Packet 3E).
 * The Portal may only READ; it can never create/update/delete notifications.
 * company_id + crms_customer_id are tenant/customer-scoped (both required).
 */
exports.CustomerNotificationReadSchema = zod_1.z.object({
    company_id: zod_1.z.number().int().positive(),
    crms_customer_id: zod_1.z.number().int().positive(),
    page: zod_1.z.number().int().positive().default(1),
    limit: zod_1.z.number().int().positive().max(100).default(20),
}).strict();
/**
 * Single customer-notification item returned by the read API (Packet 3E).
 * Carries ONLY low-sensitivity fields — never raw PAN/Aadhaar/bank/salary.
 */
exports.CustomerNotificationResponseSchema = zod_1.z.object({
    id: zod_1.z.number().int().positive(),
    type: zod_1.z.string().min(1),
    title: zod_1.z.string().min(1),
    message: zod_1.z.string().min(1),
    is_read: zod_1.z.boolean(),
    booking_id: zod_1.z.number().int().positive().nullable(),
    created_at: zod_1.z.string().datetime(),
}).strict();
// ─────────────────────────────────────────────────────────────
// PORTAL / INTEGRATION METRICS — Phase 11 Packet 3G
// ─────────────────────────────────────────────────────────────
/**
 * Read-only metrics query for GET /api/v1/integration/metrics (Packet 3G).
 *
 * - from/to are IST calendar dates (YYYY-MM-DD). Without them, the metrics
 *   snapshot covers the full company history; with them, only rows created
 *   inside the IST date range are counted.
 * - includeTimeseries=true requires both from and to (time-series over an
 *   unbounded window is not meaningful). It adds daily IST buckets.
 * - Authenticated via a user JWT + ADMIN_SYSTEM_METRICS — NEVER the Portal
 *   service token (the Portal must not read cross-tenant aggregate data).
 */
exports.IntegrationMetricsQuerySchema = zod_1.z.object({
    from: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD (IST)').optional(),
    to: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD (IST)').optional(),
    includeTimeseries: zod_1.z.enum(['true', 'false']).optional(),
}).strict();
/**
 * Response shape for the metrics endpoint. Aggregates ONLY — no raw
 * IntegrationEvent payloads, PAN/Aadhaar, bank data, or other sensitive
 * information ever crosses this contract (3A–3G sensitive-data policy).
 */
exports.IntegrationMetricsResponseSchema = zod_1.z.object({
    generated_at: zod_1.z.string().datetime(),
    company_id: zod_1.z.number().int().positive(),
    range: zod_1.z.object({
        from: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
        to: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    }),
    handoffs: zod_1.z.object({
        total: zod_1.z.number().int().nonnegative(),
        byStatus: zod_1.z.record(zod_1.z.number().int().nonnegative()),
        activationRate: zod_1.z.number().min(0).max(100).nullable(),
    }),
    outbox: zod_1.z.object({
        total: zod_1.z.number().int().nonnegative(),
        byEventType: zod_1.z.record(zod_1.z.number().int().nonnegative()),
        byStatus: zod_1.z.record(zod_1.z.number().int().nonnegative()),
        retried: zod_1.z.number().int().nonnegative(),
        terminalFailures: zod_1.z.number().int().nonnegative(),
    }),
    payments: zod_1.z.object({
        total: zod_1.z.number().int().nonnegative(),
        bySyncStatus: zod_1.z.record(zod_1.z.number().int().nonnegative()),
        bySource: zod_1.z.record(zod_1.z.number().int().nonnegative()),
    }),
    kyc: zod_1.z.object({
        total: zod_1.z.number().int().nonnegative(),
        byStatus: zod_1.z.record(zod_1.z.number().int().nonnegative()),
        submissions: zod_1.z.number().int().nonnegative(),
    }),
    notifications: zod_1.z.object({
        total: zod_1.z.number().int().nonnegative(),
        byType: zod_1.z.record(zod_1.z.number().int().nonnegative()),
    }),
    timeseries: zod_1.z.object({
        days: zod_1.z.array(zod_1.z.record(zod_1.z.any())),
    }).optional(),
}).strict();
