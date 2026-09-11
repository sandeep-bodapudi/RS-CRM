"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpportunityUpdateSchema = exports.OpportunityCreateSchema = exports.LeadReassignSchema = exports.LeadStatusUpdateSchema = exports.PublicLeadCreateSchema = exports.LeadCreateSchema = exports.LeadSource = exports.LEAD_EXIT_REASON_LABELS = exports.LEAD_EXIT_REASON_VALUES = exports.LeadExitReason = exports.LeadStatus = void 0;
const zod_1 = require("zod");
// Lead Constants & Schemas
exports.LeadStatus = {
    NEW: 'NEW',
    ASSIGNED: 'ASSIGNED',
    CONTACTED: 'CONTACTED',
    QUALIFIED: 'QUALIFIED',
    DEMO_SCHEDULED: 'DEMO_SCHEDULED',
    DEMO_COMPLETED: 'DEMO_COMPLETED',
    SITE_VISIT_SCHEDULED: 'SITE_VISIT_SCHEDULED',
    SITE_VISIT_COMPLETED: 'SITE_VISIT_COMPLETED',
    NEGOTIATION: 'NEGOTIATION',
    BOOKING_INITIATED: 'BOOKING_INITIATED',
    BOOKED: 'BOOKED',
    DROPPED: 'DROPPED',
    RECOVERED_TO_POOL: 'RECOVERED_TO_POOL',
};
// Mirrors the Prisma `LeadExitReason` enum (schema.prisma) — kept as a
// runtime const + label map so the frontend dropdown and this validation
// schema can never drift silently out of sync with each other.
exports.LeadExitReason = {
    NO_MATCHING_INVENTORY: 'NO_MATCHING_INVENTORY',
    CHOSE_COMPETITOR: 'CHOSE_COMPETITOR',
    BUDGET_MISMATCH: 'BUDGET_MISMATCH',
    NOT_READY: 'NOT_READY',
    DO_NOT_CONTACT: 'DO_NOT_CONTACT',
    UNRESPONSIVE: 'UNRESPONSIVE',
    INVALID_CONTACT: 'INVALID_CONTACT',
    DUPLICATE_LEAD: 'DUPLICATE_LEAD',
    FINANCING_ISSUE: 'FINANCING_ISSUE',
    LOCATION_MISMATCH: 'LOCATION_MISMATCH',
    ALREADY_PURCHASED: 'ALREADY_PURCHASED',
    JUST_ENQUIRING: 'JUST_ENQUIRING',
    SITE_VISIT_NO_SHOW: 'SITE_VISIT_NO_SHOW',
    NEGOTIATION_FAILED: 'NEGOTIATION_FAILED',
    OUT_OF_SERVICE_AREA: 'OUT_OF_SERVICE_AREA',
    OTHER: 'OTHER',
};
exports.LEAD_EXIT_REASON_VALUES = Object.values(exports.LeadExitReason);
exports.LEAD_EXIT_REASON_LABELS = {
    NO_MATCHING_INVENTORY: 'No matching property available',
    CHOSE_COMPETITOR: 'Chose a competitor / another builder',
    BUDGET_MISMATCH: "Budget doesn't match available options",
    NOT_READY: 'Not ready to buy right now',
    DO_NOT_CONTACT: 'Requested not to be contacted',
    UNRESPONSIVE: 'Not responding to calls or messages',
    INVALID_CONTACT: 'Wrong number / invalid contact',
    DUPLICATE_LEAD: 'Duplicate of an existing lead',
    FINANCING_ISSUE: 'Home loan / financing fell through',
    LOCATION_MISMATCH: 'Preferred location not available',
    ALREADY_PURCHASED: 'Already purchased elsewhere',
    JUST_ENQUIRING: 'Casual enquiry, no purchase intent',
    SITE_VISIT_NO_SHOW: 'Missed scheduled site visit(s)',
    NEGOTIATION_FAILED: 'Could not agree on price or terms',
    OUT_OF_SERVICE_AREA: 'Out of station / unable to visit',
    OTHER: 'Other (please specify)',
};
exports.LeadSource = {
    MANUAL_ENTRY: 'MANUAL_ENTRY',
    BULK_UPLOAD: 'BULK_UPLOAD',
    WEBSITE: 'WEBSITE',
    FACEBOOK_ADS: 'FACEBOOK_ADS',
    GOOGLE_ADS: 'GOOGLE_ADS',
    WALK_IN: 'WALK_IN',
    REFERRAL: 'REFERRAL',
    HOUSING_COM: 'HOUSING_COM',
};
exports.LeadCreateSchema = zod_1.z.object({
    customer_name: zod_1.z.string().min(2, 'Customer name is required'),
    ownership_type: zod_1.z.enum(['POOL', 'DIRECT']).default('POOL'),
    introduced_by_id: zod_1.z.number().int().optional().nullable(),
    phone: zod_1.z.string().min(10, 'Valid phone number is required'),
    email: zod_1.z.string().email('Invalid email address').optional().or(zod_1.z.literal('')),
    source: zod_1.z.string().default('MANUAL_ENTRY'),
    property_type_preference: zod_1.z.string().optional(),
    budget_min: zod_1.z.number().optional().nullable(),
    budget_max: zod_1.z.number().optional().nullable(),
    preferred_location: zod_1.z.string().optional(),
    // Full multi-location list (§ Phase 2) — when provided, the first entry
    // becomes the `preferred_location` scalar server-side; `preferred_location`
    // above stays accepted on its own for backward compatibility.
    preferred_locations: zod_1.z.array(zod_1.z.string().trim().min(1)).max(10).optional(),
    notes: zod_1.z.string().optional(),
    campaign: zod_1.z.string().optional().nullable(),
    utm_source: zod_1.z.string().optional().nullable(),
    utm_medium: zod_1.z.string().optional().nullable(),
    utm_campaign: zod_1.z.string().optional().nullable(),
    referral_person_name: zod_1.z.string().optional().nullable(),
    referral_employee_id: zod_1.z.number().optional().nullable(),
    // Channel Partner Manager leads originate from an external agent working
    // for a partner company, not an internal employee -- optional everywhere
    // else, only ever populated on CPM-created leads.
    external_agent_name: zod_1.z.string().optional().nullable(),
    external_agent_phone: zod_1.z.string().optional().nullable(),
    external_agent_associate_id: zod_1.z.string().optional().nullable(),
    external_agent_company: zod_1.z.string().optional().nullable(),
});
// Website public lead intake — mirrors the fields the public API currently accepts.
// Intentionally narrower than the internal LeadCreateSchema (no source/campaign/UTM:
// source is forced to WEBSITE server-side).
exports.PublicLeadCreateSchema = zod_1.z.object({
    customer_name: zod_1.z.string().min(2, 'Customer name is required'),
    phone: zod_1.z.string().min(10, 'Valid phone number is required'),
    email: zod_1.z.string().email('Invalid email address').optional().or(zod_1.z.literal('')),
    property_type_preference: zod_1.z.string().optional(),
    preferred_location: zod_1.z.string().optional(),
    preferred_locations: zod_1.z.array(zod_1.z.string().trim().min(1)).max(10).optional(),
    enquiry_type: zod_1.z.enum(['appraisal', 'call', 'project', 'property', 'consultation', 'other']).optional(),
    preferred_contact_time: zod_1.z.enum(['immediate', 'business_hours', 'after_hours', 'anytime']).optional(),
    property_ids: zod_1.z.array(zod_1.z.number().int().positive()).max(10).optional(),
    project_id: zod_1.z.number().int().positive().optional().nullable(),
    budget_max: zod_1.z.number().positive('Budget must be a positive number').optional().nullable(),
    notes: zod_1.z.string().optional(),
});
exports.LeadStatusUpdateSchema = zod_1.z.object({
    status: zod_1.z.enum([
        'NEW',
        'ASSIGNED',
        'CONTACTED',
        'QUALIFIED',
        'DEMO_SCHEDULED',
        'DEMO_COMPLETED',
        'SITE_VISIT_SCHEDULED',
        'SITE_VISIT_COMPLETED',
        'NEGOTIATION',
        'BOOKING_INITIATED',
        'BOOKED',
        'DROPPED',
        'RECOVERED_TO_POOL',
    ]),
    notes: zod_1.z.string().optional(),
    // §1 guard fields — required for specific transitions (enforced in service)
    // Was a loose z.string() — the drop-reason dropdown (Phase 2) needs this to
    // actually be validated against the real enum, not accept any string.
    exit_reason: zod_1.z.enum(exports.LEAD_EXIT_REASON_VALUES).optional(), // required when status -> DROPPED
    // Required (enforced below) only when exit_reason === 'OTHER'.
    exit_reason_detail: zod_1.z.string().trim().min(1).max(500).optional(),
    demo_scheduled_at: zod_1.z.string().datetime().optional(), // required when status -> DEMO_SCHEDULED
    demo_handler_id: zod_1.z.number().int().positive().optional(), // required when status -> DEMO_SCHEDULED
    qualification: zod_1.z.object({
        budget_min: zod_1.z.number().nonnegative().optional(),
        budget_max: zod_1.z.number().nonnegative().optional(),
        property_type_preference: zod_1.z.string().optional(),
        preferred_location: zod_1.z.string().optional(),
        preferred_locations: zod_1.z.array(zod_1.z.string().trim().min(1)).max(10).optional(),
    }).partial().optional(),
}).superRefine((data, ctx) => {
    if (data.exit_reason === 'OTHER' && !data.exit_reason_detail) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            path: ['exit_reason_detail'],
            message: 'Please specify the reason when "Other" is selected',
        });
    }
    // Demo handler assignment is now a required manual pick (PM/Agent/Sales
    // Manager/CPM, or MD self-assign) — the old automatic territory-fallback
    // chain in status.ts is gone, so this can no longer be silently filled in.
    if (data.status === 'DEMO_SCHEDULED' && !data.demo_handler_id) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            path: ['demo_handler_id'],
            message: 'Please select who will handle this demo',
        });
    }
});
exports.LeadReassignSchema = zod_1.z.object({
    assigned_to_id: zod_1.z.number().int().positive('Assignee ID is required'),
    reason: zod_1.z.string().min(3, 'Reassignment reason is required'),
});
// Opportunity Schemas
exports.OpportunityCreateSchema = zod_1.z.object({
    lead_id: zod_1.z.number().int().positive(),
    owner_id: zod_1.z.number().int().positive().optional(),
    project_id: zod_1.z.number().int().positive().optional(),
    property_id: zod_1.z.number().int().positive().optional(),
    expected_value: zod_1.z.number().nonnegative().optional(),
    probability: zod_1.z.number().min(0).max(100).optional(),
    budget_min: zod_1.z.number().nonnegative().optional(),
    budget_max: zod_1.z.number().nonnegative().optional(),
});
exports.OpportunityUpdateSchema = zod_1.z.object({
    expected_value: zod_1.z.number().nonnegative().optional(),
    probability: zod_1.z.number().min(0).max(100).optional(),
    stage: zod_1.z.string().optional(),
    drop_reason: zod_1.z.string().optional(),
    budget_min: zod_1.z.number().nonnegative().optional(),
    budget_max: zod_1.z.number().nonnegative().optional(),
    property_id: zod_1.z.number().int().positive().optional(),
});
