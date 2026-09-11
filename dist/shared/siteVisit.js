"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SiteVisitUpdateSchema = exports.SiteVisitCancelConfirmSchema = exports.SiteVisitCompleteSchema = exports.SiteVisitOutcomeSchema = exports.SiteVisitReconfirmSchema = exports.SiteVisitRescheduleSchema = exports.SiteVisitEscalateSchema = exports.SiteVisitReassignSchema = exports.SiteVisitAcceptSchema = exports.SiteVisitCreateSchema = exports.SiteVisitOutcome = exports.SiteVisitStatus = void 0;
const zod_1 = require("zod");
// ─────────────────────────────────────────────────────────────
// Site Visit Schemas (§2 Site Visit Sub-Workflow)
// ─────────────────────────────────────────────────────────────
// Full §2 SiteVisitBooking.status state list
exports.SiteVisitStatus = {
    REQUESTED: 'REQUESTED',
    PENDING_ACCEPTANCE: 'PENDING_ACCEPTANCE',
    REASSIGNED: 'REASSIGNED',
    ESCALATED_TO_MARKETING_DIRECTOR: 'ESCALATED_TO_MARKETING_DIRECTOR',
    ACCEPTED: 'ACCEPTED',
    PENDING_CUSTOMER_RECONFIRMATION: 'PENDING_CUSTOMER_RECONFIRMATION',
    RESCHEDULE_REQUESTED: 'RESCHEDULE_REQUESTED',
    PENDING_PM_RECONFIRMATION: 'PENDING_PM_RECONFIRMATION',
    CONFIRMED: 'CONFIRMED',
    ACTIVE: 'ACTIVE',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
};
exports.SiteVisitOutcome = {
    INTERESTED: 'INTERESTED',
    NOT_INTERESTED: 'NOT_INTERESTED',
};
exports.SiteVisitCreateSchema = zod_1.z.object({
    lead_id: zod_1.z.number().int().positive(),
    // §2: all properties in a single booking must belong to the same project.
    property_ids: zod_1.z.array(zod_1.z.number().int().positive()).min(1).optional(),
    project_id: zod_1.z.number().int().positive().optional(),
    scheduled_date: zod_1.z.string().datetime(),
    opportunity_id: zod_1.z.number().int().positive().optional(),
    pick_up_requested: zod_1.z.boolean().optional().default(false),
    pick_up_address: zod_1.z.string().optional(),
});
// Accept (PM/Agent accepts the routed visit)
exports.SiteVisitAcceptSchema = zod_1.z.object({
    notes: zod_1.z.string().optional(),
});
// Reassign (open chain during initial acceptance) — reason required
exports.SiteVisitReassignSchema = zod_1.z.object({
    to_employee_id: zod_1.z.number().int().positive(),
    reason: zod_1.z.string().min(3, 'Reassignment reason is required'),
});
// Escalate to Marketing Director (no PM/Agent left to try)
exports.SiteVisitEscalateSchema = zod_1.z.object({
    reason: zod_1.z.string().min(3, 'Escalation reason is required'),
});
// Reschedule (customer requested a date/property change) or release
exports.SiteVisitRescheduleSchema = zod_1.z.object({
    scheduled_date: zod_1.z.string().datetime().optional(),
    property_ids: zod_1.z.array(zod_1.z.number().int().positive()).min(1).optional(),
});
// Confirm PM reconfirmation after a reschedule (or release back to open chain)
exports.SiteVisitReconfirmSchema = zod_1.z.object({
    release: zod_1.z.boolean().optional().default(false),
});
// Complete — one outcome row per linked property (outcome_reason required if NOT_INTERESTED)
exports.SiteVisitOutcomeSchema = zod_1.z.object({
    property_id: zod_1.z.number().int().positive(),
    outcome: zod_1.z.enum(['INTERESTED', 'NOT_INTERESTED']),
    outcome_reason: zod_1.z.string().optional(),
});
exports.SiteVisitCompleteSchema = zod_1.z.object({
    // No .min(1): a visit with no property attached (a valid, real booking
    // state — see SiteVisitCreateSchema's optional property_id) has nothing to
    // record an outcome for, and requiring at least one made every such visit's
    // completion permanently reject with "outcomes: Required" from the real UI,
    // which never collected/sent this field at all until it was wired up.
    outcomes: zod_1.z.array(exports.SiteVisitOutcomeSchema).default([]),
    feedback_notes: zod_1.z.string().optional(),
    proof_photo_url: zod_1.z.string().optional(),
});
exports.SiteVisitCancelConfirmSchema = zod_1.z.object({
    reason: zod_1.z.string().min(1, "A cancellation reason is required"),
});
// Generic update (used by older/aux endpoints; status is free-form here but
// routed through the §2 workflow engine in the service layer).
exports.SiteVisitUpdateSchema = zod_1.z.object({
    scheduled_date: zod_1.z.string().datetime().optional(),
    status: zod_1.z.string().optional(),
    notes: zod_1.z.string().optional(),
    confirmed: zod_1.z.boolean().optional(),
    verification_notes: zod_1.z.string().optional(),
    agent_id: zod_1.z.number().int().positive().optional(),
    rating: zod_1.z.string().optional(),
    feedback_notes: zod_1.z.string().optional(),
    proof_photo_url: zod_1.z.string().optional(),
});
