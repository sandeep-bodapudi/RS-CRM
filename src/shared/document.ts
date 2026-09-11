import { z } from 'zod';

// ─────────────────────────────────────────────────────────────
// DOCUMENT MANAGEMENT — Phase 11
// ─────────────────────────────────────────────────────────────

export const DocumentType = {
  KYC_PAN: 'KYC_PAN',
  KYC_AADHAAR: 'KYC_AADHAAR',
  BOOKING_AGREEMENT: 'BOOKING_AGREEMENT',
  PAYMENT_RECEIPT: 'PAYMENT_RECEIPT',
  BOOKING_RECEIPT: 'BOOKING_RECEIPT',
  SALE_DEED: 'SALE_DEED',
  PROPERTY_TITLE: 'PROPERTY_TITLE',
  PROPERTY_PLAN: 'PROPERTY_PLAN',
  PROPOSAL: 'PROPOSAL',
  OTHER: 'OTHER',
} as const;

export type DocumentTypeValue = (typeof DocumentType)[keyof typeof DocumentType];

export const DocumentStatus = {
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
} as const;

export type DocumentStatusValue = (typeof DocumentStatus)[keyof typeof DocumentStatus];

export const DocumentVerificationStatus = {
  PENDING: 'PENDING',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
} as const;

export type DocumentVerificationStatusValue =
  (typeof DocumentVerificationStatus)[keyof typeof DocumentVerificationStatus];

// Document type -> required entity FK mapping
export const DOCUMENT_TYPE_ENTITY_REQUIREMENTS: Record<
  string,
  { required: string[]; optional: string[] }
> = {
  [DocumentType.KYC_PAN]: { required: ['customer_id'], optional: [] },
  [DocumentType.KYC_AADHAAR]: { required: ['customer_id'], optional: [] },
  [DocumentType.BOOKING_AGREEMENT]: { required: ['booking_id'], optional: ['customer_id'] },
  [DocumentType.BOOKING_RECEIPT]: { required: ['booking_id'], optional: ['payment_id'] },
  [DocumentType.PAYMENT_RECEIPT]: { required: ['payment_id'], optional: ['booking_id'] },
  [DocumentType.SALE_DEED]: { required: ['booking_id'], optional: ['property_id', 'customer_id'] },
  [DocumentType.PROPERTY_TITLE]: { required: ['property_id'], optional: ['project_id'] },
  [DocumentType.PROPERTY_PLAN]: { required: ['property_id'], optional: ['project_id'] },
  [DocumentType.PROPOSAL]: { required: ['lead_id'], optional: ['opportunity_id'] },
  [DocumentType.OTHER]: {
    required: [],
    optional: [
      'customer_id',
      'lead_id',
      'opportunity_id',
      'booking_id',
      'property_id',
      'project_id',
      'payment_id',
    ],
  },
};

export const DocumentUploadSchema = z.object({
  document_type: z.enum([
    'KYC_PAN',
    'KYC_AADHAAR',
    'BOOKING_AGREEMENT',
    'PAYMENT_RECEIPT',
    'BOOKING_RECEIPT',
    'SALE_DEED',
    'PROPERTY_TITLE',
    'PROPERTY_PLAN',
    'PROPOSAL',
    'OTHER',
  ]),
  title: z.string().min(1, 'Title is required').max(255),
  customer_id: z.coerce.number().int().positive().optional().nullable(),
  lead_id: z.coerce.number().int().positive().optional().nullable(),
  opportunity_id: z.coerce.number().int().positive().optional().nullable(),
  booking_id: z.coerce.number().int().positive().optional().nullable(),
  property_id: z.coerce.number().int().positive().optional().nullable(),
  project_id: z.coerce.number().int().positive().optional().nullable(),
  payment_id: z.coerce.number().int().positive().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type DocumentUploadInput = z.infer<typeof DocumentUploadSchema>;

export const DocumentVerifySchema = z.object({
  status: z.enum(['VERIFIED', 'REJECTED']),
  notes: z.string().optional().nullable(),
});

export type DocumentVerifyInput = z.infer<typeof DocumentVerifySchema>;

export const DocumentArchiveSchema = z.object({
  reason: z.string().optional().nullable(),
});

export type DocumentArchiveInput = z.infer<typeof DocumentArchiveSchema>;
