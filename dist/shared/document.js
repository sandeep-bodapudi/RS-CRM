"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentArchiveSchema = exports.DocumentVerifySchema = exports.DocumentUploadSchema = exports.DOCUMENT_TYPE_ENTITY_REQUIREMENTS = exports.DocumentVerificationStatus = exports.DocumentStatus = exports.DocumentType = void 0;
const zod_1 = require("zod");
// ─────────────────────────────────────────────────────────────
// DOCUMENT MANAGEMENT — Phase 11
// ─────────────────────────────────────────────────────────────
exports.DocumentType = {
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
};
exports.DocumentStatus = {
    ACTIVE: 'ACTIVE',
    ARCHIVED: 'ARCHIVED',
};
exports.DocumentVerificationStatus = {
    PENDING: 'PENDING',
    VERIFIED: 'VERIFIED',
    REJECTED: 'REJECTED',
};
// Document type -> required entity FK mapping
exports.DOCUMENT_TYPE_ENTITY_REQUIREMENTS = {
    [exports.DocumentType.KYC_PAN]: { required: ['customer_id'], optional: [] },
    [exports.DocumentType.KYC_AADHAAR]: { required: ['customer_id'], optional: [] },
    [exports.DocumentType.BOOKING_AGREEMENT]: { required: ['booking_id'], optional: ['customer_id'] },
    [exports.DocumentType.BOOKING_RECEIPT]: { required: ['booking_id'], optional: ['payment_id'] },
    [exports.DocumentType.PAYMENT_RECEIPT]: { required: ['payment_id'], optional: ['booking_id'] },
    [exports.DocumentType.SALE_DEED]: { required: ['booking_id'], optional: ['property_id', 'customer_id'] },
    [exports.DocumentType.PROPERTY_TITLE]: { required: ['property_id'], optional: ['project_id'] },
    [exports.DocumentType.PROPERTY_PLAN]: { required: ['property_id'], optional: ['project_id'] },
    [exports.DocumentType.PROPOSAL]: { required: ['lead_id'], optional: ['opportunity_id'] },
    [exports.DocumentType.OTHER]: {
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
exports.DocumentUploadSchema = zod_1.z.object({
    document_type: zod_1.z.enum([
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
    title: zod_1.z.string().min(1, 'Title is required').max(255),
    customer_id: zod_1.z.coerce.number().int().positive().optional().nullable(),
    lead_id: zod_1.z.coerce.number().int().positive().optional().nullable(),
    opportunity_id: zod_1.z.coerce.number().int().positive().optional().nullable(),
    booking_id: zod_1.z.coerce.number().int().positive().optional().nullable(),
    property_id: zod_1.z.coerce.number().int().positive().optional().nullable(),
    project_id: zod_1.z.coerce.number().int().positive().optional().nullable(),
    payment_id: zod_1.z.coerce.number().int().positive().optional().nullable(),
    notes: zod_1.z.string().optional().nullable(),
});
exports.DocumentVerifySchema = zod_1.z.object({
    status: zod_1.z.enum(['VERIFIED', 'REJECTED']),
    notes: zod_1.z.string().optional().nullable(),
});
exports.DocumentArchiveSchema = zod_1.z.object({
    reason: zod_1.z.string().optional().nullable(),
});
