"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.completeVisit = exports.startVisit = exports.confirmVisit = exports.pmReconfirm = exports.rescheduleVisit = exports.reconfirmCustomer = exports.escalateVisit = exports.reassignVisit = exports.acceptVisit = void 0;
const prisma_1 = require("../../lib/prisma");
const shared_1 = require("../../shared");
const authorization_1 = require("../../authz/authorization");
const workflowEngine_1 = require("../../workflows/workflowEngine");
const types_1 = require("../../workflows/types");
const siteVisit_policy_1 = require("../../policies/siteVisit.policy");
const shared_2 = require("./shared");
const feedback_service_1 = require("../feedback.service");
const p = prisma_1.prisma;
/** accept: PM/Agent accepts the routed visit. */
async function acceptVisit(user, visitId, notes) {
    const visit = await p.siteVisitBooking.findFirst({
        where: { id: visitId, lead: {} },
        include: { lead: true },
    });
    if (!visit)
        throw { status: 404, message: 'Site visit booking not found' };
    if (!(0, authorization_1.can)(user, shared_1.Permissions.SITE_VISITS_ASSIGN_AGENT, visit)) {
        throw { status: 403, message: 'Forbidden: Missing permission to accept site visits' };
    }
    if (!siteVisit_policy_1.SiteVisitPolicy.canAccept(user, visit)) {
        throw { status: 403, message: 'Forbidden: only the routed PM/Agent may accept this visit' };
    }
    return (0, shared_2.applyTransition)(user, visitId, 'ACCEPT', { project_manager_id: user.employeeId }, 'SITE_VISIT_ACCEPTED', `Site visit ${visit.booking_code} accepted by ${user.employeeId}.${notes ? ` Notes: ${notes}` : ''}`);
}
exports.acceptVisit = acceptVisit;
/** reassign: open chain during initial acceptance — logged to SiteVisitReassignment, resets to PENDING_ACCEPTANCE. */
async function reassignVisit(user, visitId, toEmployeeId, reason) {
    const visit = await p.siteVisitBooking.findFirst({
        where: { id: visitId, lead: {} },
        include: { lead: true },
    });
    if (!visit)
        throw { status: 404, message: 'Site visit booking not found' };
    const targetWithRoles = await p.employee.findFirst({
        where: { id: toEmployeeId, },
        include: { roles: { include: { role: true } } },
    });
    if (!targetWithRoles)
        throw { status: 404, message: 'Target employee not found' };
    const target = {
        ...targetWithRoles,
        roles: (targetWithRoles.roles || []).map((er) => er.role?.name).filter(Boolean),
    };
    if (!siteVisit_policy_1.SiteVisitPolicy.canReassignTarget(user, target)) {
        throw { status: 403, message: 'Forbidden: only PROJECT_MANAGER or AGENT may be reassignment targets' };
    }
    // Ping-pong prevention: Cannot route to someone who has already routed it away.
    const previousReassignment = await p.siteVisitReassignment.findFirst({
        where: {
            visit_id: visitId,
            from_employee_id: toEmployeeId,
        },
    });
    if (previousReassignment) {
        throw { status: 409, message: 'Cannot route to this employee. They have already declined or routed this visit.' };
    }
    const transition = workflowEngine_1.WorkflowEngine.canTransition({
        domain: types_1.WorkflowDomain.SITE_VISIT, currentState: visit.status, action: 'REASSIGN', actor: user, entity: visit,
    });
    if (!transition.allowed) {
        throw { status: 409, message: transition.reason || 'Invalid state transition' };
    }
    return await p.$transaction(async (tx) => {
        // Log the reassignment hop (reason visibility restricted per §2).
        await tx.siteVisitReassignment.create({
            data: { visit_id: visitId, from_employee_id: visit.project_manager_id ?? user.employeeId, to_employee_id: toEmployeeId, reason },
        });
        const updated = await tx.siteVisitBooking.update({
            where: { id: visitId },
            data: { status: 'PENDING_ACCEPTANCE', project_manager_id: toEmployeeId },
        });
        await tx.leadActivity.create({
            data: {
                lead: { connect: { id: visit.lead_id } },
                actor: { connect: { id: user.employeeId } },
                activity_type: 'SITE_VISIT_REASSIGNED',
                notes: `Site visit ${visit.booking_code} reassigned to ${target.full_name || target.employee_code}. Reason: ${reason}`,
            },
        });
        await tx.notification.create({
            data: {
                employee_id: toEmployeeId,
                type: 'TARGET_ASSIGNED',
                title: 'Site Visit Reassigned to You',
                message: `Site visit ${visit.booking_code} has been reassigned to you for acceptance.`,
            },
        });
        return updated;
    });
}
exports.reassignVisit = reassignVisit;
/** escalate: no PM/Agent available → Marketing Director for manual resolution. */
async function escalateVisit(user, visitId, reason) {
    const visit = await p.siteVisitBooking.findFirst({
        where: { id: visitId, lead: {} },
        include: { lead: true },
    });
    if (!visit)
        throw { status: 404, message: 'Site visit booking not found' };
    const transition = workflowEngine_1.WorkflowEngine.canTransition({
        domain: types_1.WorkflowDomain.SITE_VISIT, currentState: visit.status, action: 'ESCALATE', actor: user, entity: visit,
    });
    if (!transition.allowed) {
        throw { status: 409, message: transition.reason || 'Invalid state transition' };
    }
    return await p.$transaction(async (tx) => {
        const md = await tx.employee.findFirst({
            where: { roles: { some: { role: { name: shared_1.Roles.MARKETING_DIRECTOR } } }, },
        });
        const updated = await tx.siteVisitBooking.update({
            where: { id: visitId },
            data: { status: 'ESCALATED_TO_MARKETING_DIRECTOR' },
        });
        await tx.leadActivity.create({
            data: {
                lead: { connect: { id: visit.lead_id } },
                actor: { connect: { id: user.employeeId } },
                activity_type: 'SITE_VISIT_ESCALATED',
                notes: `Site visit ${visit.booking_code} escalated to Marketing Director. Reason: ${reason}`,
            },
        });
        if (md) {
            await tx.notification.create({
                data: {
                    employee_id: md.id,
                    type: 'SYSTEM_ALERT',
                    title: 'Site Visit Escalated',
                    message: `Site visit ${visit.booking_code} could not be assigned to a PM/Agent. Reason: ${reason}`,
                },
            });
        }
        return updated;
    });
}
exports.escalateVisit = escalateVisit;
/** Telecaller triggers day-before reconfirmation call. */
async function reconfirmCustomer(user, visitId) {
    const visit = await p.siteVisitBooking.findFirst({
        where: { id: visitId, lead: {} },
        include: { lead: true },
    });
    if (!visit)
        throw { status: 404, message: 'Site visit booking not found' };
    if (!(0, authorization_1.can)(user, shared_1.Permissions.SITE_VISITS_VERIFY, visit)) {
        throw { status: 403, message: 'Forbidden: Missing site_visits.verify permission' };
    }
    return (0, shared_2.applyTransition)(user, visitId, 'RECONFIRM_CUSTOMER', {}, 'SITE_VISIT_REQUESTED', `Day-before reconfirmation call initiated for ${visit.booking_code}.`);
}
exports.reconfirmCustomer = reconfirmCustomer;
/** Customer requests reschedule (new date/property). */
async function rescheduleVisit(user, visitId, data) {
    const visit = await p.siteVisitBooking.findFirst({
        where: { id: visitId, lead: {} },
        include: { lead: true },
    });
    if (!visit)
        throw { status: 404, message: 'Site visit booking not found' };
    if (!(0, authorization_1.can)(user, shared_1.Permissions.SITE_VISITS_VERIFY, visit)) {
        throw { status: 403, message: 'Forbidden: Missing site_visits.verify permission' };
    }
    // Phase D: If superseding a cancellation, notify the PM.
    if (visit.status === 'CANCELLATION_PENDING_PM_CONFIRMATION' && visit.project_manager_id) {
        await p.notification.create({
            data: {
                employee_id: visit.project_manager_id,
                type: 'SYSTEM_ALERT',
                title: 'Cancellation Superseded',
                message: `The cancellation for site visit ${visit.booking_code} was superseded by a reschedule request.`,
            }
        });
    }
    const extra = {};
    if (data.scheduled_date)
        extra.scheduled_date = new Date(data.scheduled_date);
    if (data.property_ids && data.property_ids.length > 0) {
        // Replace property links.
        await p.siteVisitProperty.deleteMany({ where: { visit_id: visitId } });
        await p.siteVisitProperty.createMany({
            data: data.property_ids.map((pid) => ({ visit_id: visitId, property_id: pid })),
        });
        if (data.property_ids[0])
            extra.property_id = data.property_ids[0];
    }
    return (0, shared_2.applyTransition)(user, visitId, 'RESCHEDULE', extra, 'SITE_VISIT_RESCHEDULE_REQUESTED', `Reschedule requested for ${visit.booking_code}.`);
}
exports.rescheduleVisit = rescheduleVisit;
/** PM confirms or releases after a reschedule (PENDING_PM_RECONFIRMATION). */
async function pmReconfirm(user, visitId, release) {
    const visit = await p.siteVisitBooking.findFirst({
        where: { id: visitId, lead: {} },
        include: { lead: true },
    });
    if (!visit)
        throw { status: 404, message: 'Site visit booking not found' };
    if (!siteVisit_policy_1.SiteVisitPolicy.canAccept(user, visit)) {
        throw { status: 403, message: 'Forbidden: only the PM may reconfirm this visit' };
    }
    if (release) {
        // Reset to the authoritative project PM for the (possibly new) property.
        const props = await p.siteVisitProperty.findMany({ where: { visit_id: visitId }, include: { property: true } });
        const projectId = props[0]?.property?.project_id ?? visit.project_id;
        const project = projectId ? await p.project.findFirst({ where: { id: projectId } }) : null;
        const authoritativePm = project?.assigned_pm_id ?? null;
        const transition = workflowEngine_1.WorkflowEngine.canTransition({
            domain: types_1.WorkflowDomain.SITE_VISIT, currentState: visit.status, action: 'PM_RELEASE', actor: user, entity: visit,
        });
        if (!transition.allowed)
            throw { status: 409, message: transition.reason || 'Invalid state transition' };
        return await p.$transaction(async (tx) => {
            const updated = await tx.siteVisitBooking.update({
                where: { id: visitId },
                data: { status: 'PENDING_ACCEPTANCE', project_manager_id: authoritativePm ?? undefined },
            });
            await tx.leadActivity.create({
                data: {
                    lead: { connect: { id: visit.lead_id } }, actor: { connect: { id: user.employeeId } },
                    activity_type: 'SITE_VISIT_RESCHEDULE_REQUESTED',
                    notes: `PM released reschedule for ${visit.booking_code}; reset to project PM for acceptance.`,
                },
            });
            return updated;
        });
    }
    return (0, shared_2.applyTransition)(user, visitId, 'PM_CONFIRM', {}, 'SITE_VISIT_ACCEPTED', `PM confirmed reschedule for ${visit.booking_code}.`);
}
exports.pmReconfirm = pmReconfirm;
/** confirm: PENDING_CUSTOMER_RECONFIRMATION / RESCHEDULE_REQUESTED → CONFIRMED. */
async function confirmVisit(user, visitId) {
    const visit = await p.siteVisitBooking.findFirst({
        where: { id: visitId, lead: {} },
        include: { lead: true },
    });
    if (!visit)
        throw { status: 404, message: 'Site visit booking not found' };
    if (!(0, authorization_1.can)(user, shared_1.Permissions.SITE_VISITS_VERIFY, visit)) {
        throw { status: 403, message: 'Forbidden: Missing site_visits.verify permission' };
    }
    return (0, shared_2.applyTransition)(user, visitId, 'CONFIRM', {}, 'SITE_VISIT_ACCEPTED', `Site visit ${visit.booking_code} confirmed (schedule locked).`);
}
exports.confirmVisit = confirmVisit;
/** start: CONFIRMED → ACTIVE (day-of). */
async function startVisit(user, visitId) {
    const visit = await p.siteVisitBooking.findFirst({
        where: { id: visitId, lead: {} },
        include: { lead: true },
    });
    if (!visit)
        throw { status: 404, message: 'Site visit booking not found' };
    if (!(0, authorization_1.can)(user, shared_1.Permissions.SITE_VISITS_COMPLETE, visit)) {
        throw { status: 403, message: 'Forbidden: Missing site_visits.complete permission' };
    }
    return (0, shared_2.applyTransition)(user, visitId, 'START', {}, 'SITE_VISIT_COMPLETED', `Site visit ${visit.booking_code} is now ACTIVE (in progress).`);
}
exports.startVisit = startVisit;
/** complete: ACTIVE → COMPLETED, capturing per-property outcomes (multi-property §2). */
async function completeVisit(user, visitId, outcomes, feedback_notes, proof_photo_url) {
    const visit = await p.siteVisitBooking.findFirst({
        where: { id: visitId, lead: {} },
        include: { lead: true, site_visit_properties: true },
    });
    if (!visit)
        throw { status: 404, message: 'Site visit booking not found' };
    if (!(0, authorization_1.can)(user, shared_1.Permissions.SITE_VISITS_COMPLETE, visit)) {
        throw { status: 403, message: 'Forbidden: Missing site_visits.complete permission' };
    }
    // Validate outcomes: every linked property must have an outcome, with reason if NOT_INTERESTED.
    const linked = visit.site_visit_properties.map((sp) => sp.property_id);
    const provided = new Set(outcomes.map((o) => o.property_id));
    for (const pid of linked) {
        if (!provided.has(pid)) {
            throw { status: 400, message: `Outcome required for every linked property. Missing property ${pid}.` };
        }
    }
    for (const o of outcomes) {
        if (o.outcome === 'NOT_INTERESTED' && (!o.outcome_reason || o.outcome_reason.trim() === '')) {
            throw { status: 400, message: 'outcome_reason is required when outcome is NOT_INTERESTED.' };
        }
    }
    const transition = workflowEngine_1.WorkflowEngine.canTransition({
        domain: types_1.WorkflowDomain.SITE_VISIT, currentState: visit.status, action: 'COMPLETE', actor: user, entity: visit,
    });
    if (!transition.allowed) {
        throw { status: 409, message: transition.reason || 'Invalid state transition' };
    }
    const anyInterested = outcomes.some((o) => o.outcome === 'INTERESTED');
    // Array.prototype.every() is vacuously true on an empty array — guard
    // against that so a visit with no linked properties (outcomes: []) isn't
    // misreported as "all not interested".
    const allNotInterested = outcomes.length > 0 && outcomes.every((o) => o.outcome === 'NOT_INTERESTED');
    const result = await p.$transaction(async (tx) => {
        // Persist outcomes.
        for (const o of outcomes) {
            await tx.siteVisitProperty.upsert({
                where: { visit_id_property_id: { visit_id: visitId, property_id: o.property_id } },
                update: { outcome: o.outcome, outcome_reason: o.outcome_reason ?? null },
                create: { visit_id: visitId, property_id: o.property_id, outcome: o.outcome, outcome_reason: o.outcome_reason ?? null },
            });
        }
        const updated = await tx.siteVisitBooking.update({
            where: { id: visitId },
            data: { status: 'COMPLETED', feedback_notes, proof_photo_url: proof_photo_url || null, completed_at: new Date() },
        });
        await tx.leadActivity.create({
            data: {
                lead: { connect: { id: visit.lead_id } },
                actor: { connect: { id: user.employeeId } },
                activity_type: 'SITE_VISIT_COMPLETED',
                notes: `Site Visit Completed! ${outcomes.length} property outcome(s) recorded.`,
            },
        });
        // §1: SITE_VISIT_COMPLETED → NEGOTIATION (any INTERESTED) or DROPPED (all NOT_INTERESTED).
        // The Lead status move is driven by the lead workflow; the service that
        // owns the lead transition will enforce it. Here we record the outcome
        // branch so the caller (route) can advance the Lead accordingly.
        updated._outcomeBranch = allNotInterested ? 'DROP' : (anyInterested ? 'NEGOTIATE' : 'NEGOTIATE');
        // § Phase 7 — a completed visit always has someone who actually ran it
        // (agent takes priority over PM when both are set, matching how the
        // notification below picks a name); only request feedback when there
        // is genuinely someone to rate.
        const ratedEmployeeId = visit.assigned_agent_id || visit.project_manager_id;
        if (ratedEmployeeId) {
            updated._feedbackToken = await (0, feedback_service_1.createFeedbackRequest)(tx, visitId, ratedEmployeeId);
        }
        return updated;
    });
    // Outside the transaction (this I/O must never roll back the visit
    // completion itself), but still awaited: dispatchFeedbackRequestNotification
    // catches its own errors internally, so awaiting it costs a little
    // latency without risking the request path — and avoids an unhandled,
    // untracked background promise outliving the request.
    if (result._feedbackToken) {
        await (0, feedback_service_1.dispatchFeedbackRequestNotification)(visitId, result._feedbackToken);
    }
    return result;
}
exports.completeVisit = completeVisit;
