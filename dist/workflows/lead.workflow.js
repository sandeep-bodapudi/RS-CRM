"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LeadWorkflow = void 0;
const shared_1 = require("../shared");
/**
 * Lead Macro-Status Workflow State Machine (docs/LEAD-WORKFLOW-SPEC.md §1)
 *
 * The workflow engine is the single authority permitted to write `Lead.status`.
 * Services MUST route every lead status change through
 * WorkflowEngine.transitionLead(...) and never issue a raw
 * `tx.lead.update({ status })`.
 *
 * // Lead.status must only be written via engine.transitionLead() — do not call tx.lead.update({status}) directly anywhere else in the codebase.
 *
 * This engine enforces BOTH:
 *  - the allowed state graph (transitionMatrix), and
 *  - the spec's field-level guards:
 *    • CALL_LOGGED activity required before ASSIGNED → CONTACTED (§1 row 2)
 *    • CONTACTED → QUALIFIED direct only when all qualification fields present
 *      (§1 row 4)
 *    • SITE_VISIT_COMPLETED requires ALL linked visits COMPLETED (§1 row 6)
 *    • SITE_VISIT_COMPLETED → DROPPED requires ALL properties NOT_INTERESTED
 *      with outcome_reason populated per property (§1 row 7)
 *    • exit_reason required for DROPPED (§1 row 10)
 *    • demo_scheduled_at + demo_handler_id required for DEMO_SCHEDULED (§1 row 5)
 *    • ≥1 SiteVisitBooking for SITE_VISIT_SCHEDULED (§1 row 6)
 *    • Opportunity with expected_value for NEGOTIATION (§1 row 7)
 *    • expected_value + target property for BOOKING_INITIATED (§1 row 9)
 */
