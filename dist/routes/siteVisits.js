"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("../utils/logger");
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const shared_1 = require("../shared");
const shared_2 = require("../shared");
const validate_1 = require("../middleware/validate");
const siteVisit_service_1 = require("../services/siteVisit.service");
const prisma_1 = require("../lib/prisma");
const router = (0, express_1.Router)();
// GET /api/v1/site-visits - List site visits (role and company-aware)
router.get('/', auth_1.authenticateToken, (0, auth_1.requirePermission)([shared_1.Permissions.SITE_VISITS_READ]), async (req, res, next) => {
    try {
        const { status, leadId, escalated } = req.query;
        const filters = {
            status: status,
            leadId: leadId,
            escalated: escalated === 'true',
        };
        const visits = await siteVisit_service_1.SiteVisitService.listVisits(req.user, filters);
        return res.status(200).json({ visits });
    }
    catch (error) {
        logger_1.logger.error('Fetch site visits error:', error);
        next(error);
    }
});
// GET /api/v1/site-visits/:id/history - Get reassignment/routing history
router.get('/:id/history', auth_1.authenticateToken, (0, auth_1.requirePermission)([shared_1.Permissions.SITE_VISITS_READ]), async (req, res, next) => {
    try {
        const visitId = parseInt(req.params.id, 10);
        if (isNaN(visitId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        // First check if user can access the visit
        const filters = { leadId: '' }; // Just to pass valid type
        // Check access implicitly by fetching from db directly but constrained to company
        const visit = await prisma_1.prisma.siteVisitBooking.findFirst({
            where: { id: visitId, lead: { company_id: req.user.companyId } },
        });
        if (!visit)
            throw { status: 404, message: 'Site visit not found' };
        const history = await prisma_1.prisma.siteVisitReassignment.findMany({
            where: { visit_id: visitId },
            include: {
                from_employee: { select: { id: true, full_name: true, employee_code: true } },
                to_employee: { select: { id: true, full_name: true, employee_code: true } },
            },
            orderBy: { created_at: 'asc' },
        });
        return res.status(200).json({ history });
    }
    catch (error) {
        logger_1.logger.error('Fetch site visit history error:', error);
        next(error);
    }
});
// POST /api/v1/site-visits - Telecaller books site visit (→ REQUESTED → PENDING_ACCEPTANCE)
router.post('/', auth_1.authenticateToken, (0, auth_1.requirePermission)([shared_1.Permissions.SITE_VISITS_CREATE]), (0, validate_1.validateRequestBody)(shared_2.SiteVisitCreateSchema), async (req, res, next) => {
    try {
        const booking = await siteVisit_service_1.SiteVisitService.bookVisit(req.user, req.body);
        return res.status(201).json({
            message: `Site visit ${booking.booking_code} booked! Awaiting project PM acceptance.`,
            booking,
        });
    }
    catch (error) {
        logger_1.logger.error('Book site visit error:', error);
        next(error);
    }
});
// POST /api/v1/site-visits/:id/accept - PM/Agent accepts the routed visit
router.post('/:id/accept', auth_1.authenticateToken, (0, auth_1.requirePermission)([shared_1.Permissions.SITE_VISITS_ASSIGN_AGENT]), (0, validate_1.validateRequestBody)(shared_2.SiteVisitAcceptSchema), async (req, res, next) => {
    try {
        const visitId = parseInt(req.params.id, 10);
        if (isNaN(visitId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        const { notes } = req.body;
        const visit = await siteVisit_service_1.SiteVisitService.acceptVisit(req.user, visitId, notes);
        return res.status(200).json({
            message: `Site visit ${visit.booking_code} accepted!`,
            visit,
        });
    }
    catch (error) {
        logger_1.logger.error('Accept site visit error:', error);
        next(error);
    }
});
// POST /api/v1/site-visits/:id/reassign - Open reassignment chain (logged, §2)
router.post('/:id/reassign', auth_1.authenticateToken, (0, auth_1.requirePermission)([shared_1.Permissions.SITE_VISITS_ASSIGN_AGENT]), (0, validate_1.validateRequestBody)(shared_2.SiteVisitReassignSchema), async (req, res, next) => {
    try {
        const visitId = parseInt(req.params.id, 10);
        if (isNaN(visitId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        const { to_employee_id, reason } = req.body;
        const visit = await siteVisit_service_1.SiteVisitService.reassignVisit(req.user, visitId, to_employee_id, reason);
        return res.status(200).json({
            message: `Site visit ${visit.booking_code} reassigned.`,
            visit,
        });
    }
    catch (error) {
        logger_1.logger.error('Reassign site visit error:', error);
        next(error);
    }
});
// POST /api/v1/site-visits/:id/escalate - No PM/Agent left → Marketing Director
router.post('/:id/escalate', auth_1.authenticateToken, (0, auth_1.requirePermission)([shared_1.Permissions.SITE_VISITS_ASSIGN_AGENT]), (0, validate_1.validateRequestBody)(shared_2.SiteVisitEscalateSchema), async (req, res, next) => {
    try {
        const visitId = parseInt(req.params.id, 10);
        if (isNaN(visitId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        const { reason } = req.body;
        const visit = await siteVisit_service_1.SiteVisitService.escalateVisit(req.user, visitId, reason);
        return res.status(200).json({
            message: `Site visit ${visit.booking_code} escalated to Marketing Director.`,
            visit,
        });
    }
    catch (error) {
        logger_1.logger.error('Escalate site visit error:', error);
        next(error);
    }
});
// POST /api/v1/site-visits/:id/reconfirm-customer - Day-before reconfirmation call
router.post('/:id/reconfirm-customer', auth_1.authenticateToken, (0, auth_1.requirePermission)([shared_1.Permissions.SITE_VISITS_VERIFY]), (0, validate_1.validateRequestBody)(shared_2.EmptyBodySchema), async (req, res, next) => {
    try {
        const visitId = parseInt(req.params.id, 10);
        if (isNaN(visitId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        const visit = await siteVisit_service_1.SiteVisitService.reconfirmCustomer(req.user, visitId);
        return res.status(200).json({
            message: `Reconfirmation call initiated for ${visit.booking_code}.`,
            visit,
        });
    }
    catch (error) {
        logger_1.logger.error('Reconfirm-customer error:', error);
        next(error);
    }
});
// POST /api/v1/site-visits/:id/reschedule - Customer requested reschedule (date/property)
router.post('/:id/reschedule', auth_1.authenticateToken, (0, auth_1.requirePermission)([shared_1.Permissions.SITE_VISITS_VERIFY]), (0, validate_1.validateRequestBody)(shared_2.SiteVisitRescheduleSchema), async (req, res, next) => {
    try {
        const visitId = parseInt(req.params.id, 10);
        if (isNaN(visitId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        const visit = await siteVisit_service_1.SiteVisitService.rescheduleVisit(req.user, visitId, req.body);
        return res.status(200).json({
            message: `Reschedule requested for ${visit.booking_code}. Awaiting PM reconfirmation.`,
            visit,
        });
    }
    catch (error) {
        logger_1.logger.error('Reschedule error:', error);
        next(error);
    }
});
// POST /api/v1/site-visits/:id/pm-reconfirm - PM confirms or releases after reschedule
router.post('/:id/pm-reconfirm', auth_1.authenticateToken, (0, auth_1.requirePermission)([shared_1.Permissions.SITE_VISITS_ASSIGN_AGENT]), (0, validate_1.validateRequestBody)(shared_2.SiteVisitReconfirmSchema), async (req, res, next) => {
    try {
        const visitId = parseInt(req.params.id, 10);
        if (isNaN(visitId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        const { release } = req.body;
        const visit = await siteVisit_service_1.SiteVisitService.pmReconfirm(req.user, visitId, !!release);
        return res.status(200).json({
            message: release
                ? `Site visit ${visit.booking_code} released back to project PM for acceptance.`
                : `Site visit ${visit.booking_code} reconfirmed by PM.`,
            visit,
        });
    }
    catch (error) {
        logger_1.logger.error('PM reconfirm error:', error);
        next(error);
    }
});
// POST /api/v1/site-visits/:id/confirm - PENDING_CUSTOMER_RECONFIRMATION / RESCHEDULE_REQUESTED → CONFIRMED
router.post('/:id/confirm', auth_1.authenticateToken, (0, auth_1.requirePermission)([shared_1.Permissions.SITE_VISITS_VERIFY]), (0, validate_1.validateRequestBody)(shared_2.EmptyBodySchema), async (req, res, next) => {
    try {
        const visitId = parseInt(req.params.id, 10);
        if (isNaN(visitId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        const visit = await siteVisit_service_1.SiteVisitService.confirmVisit(req.user, visitId);
        return res.status(200).json({
            message: `Site visit ${visit.booking_code} confirmed.`,
            visit,
        });
    }
    catch (error) {
        logger_1.logger.error('Confirm visit error:', error);
        next(error);
    }
});
// POST /api/v1/site-visits/:id/start - CONFIRMED → ACTIVE (day-of)
router.post('/:id/start', auth_1.authenticateToken, (0, auth_1.requirePermission)([shared_1.Permissions.SITE_VISITS_COMPLETE]), (0, validate_1.validateRequestBody)(shared_2.EmptyBodySchema), async (req, res, next) => {
    try {
        const visitId = parseInt(req.params.id, 10);
        if (isNaN(visitId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        const visit = await siteVisit_service_1.SiteVisitService.startVisit(req.user, visitId);
        return res.status(200).json({
            message: `Site visit ${visit.booking_code} is now ACTIVE.`,
            visit,
        });
    }
    catch (error) {
        logger_1.logger.error('Start visit error:', error);
        next(error);
    }
});
// POST /api/v1/site-visits/:id/complete - ACTIVE → COMPLETED with per-property outcomes (§2)
router.post('/:id/complete', auth_1.authenticateToken, (0, auth_1.requirePermission)([shared_1.Permissions.SITE_VISITS_COMPLETE]), (0, validate_1.validateRequestBody)(shared_2.SiteVisitCompleteSchema), async (req, res, next) => {
    try {
        const visitId = parseInt(req.params.id, 10);
        if (isNaN(visitId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        const { outcomes, feedback_notes, proof_photo_url } = req.body;
        const visit = await siteVisit_service_1.SiteVisitService.completeVisit(req.user, visitId, outcomes, feedback_notes, proof_photo_url);
        return res.status(200).json({
            message: `Site visit ${visit.booking_code} completed! Outcomes recorded.`,
            visit,
        });
    }
    catch (error) {
        logger_1.logger.error('Complete site visit error:', error);
        next(error);
    }
});
// POST /api/v1/site-visits/:id/cancel - any active state → CANCELLED
router.post('/:id/cancel', auth_1.authenticateToken, (0, auth_1.requirePermission)([shared_1.Permissions.SITE_VISITS_COMPLETE]), (0, validate_1.validateRequestBody)(shared_2.EmptyBodySchema), async (req, res, next) => {
    try {
        const visitId = parseInt(req.params.id, 10);
        if (isNaN(visitId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        const { reason } = req.body || {};
        const visit = await siteVisit_service_1.SiteVisitService.cancelVisit(req.user, visitId, reason);
        return res.status(200).json({
            message: `Site visit ${visit.booking_code} cancelled.`,
            visit,
        });
    }
    catch (error) {
        logger_1.logger.error('Cancel site visit error:', error);
        next(error);
    }
});
// ==========================================
// Phase D: Hold/Cancel Flow Endpoints
// ==========================================
// POST /api/v1/site-visits/:id/hold - Reconfirmation fails → ON_HOLD
router.post('/:id/hold', auth_1.authenticateToken, (0, auth_1.requirePermission)([shared_1.Permissions.SITE_VISITS_VERIFY]), (0, validate_1.validateRequestBody)(shared_2.EmptyBodySchema), async (req, res, next) => {
    try {
        const visitId = parseInt(req.params.id, 10);
        if (isNaN(visitId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        const visit = await siteVisit_service_1.SiteVisitService.holdVisit(req.user, visitId);
        return res.status(200).json({
            message: `Site visit ${visit.booking_code} placed on hold.`,
            visit,
        });
    }
    catch (error) {
        logger_1.logger.error('Hold site visit error:', error);
        next(error);
    }
});
// POST /api/v1/site-visits/:id/initiate-cancel - Telecaller requests PM cross-check
router.post('/:id/initiate-cancel', auth_1.authenticateToken, (0, auth_1.requirePermission)([shared_1.Permissions.SITE_VISITS_VERIFY]), (0, validate_1.validateRequestBody)(shared_2.EmptyBodySchema), async (req, res, next) => {
    try {
        const visitId = parseInt(req.params.id, 10);
        if (isNaN(visitId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        const visit = await siteVisit_service_1.SiteVisitService.initiateCancellation(req.user, visitId);
        return res.status(200).json({
            message: `Cancellation cross-check initiated for ${visit.booking_code}.`,
            visit,
        });
    }
    catch (error) {
        logger_1.logger.error('Initiate cancel site visit error:', error);
        next(error);
    }
});
// POST /api/v1/site-visits/:id/reject-cancel - PM indicates customer responded
router.post('/:id/reject-cancel', auth_1.authenticateToken, (0, auth_1.requirePermission)([shared_1.Permissions.SITE_VISITS_ASSIGN_AGENT]), (0, validate_1.validateRequestBody)(shared_2.EmptyBodySchema), async (req, res, next) => {
    try {
        const visitId = parseInt(req.params.id, 10);
        if (isNaN(visitId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        const visit = await siteVisit_service_1.SiteVisitService.rejectCancellation(req.user, visitId);
        return res.status(200).json({
            message: `Cancellation rejected for ${visit.booking_code}. Reverted to active reconfirmation.`,
            visit,
        });
    }
    catch (error) {
        logger_1.logger.error('Reject cancel site visit error:', error);
        next(error);
    }
});
// POST /api/v1/site-visits/:id/confirm-cancel - PM explicitly confirms cancellation
router.post('/:id/confirm-cancel', auth_1.authenticateToken, (0, auth_1.requirePermission)([shared_1.Permissions.SITE_VISITS_ASSIGN_AGENT]), (0, validate_1.validateRequestBody)(shared_2.SiteVisitCancelConfirmSchema), async (req, res, next) => {
    try {
        const visitId = parseInt(req.params.id, 10);
        if (isNaN(visitId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        const { reason } = req.body;
        const visit = await siteVisit_service_1.SiteVisitService.confirmCancellation(req.user, visitId, reason);
        return res.status(200).json({
            message: `Site visit ${visit.booking_code} cancellation confirmed.`,
            visit,
        });
    }
    catch (error) {
        logger_1.logger.error('Confirm cancel site visit error:', error);
        next(error);
    }
});
exports.default = router;
