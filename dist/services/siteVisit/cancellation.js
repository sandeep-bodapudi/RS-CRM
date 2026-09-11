"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.confirmCancellation = exports.rejectCancellation = exports.initiateCancellation = exports.holdVisit = exports.cancelVisit = void 0;
const prisma_1 = require("../../lib/prisma");
const shared_1 = require("../../shared");
const authorization_1 = require("../../authz/authorization");
const siteVisit_policy_1 = require("../../policies/siteVisit.policy");
const shared_2 = require("./shared");
const p = prisma_1.prisma;
/** cancel: any active state → CANCELLED. */
async function cancelVisit(user, visitId, reason) {
    const visit = await p.siteVisitBooking.findFirst({
        where: { id: visitId, lead: {} },
        include: { lead: true },
    });
    if (!visit)
        throw { status: 404, message: 'Site visit booking not found' };
    if (!(0, authorization_1.can)(user, shared_1.Permissions.SITE_VISITS_COMPLETE, visit)) {
        throw { status: 403, message: 'Forbidden: Missing permission to cancel site visits' };
    }
    return (0, shared_2.applyTransition)(user, visitId, 'CANCEL', {}, 'SITE_VISIT_COMPLETED', `Site visit ${visit.booking_code} cancelled.${reason ? ` Reason: ${reason}` : ''}`);
}
exports.cancelVisit = cancelVisit;
// ==========================================
// Phase D: Site Visit Hold/Cancel Flow
// ==========================================
/** HOLD: Reconfirmation fails -> ON_HOLD. */
async function holdVisit(user, visitId) {
    const visit = await p.siteVisitBooking.findFirst({
        where: { id: visitId, lead: {} },
        include: { lead: true },
    });
    if (!visit)
        throw { status: 404, message: 'Site visit booking not found' };
    if (!siteVisit_policy_1.SiteVisitPolicy.canHoldOrInitiateCancel(user, visit)) {
        throw { status: 403, message: 'Forbidden: Only the assigned telecaller can hold this visit.' };
    }
    const result = await (0, shared_2.applyTransition)(user, visitId, 'HOLD', {}, 'SITE_VISIT_REQUESTED', `Site visit ${visit.booking_code} placed ON_HOLD (Customer unresponsive).`);
    if (visit.project_manager_id) {
        await p.notification.create({
            data: {
                employee_id: visit.project_manager_id,
                type: 'SYSTEM_ALERT',
                title: 'Site Visit On Hold',
                message: `Site visit ${visit.booking_code} is on hold. The telecaller could not reach the customer for reconfirmation.`,
            }
        });
    }
    return result;
}
exports.holdVisit = holdVisit;
/** INITIATE_CANCEL: 1 hour before visit, Telecaller requests PM cross-check. */
async function initiateCancellation(user, visitId) {
    const visit = await p.siteVisitBooking.findFirst({
        where: { id: visitId, lead: {} },
        include: { lead: true },
    });
    if (!visit)
        throw { status: 404, message: 'Site visit booking not found' };
    if (!siteVisit_policy_1.SiteVisitPolicy.canHoldOrInitiateCancel(user, visit)) {
        throw { status: 403, message: 'Forbidden: Only the assigned telecaller can initiate cancellation cross-check.' };
    }
    // 1-hour-before-visit retry check
    const now = new Date();
    const oneHourBefore = new Date(visit.scheduled_date.getTime() - 60 * 60 * 1000);
    if (now < oneHourBefore) {
        throw { status: 400, message: 'Cannot initiate cancellation cross-check until 1 hour before the scheduled visit.' };
    }
    const result = await (0, shared_2.applyTransition)(user, visitId, 'INITIATE_CANCEL', {}, 'SITE_VISIT_REQUESTED', `Site visit ${visit.booking_code} cancellation initiated (PM cross-check pending).`);
    if (visit.project_manager_id) {
        await p.notification.create({
            data: {
                employee_id: visit.project_manager_id,
                type: 'ACTION_REQUIRED',
                title: 'Cross-Check: Cancellation Pending',
                message: `Telecaller cannot reach customer for ${visit.booking_code}. Have they responded to you? Please confirm or reject cancellation.`,
            }
        });
    }
    return result;
}
exports.initiateCancellation = initiateCancellation;
/** PM_CANCEL_REJECT: PM indicates customer has responded, reverting to PENDING_CUSTOMER_RECONFIRMATION. */
async function rejectCancellation(user, visitId) {
    const visit = await p.siteVisitBooking.findFirst({
        where: { id: visitId, lead: {} },
        include: { lead: true },
    });
    if (!visit)
        throw { status: 404, message: 'Site visit booking not found' };
    if (!siteVisit_policy_1.SiteVisitPolicy.canConfirmCancel(user, visit)) {
        throw { status: 403, message: 'Forbidden: Only the assigned PM can reject this cancellation.' };
    }
    const result = await (0, shared_2.applyTransition)(user, visitId, 'PM_CANCEL_REJECT', {}, 'SITE_VISIT_REQUESTED', `PM confirmed customer responded for ${visit.booking_code}. Reverted to active reconfirmation.`);
    if (visit.telecaller_id) {
        await p.notification.create({
            data: {
                employee_id: visit.telecaller_id,
                type: 'SYSTEM_ALERT',
                title: 'Cancellation Rejected by PM',
                message: `PM indicates the customer for ${visit.booking_code} has responded. Visit is active again.`,
            }
        });
    }
    return result;
}
exports.rejectCancellation = rejectCancellation;
/** CONFIRM_CANCEL: PM explicitly confirms cancellation, providing a reason. */
async function confirmCancellation(user, visitId, reason) {
    const visit = await p.siteVisitBooking.findFirst({
        where: { id: visitId, lead: {} },
        include: { lead: true },
    });
    if (!visit)
        throw { status: 404, message: 'Site visit booking not found' };
    if (!siteVisit_policy_1.SiteVisitPolicy.canConfirmCancel(user, visit)) {
        throw { status: 403, message: 'Forbidden: Only the assigned PM can confirm this cancellation.' };
    }
    if (!reason || reason.trim() === '') {
        throw { status: 400, message: 'A cancellation reason must be provided.' };
    }
    // Pass cancellation details in the extra update payload
    const result = await (0, shared_2.applyTransition)(user, visitId, 'CONFIRM_CANCEL', {
        cancellation_reason: reason,
        cancellation_confirmed_by_pm_id: user.employeeId
    }, 'SITE_VISIT_COMPLETED', `Site visit ${visit.booking_code} cancellation confirmed by PM. Reason: ${reason}`);
    // No-Show Flagging (2 No-shows)
    const normalizedReason = reason.toLowerCase().replace(/[\s-]/g, '');
    if (normalizedReason.includes('noshow') && visit.lead.assigned_to_id) {
        // Find telecaller's reporting manager
        const telecaller = await p.employee.findUnique({
            where: { id: visit.lead.assigned_to_id },
            select: { reporting_manager_id: true }
        });
        if (telecaller && telecaller.reporting_manager_id) {
            // Count previous no-shows
            const previousNoShows = await p.siteVisitBooking.count({
                where: {
                    lead_id: visit.lead_id,
                    status: 'CANCELLED',
                    cancellation_reason: { contains: 'show' }
                }
            });
            // This count includes the current one since applyTransition just updated it
            if (previousNoShows >= 2) {
                await p.notification.create({
                    data: {
                        employee_id: telecaller.reporting_manager_id,
                        type: 'SYSTEM_ALERT',
                        title: 'Customer No-Show Cap Exceeded',
                        message: `Customer ${visit.lead.customer_name} has hit the 2 No-Show cap. Please review this lead with the assigned telecaller.`,
                    }
                });
            }
        }
    }
    return result;
}
exports.confirmCancellation = confirmCancellation;
