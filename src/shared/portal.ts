import { z } from 'zod';

// ─────────────────────────────────────────────────────────────
// CUSTOMER PORTAL INTEGRATION — Phase 11 Packet 3B
// ─────────────────────────────────────────────────────────────

export const PortalCallbackStatus = {
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type PortalCallbackStatusValue =
  (typeof PortalCallbackStatus)[keyof typeof PortalCallbackStatus];

export const PortalCallbackSchema = z.object({
  idempotency_key: z.string().min(1),
  event_type: z.literal('BOOKING_PORTAL_HANDOFF'),
  status: z.enum(['completed', 'failed']),
  portal_customer_id: z.string().optional().nullable(),
  portal_booking_id: z.string().optional().nullable(),
  company_id: z.number().int().positive(),
  crms_booking_id: z.number().int().positive(),
  message: z.string().optional().nullable(),
});

export type PortalCallbackInput = z.infer<typeof PortalCallbackSchema>;

// ─────────────────────────────────────────────────────────────
// CUSTOMER KYC — Phase 11 Packet 3C (KYC Data Bridge)
// ─────────────────────────────────────────────────────────────

export const KycStatus = {
  PENDING: 'PENDING',
  PARTIAL: 'PARTIAL',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
} as const;

export type KycStatusValue = (typeof KycStatus)[keyof typeof KycStatus];

export const KYC_STATUSES = Object.values(KycStatus) as string[];

/**
 * CRM-internal KYC write/update path. Encrypted at rest before persistence.
 * Raw PAN/Aadhaar NEVER cross the CRM ↔ Portal boundary (Packet 3C §3.4).
 */
export const CustomerKycWriteSchema = z.object({
  pan_number: z
    .string()
    .regex(/^[A-Z0-9]{10}$/, 'PAN must be 10 alphanumeric characters')
    .optional(),
  aadhaar_number: z
    .string()
    .regex(/^\d{12}$/, 'Aadhaar must be 12 digits')
    .optional(),
});

export type CustomerKycWriteInput = z.infer<typeof CustomerKycWriteSchema>;

/**
 * Outbound CRM → Portal KYC status push payload (Packet 3C §3).
 * Contains ONLY status + masked PAN — never raw PAN/Aadhaar/bank data.
 */
export const KycStatusChangedSchema = z.object({
  event_type: z.literal('CUSTOMER_KYC_STATUS_CHANGED'),
  company_id: z.number().int().positive(),
  crms_customer_id: z.number().int().positive(),
  crms_booking_id: z.number().int().positive().nullable(),
  kyc_status: z.enum(['PENDING', 'PARTIAL', 'VERIFIED', 'REJECTED']),
  masked_pan: z.string().nullable(),
  verified_at: z.string().datetime().nullable(),
});

export type KycStatusChangedInput = z.infer<typeof KycStatusChangedSchema>;

// ─────────────────────────────────────────────────────────────
// PORTAL → CRM KYC SUBMISSION CALLBACK — Phase 11 Packet 3D
// ─────────────────────────────────────────────────────────────

/**
 * Inbound Portal → CRM KYC submission callback (Packet 3D).
 * The Portal may report ONLY "submitted" — verification authority stays
 * exclusively in CRM. Raw PAN/Aadhaar/bank/document data is NEVER part of
 * this contract (Packet 3C §3.4 / §4.2).
 */
export const KycCallbackSchema = z
  .object({
    idempotency_key: z.string().min(1),
    event_type: z.literal('CUSTOMER_KYC_STATUS_CHANGED'),
    status: z.literal('submitted'),
    portal_customer_id: z.string().optional().nullable(),
    company_id: z.number().int().positive(),
    crms_customer_id: z.number().int().positive(),
    crms_booking_id: z.number().int().positive().optional().nullable(),
  })
  .strict();

export type KycCallbackInput = z.infer<typeof KycCallbackSchema>;

// ─────────────────────────────────────────────────────────────
// PAYMENT SYNCHRONIZATION — Phase 11 Packet 3F
// ─────────────────────────────────────────────────────────────

export const PAYMENT_EVENT_TYPE = 'PAYMENT_STATUS_CHANGED';

/**
 * Outbound CRM → Portal payment status push payload (Packet 3F §4).
 * Contains ONLY amounts + identifiers — NEVER card/UPI/bank credentials,
 * CVV, or any raw financial secret (3A–3E sensitive-data policy).
 */
export const PaymentStatusChangedSchema = z.object({
  event_type: z.literal(PAYMENT_EVENT_TYPE),
  company_id: z.number().int().positive(),
  crms_customer_id: z.number().int().positive(),
  crms_booking_id: z.number().int().positive(),
  payment_id: z.number().int().positive(),
  payment_code: z.string().min(1),
  installment_id: z.number().int().positive().nullable(),
  amount: z.number().positive(),
  status: z.enum(['SUCCESS', 'REFUNDED']),
  payment_date: z.string().datetime(),
  reference_number: z.string().nullable().optional(),
});

export type PaymentStatusChangedInput = z.infer<typeof PaymentStatusChangedSchema>;

/**
 * Inbound Portal → CRM payment callback (Packet 3F §5).
 * The Portal may report ONLY "completed" / "failed" — it may never claim
 * SUCCESS/REFUNDED (CRM owns verification, enforced at the schema boundary).
 * References the outbound PAYMENT_STATUS_CHANGED IntegrationEvent via its
 * idempotency key; it NEVER creates a new IntegrationEvent.
 */
export const PaymentCallbackSchema = z
  .object({
    idempotency_key: z.string().min(1),
    event_type: z.literal(PAYMENT_EVENT_TYPE),
    status: z.enum(['completed', 'failed']),
    company_id: z.number().int().positive(),
    crms_customer_id: z.number().int().positive(),
    crms_booking_id: z.number().int().positive(),
    payment_id: z.number().int().positive(),
    portal_payment_id: z.string().optional().nullable(),
    message: z.string().optional().nullable(),
  })
  .strict();

export type PaymentCallbackInput = z.infer<typeof PaymentCallbackSchema>;

// ─────────────────────────────────────────────────────────────
// INSTALLMENT / FINANCIAL STATUS SYNC — Phase 11 Packet 3H
// ─────────────────────────────────────────────────────────────

export const INSTALLMENT_EVENT_TYPE = 'INSTALLMENT_STATUS_CHANGED';

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
export const InstallmentStatusChangedSchema = z.object({
  event_type: z.literal(INSTALLMENT_EVENT_TYPE),
  company_id: z.number().int().positive(),
  crms_customer_id: z.number().int().positive(),
  crms_booking_id: z.number().int().positive(),
  installment_id: z.number().int().positive(),
  installment_number: z.number().int().positive(),
  status: z.enum(['PENDING', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']),
  expected_amount: z.number().positive(),
  received_amount: z.number().nonnegative(),
  remaining_amount: z.number().nonnegative(),
  changed_at: z.string().datetime(),
});

export type InstallmentStatusChangedInput = z.infer<typeof InstallmentStatusChangedSchema>;

// ─────────────────────────────────────────────────────────────
// CUSTOMER NOTIFICATIONS — Phase 11 Packet 3E
// ─────────────────────────────────────────────────────────────

export const CustomerNotificationType = {
  PORTAL_ACTIVATED: 'PORTAL_ACTIVATED',
  KYC_STATUS_UPDATED: 'KYC_STATUS_UPDATED',
  PAYMENT_STATUS_UPDATED: 'PAYMENT_STATUS_UPDATED', // Phase 11 Packet 3F
} as const;

export type CustomerNotificationTypeValue =
  (typeof CustomerNotificationType)[keyof typeof CustomerNotificationType];

/**
 * Read-only query for the Portal-facing customer-notifications API (Packet 3E).
 * The Portal may only READ; it can never create/update/delete notifications.
 * company_id + crms_customer_id are tenant/customer-scoped (both required).
 */
export const CustomerNotificationReadSchema = z
  .object({
    company_id: z.number().int().positive(),
    crms_customer_id: z.number().int().positive(),
    page: z.number().int().positive().default(1),
    limit: z.number().int().positive().max(100).default(20),
  })
  .strict();

export type CustomerNotificationReadInput = z.infer<typeof CustomerNotificationReadSchema>;

/**
 * Single customer-notification item returned by the read API (Packet 3E).
 * Carries ONLY low-sensitivity fields — never raw PAN/Aadhaar/bank/salary.
 */
export const CustomerNotificationResponseSchema = z
  .object({
    id: z.number().int().positive(),
    type: z.string().min(1),
    title: z.string().min(1),
    message: z.string().min(1),
    is_read: z.boolean(),
    booking_id: z.number().int().positive().nullable(),
    created_at: z.string().datetime(),
  })
  .strict();

export type CustomerNotificationResponse = z.infer<typeof CustomerNotificationResponseSchema>;

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
export const IntegrationMetricsQuerySchema = z
  .object({
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD (IST)')
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD (IST)')
      .optional(),
    includeTimeseries: z.enum(['true', 'false']).optional(),
  })
  .strict();

export type IntegrationMetricsQueryInput = z.infer<typeof IntegrationMetricsQuerySchema>;

/**
 * Response shape for the metrics endpoint. Aggregates ONLY — no raw
 * IntegrationEvent payloads, PAN/Aadhaar, bank data, or other sensitive
 * information ever crosses this contract (3A–3G sensitive-data policy).
 */
export const IntegrationMetricsResponseSchema = z
  .object({
    generated_at: z.string().datetime(),
    company_id: z.number().int().positive(),
    range: z.object({
      from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable(),
      to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable(),
    }),
    handoffs: z.object({
      total: z.number().int().nonnegative(),
      byStatus: z.record(z.number().int().nonnegative()),
      activationRate: z.number().min(0).max(100).nullable(),
    }),
    outbox: z.object({
      total: z.number().int().nonnegative(),
      byEventType: z.record(z.number().int().nonnegative()),
      byStatus: z.record(z.number().int().nonnegative()),
      retried: z.number().int().nonnegative(),
      terminalFailures: z.number().int().nonnegative(),
    }),
    payments: z.object({
      total: z.number().int().nonnegative(),
      bySyncStatus: z.record(z.number().int().nonnegative()),
      bySource: z.record(z.number().int().nonnegative()),
    }),
    kyc: z.object({
      total: z.number().int().nonnegative(),
      byStatus: z.record(z.number().int().nonnegative()),
      submissions: z.number().int().nonnegative(),
    }),
    notifications: z.object({
      total: z.number().int().nonnegative(),
      byType: z.record(z.number().int().nonnegative()),
    }),
    timeseries: z
      .object({
        days: z.array(z.record(z.any())),
      })
      .optional(),
  })
  .strict();

export type IntegrationMetricsResponse = z.infer<typeof IntegrationMetricsResponseSchema>;
