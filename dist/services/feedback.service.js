"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listFeedback = exports.submitFeedback = exports.getPublicFeedbackInfo = exports.dispatchFeedbackRequestNotification = exports.createFeedbackRequest = void 0;
// § Phase 7 — customer feedback for a completed site visit, reached with no
// login via a token embedded in a WhatsApp link. See prisma/schema.prisma's
// SiteVisitFeedback model doc comment for the token-hashing rationale.
const crypto_1 = __importDefault(require("crypto"));
const prisma_1 = require("../lib/prisma");
const logger_1 = require("../utils/logger");
const notifyEmployee_1 = require("../utils/notifyEmployee");
const whatsapp_1 = require("../utils/whatsapp");
const shared_1 = require("../shared");
const p = prisma_1.prisma;
const FEEDBACK_LINK_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const APP_URL = process.env.APP_URL || 'http://localhost:5173';
const hashToken = (token) => crypto_1.default.createHash('sha256').update(token).digest('hex');
/**
 * Called from SiteVisitService.completeVisit() right after a visit is marked
 * COMPLETED. Creates the feedback row (inside the caller's transaction) and
 * returns the raw token for the caller to build a WhatsApp link with — the
 * raw token is never persisted, only its hash.
 */
async function createFeedbackRequest(tx, siteVisitId, ratedEmployeeId) {
    const token = crypto_1.default.randomUUID();
    await tx.siteVisitFeedback.create({
        data: {
            site_visit_id: siteVisitId,
            rated_employee_id: ratedEmployeeId,
            token_hash: hashToken(token),
            expires_at: new Date(Date.now() + FEEDBACK_LINK_TTL_MS),
        },
    });
    return token;
}
exports.createFeedbackRequest = createFeedbackRequest;
/**
 * Notifies the telecaller originally assigned to the visit with a WhatsApp
 * deep-link to forward to the customer, mirroring the CREDENTIAL_DELIVERY
 * pattern (customerPortal.service.ts) — the link is generated and handed to
 * a human to send, there is no automated WhatsApp-sending integration here.
 * Deliberately fire-and-forget from the caller's perspective: a notification
 * failure must never roll back the site-visit completion that triggered it.
 */
async function dispatchFeedbackRequestNotification(siteVisitId, token) {
    try {
        const visit = await p.siteVisitBooking.findUnique({
            where: { id: siteVisitId },
            include: {
                lead: true,
                telecaller: true,
                project_manager: true,
                assigned_agent: true,
            },
        });
        if (!visit)
            return;
        const ratedEmployee = visit.assigned_agent || visit.project_manager;
        const feedbackLink = `${APP_URL}/feedback/${token}`;
        const waLink = (0, whatsapp_1.generateWhatsAppLink)(visit.lead.phone, 'SITE_VISIT_FEEDBACK', {
            customer_name: visit.lead.customer_name,
            pm_name: ratedEmployee?.full_name || 'our team',
            feedback_link: feedbackLink,
        });
        await (0, notifyEmployee_1.notifyEmployee)(visit.telecaller_id, {
            type: 'SITE_VISIT_FEEDBACK_READY',
            title: 'Send feedback link to customer',
            message: `${visit.lead.customer_name}'s site visit is complete. Tap to open WhatsApp with a pre-filled feedback link.`,
            link: waLink,
        });
    }
    catch (err) {
        logger_1.logger.error('[Feedback] Failed to dispatch feedback request notification:', err);
    }
}
exports.dispatchFeedbackRequestNotification = dispatchFeedbackRequestNotification;
async function findValidFeedbackByToken(token) {
    const feedback = await p.siteVisitFeedback.findUnique({
        where: { token_hash: hashToken(token) },
        include: { rated_employee: true },
    });
    if (!feedback)
        throw { status: 404, message: 'This feedback link is invalid.' };
    if (feedback.expires_at < new Date())
        throw { status: 410, message: 'This feedback link has expired.' };
    return feedback;
}
async function getPublicFeedbackInfo(token) {
    const feedback = await findValidFeedbackByToken(token);
    return {
        ratedEmployeeName: feedback.rated_employee.full_name || 'your representative',
        alreadySubmitted: !!feedback.submitted_at,
    };
}
exports.getPublicFeedbackInfo = getPublicFeedbackInfo;
async function submitFeedback(token, input) {
    const feedback = await findValidFeedbackByToken(token);
    if (feedback.submitted_at)
        throw { status: 409, message: 'Feedback has already been submitted for this visit.' };
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
        throw { status: 400, message: 'Rating must be a whole number between 1 and 5.' };
    }
    await p.siteVisitFeedback.update({
        where: { id: feedback.id },
        data: {
            submitted_at: new Date(),
            rating: input.rating,
            on_time: input.onTime,
            answered_questions: input.answeredQuestions,
            property_as_described: input.propertyAsDescribed,
            comment: input.comment?.trim() || null,
        },
    });
    // Notify the rated employee's manager + all MDs — the whole point of
    // collecting this is that it reaches someone who can act on it.
    const recipientIds = new Set();
    const ratedEmployee = await p.employee.findUnique({
        where: { id: feedback.rated_employee_id },
        select: { full_name: true, reporting_manager_id: true },
    });
    if (ratedEmployee?.reporting_manager_id)
        recipientIds.add(ratedEmployee.reporting_manager_id);
    const mds = await p.employee.findMany({
        where: { status: 'ACTIVE', roles: { some: { role: { name: shared_1.Roles.MD } } } },
        select: { id: true },
    });
    mds.forEach((md) => recipientIds.add(md.id));
    if (recipientIds.size > 0) {
        const stars = '⭐'.repeat(input.rating);
        await (0, notifyEmployee_1.notifyEmployee)(Array.from(recipientIds), {
            type: 'SITE_VISIT_FEEDBACK_SUBMITTED',
            title: `New feedback for ${ratedEmployee?.full_name || 'an employee'}`,
            message: `${stars} (${input.rating}/5)${input.comment ? ` — "${input.comment}"` : ''}`,
            link: '/settings',
        });
    }
}
exports.submitFeedback = submitFeedback;
/**
 * MD sees every submitted feedback within their own company; anyone else
 * sees only feedback for employees who report directly to them (single-hop,
 * matching the one reporting_manager_id FK the schema actually has). Scoped
 * by companyId even for MDs — this is a multi-tenant DB (see
 * analytics.service.ts's header comment: tenant scope must always come from
 * the authenticated token, never be left open "because they're an MD").
 */
async function listFeedback(requester) {
    const isMD = requester.roles.includes(shared_1.Roles.MD);
    const where = isMD
        ? { submitted_at: { not: null }, rated_employee: { company_id: requester.companyId } }
        : {
            submitted_at: { not: null },
            rated_employee: { reporting_manager_id: requester.employeeId },
        };
    const rows = await p.siteVisitFeedback.findMany({
        where,
        include: {
            rated_employee: { select: { id: true, full_name: true } },
            site_visit: { include: { lead: { select: { customer_name: true } } } },
        },
        orderBy: { submitted_at: 'desc' },
        take: 200,
    });
    return rows.map((row) => ({
        id: row.id,
        ratedEmployeeId: row.rated_employee.id,
        ratedEmployeeName: row.rated_employee.full_name || 'Unnamed',
        rating: row.rating,
        onTime: row.on_time,
        answeredQuestions: row.answered_questions,
        propertyAsDescribed: row.property_as_described,
        comment: row.comment,
        submittedAt: row.submitted_at,
        customerName: row.site_visit.lead.customer_name,
    }));
}
exports.listFeedback = listFeedback;