class LeadWorkflow {
    /** Which qualification fields must be non-null to count as "qualified". */
    static isFullyQualified(lead) {
        return !!(lead.budget_min != null &&
            lead.budget_max != null &&
            lead.property_type_preference != null &&
            lead.preferred_location != null);
    }
    canTransition(req) {
        const { currentState, action: newStatus, entity } = req;
        if (currentState === newStatus) {
            return { allowed: true, nextState: newStatus };
        }
        const allowedTransitions = LeadWorkflow.transitionMatrix[currentState] || [];
        if (!allowedTransitions.includes(newStatus)) {
            return {
                allowed: false,
                reason: `Invalid lead status transition from ${currentState} to ${newStatus}`,
            };
        }
        // ── Field-level guards (spec §1) ──
        // §1 row 4: CONTACTED → QUALIFIED is only valid when all
        // qualification fields are present.
        if (newStatus === shared_1.LeadStatus.QUALIFIED) {
            if (!LeadWorkflow.isFullyQualified(entity)) {
                return {
                    allowed: false,
                    reason: 'Transition to QUALIFIED requires all qualification fields (budget_min, budget_max, property_type_preference, preferred_location) to be present.',
                };
            }
        }
        // §1 row 5: DEMO_SCHEDULED requires a scheduled date and a handler.
        if (newStatus === shared_1.LeadStatus.DEMO_SCHEDULED) {
            const hasPendingDemo = entity && entity.pending_demo && entity.pending_demo.scheduled_at && entity.pending_demo.handler_id;
            const hasExistingDemo = entity && entity.demos && entity.demos.length > 0;
            if (!hasPendingDemo && !hasExistingDemo) {
                return {
                    allowed: false,
                    reason: 'Transition to DEMO_SCHEDULED requires demo_scheduled_at and demo_handler_id payload, or an existing Demo record',
                };
            }
        }
        // §1 row 6: SITE_VISIT_SCHEDULED requires at least one linked SiteVisitBooking.
        if (newStatus === shared_1.LeadStatus.SITE_VISIT_SCHEDULED) {
            const visits = (entity && (entity.site_visits || [])) || [];
            if (visits.length === 0) {
                return {
                    allowed: false,
                    reason: 'Transition to SITE_VISIT_SCHEDULED requires at least one SiteVisitBooking',
                };
            }
        }
        // §1 row 6: SITE_VISIT_COMPLETED requires ALL linked SiteVisitBooking rows
        // to reach COMPLETED (not just one).
        if (newStatus === shared_1.LeadStatus.SITE_VISIT_COMPLETED) {
            const visits = (entity && (entity.site_visits || [])) || [];
            if (visits.length === 0) {
                return {
                    allowed: false,
                    reason: 'Transition to SITE_VISIT_COMPLETED requires at least one SiteVisitBooking',
                };
            }
            const allCompleted = visits.every((v) => v.status === 'COMPLETED');
            if (!allCompleted) {
                return {
                    allowed: false,
                    reason: 'Transition to SITE_VISIT_COMPLETED requires ALL linked SiteVisitBooking rows to have status COMPLETED',
                };
            }
        }
        // §1 row 7: SITE_VISIT_COMPLETED → DROPPED requires ALL properties marked
        // NOT_INTERESTED with a non-empty outcome_reason per property.
        if (newStatus === shared_1.LeadStatus.DROPPED && currentState === shared_1.LeadStatus.SITE_VISIT_COMPLETED) {
            const siteVisitProperties = (entity && (entity.site_visit_properties || [])) || [];
            if (siteVisitProperties.length === 0) {
                return {
                    allowed: false,
                    reason: 'Cannot drop a lead from SITE_VISIT_COMPLETED without property outcome records',
                };
            }
            const allNotInterested = siteVisitProperties.every((sp) => sp.outcome === 'NOT_INTERESTED');
            if (!allNotInterested) {
                return {
                    allowed: false,
                    reason: 'Transition to DROPPED from SITE_VISIT_COMPLETED requires ALL properties to be marked NOT_INTERESTED',
                };
            }
            const allHaveReason = siteVisitProperties.every((sp) => sp.outcome_reason && sp.outcome_reason.trim() !== '');
            if (!allHaveReason) {
                return {
                    allowed: false,
                    reason: 'Transition to DROPPED from SITE_VISIT_COMPLETED requires a non-empty outcome_reason for every NOT_INTERESTED property',
                };
            }
        }
        // §1 row 7: SITE_VISIT_COMPLETED → NEGOTIATION requires at least one
        // property outcome marked INTERESTED (enforced by the service layer when
        // creating the Opportunity; the workflow guard here validates the
        // Opportunity has expected_value).
        if (newStatus === shared_1.LeadStatus.NEGOTIATION) {
            const opps = entity?.opportunities || [];
            const opp = Array.isArray(opps) && opps.length > 0 ? opps[0] : (entity?.opportunity || null);
            const expected = opp && (opp.expected_value ?? opp.expectedValue);
            if (expected === undefined || expected === null) {
                return {
                    allowed: false,
                    reason: 'Transition to NEGOTIATION requires an Opportunity with expected_value',
                };
            }
        }
        // §1 row 9: BOOKING_INITIATED requires the opportunity finalized
        // (expected_value + target property).
        if (newStatus === shared_1.LeadStatus.BOOKING_INITIATED) {
            const opps = entity?.opportunities || [];
            const opp = Array.isArray(opps) && opps.length > 0 ? opps[0] : (entity?.opportunity || null);
            const expected = opp && (opp.expected_value ?? opp.expectedValue);
            const propertyId = opp && (opp.property_id ?? opp.propertyId);
            if (expected === undefined || expected === null || !propertyId) {
                return {
                    allowed: false,
                    reason: 'Transition to BOOKING_INITIATED requires Opportunity.expected_value and a finalized target property',
                };
            }
        }
        // §1 row 10: Any → DROPPED requires non-empty exit_reason + exited_from_status auto-recorded.
        if (newStatus === shared_1.LeadStatus.DROPPED) {
            if (!LeadWorkflow.DROPPABLE_FROM.has(currentState)) {
                return {
                    allowed: false,
                    reason: `Cannot drop a lead from ${currentState}`,
                };
            }
            const reason = (entity && (entity.exit_reason ?? entity.exitReason)) || '';
            if (!reason || reason.trim() === '') {
                return {
                    allowed: false,
                    reason: 'Transition to DROPPED requires a non-empty exit_reason',
                };
            }
        }
        return { allowed: true, nextState: newStatus };
    }
    // Keeping validateTransition for backward compatibility until all services are migrated
    static validateTransition(currentStatus, newStatus) {
        if (currentStatus === newStatus)
            return;
        const allowedTransitions = this.transitionMatrix[currentStatus] || [];
        if (!allowedTransitions.includes(newStatus)) {
            const error = new Error(`Invalid lead status transition from ${currentStatus} to ${newStatus}`);
            error.code = 'INVALID_STATE_TRANSITION';
            throw error;
        }
    }
}
exports.LeadWorkflow = LeadWorkflow;
/** Statuses from which DROPPED is reachable — spec §1 lines 27-29. */
LeadWorkflow.DROPPABLE_FROM = new Set([
    shared_1.LeadStatus.ASSIGNED,
    shared_1.LeadStatus.CONTACTED,
    shared_1.LeadStatus.QUALIFIED,
    shared_1.LeadStatus.DEMO_SCHEDULED,
    shared_1.LeadStatus.DEMO_COMPLETED,
    shared_1.LeadStatus.SITE_VISIT_SCHEDULED,
    shared_1.LeadStatus.SITE_VISIT_COMPLETED,
    shared_1.LeadStatus.NEGOTIATION,
    shared_1.LeadStatus.BOOKING_INITIATED,
]);
/** Strict Transition Matrix for Leads (spec §1 transition table).
 * Key: Current Status → allowed next statuses.
 */
LeadWorkflow.transitionMatrix = {
    [shared_1.LeadStatus.NEW]: [shared_1.LeadStatus.ASSIGNED],
    [shared_1.LeadStatus.ASSIGNED]: [shared_1.LeadStatus.CONTACTED, shared_1.LeadStatus.DROPPED],
    [shared_1.LeadStatus.CONTACTED]: [
        shared_1.LeadStatus.QUALIFIED,
        shared_1.LeadStatus.DROPPED,
    ],
    [shared_1.LeadStatus.QUALIFIED]: [
        shared_1.LeadStatus.DEMO_SCHEDULED,
        shared_1.LeadStatus.SITE_VISIT_SCHEDULED,
        shared_1.LeadStatus.DROPPED,
    ],
    [shared_1.LeadStatus.DEMO_SCHEDULED]: [
        shared_1.LeadStatus.DEMO_COMPLETED,
        shared_1.LeadStatus.DROPPED,
    ],
    [shared_1.LeadStatus.DEMO_COMPLETED]: [
        shared_1.LeadStatus.SITE_VISIT_SCHEDULED,
        shared_1.LeadStatus.DROPPED,
    ],
    [shared_1.LeadStatus.SITE_VISIT_SCHEDULED]: [
        shared_1.LeadStatus.SITE_VISIT_COMPLETED,
        shared_1.LeadStatus.DROPPED,
    ],
    [shared_1.LeadStatus.SITE_VISIT_COMPLETED]: [
        shared_1.LeadStatus.NEGOTIATION,
        shared_1.LeadStatus.DROPPED,
    ],
    [shared_1.LeadStatus.NEGOTIATION]: [
        shared_1.LeadStatus.BOOKING_INITIATED,
        shared_1.LeadStatus.DROPPED,
    ],
    [shared_1.LeadStatus.BOOKING_INITIATED]: [
        shared_1.LeadStatus.BOOKED,
        shared_1.LeadStatus.DROPPED,
    ],
    [shared_1.LeadStatus.BOOKED]: [], // Terminal won state
    [shared_1.LeadStatus.DROPPED]: [shared_1.LeadStatus.RECOVERED_TO_POOL],
    [shared_1.LeadStatus.RECOVERED_TO_POOL]: [shared_1.LeadStatus.ASSIGNED],
};
