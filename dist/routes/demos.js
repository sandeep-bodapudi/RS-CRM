"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("../utils/logger");
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const auth_2 = require("../middleware/auth");
const shared_1 = require("../shared");
const validate_1 = require("../middleware/validate");
const DemoService = __importStar(require("../services/demo.service"));
const shared_2 = require("../shared");
const prisma_1 = require("../lib/prisma");
const router = (0, express_1.Router)();
// GET /api/v1/demos - List demos (for PM's pending demo requests queue)
router.get('/', auth_1.authenticateToken, (0, auth_2.requirePermission)([shared_1.Permissions.DEMOS_READ]), async (req, res, next) => {
    try {
        const { status, handler_id, leadId } = req.query;
        const filters = {
            status: status,
            handler_id: handler_id,
            leadId: leadId,
        };
        const demos = await DemoService.listDemos(req.user, filters);
        return res.status(200).json({ demos });
    }
    catch (error) {
        logger_1.logger.error('Fetch demos error:', error);
        next(error);
    }
});
// GET /api/v1/demos/:id - Get single demo
router.get('/:id', auth_1.authenticateToken, (0, auth_2.requirePermission)([shared_1.Permissions.DEMOS_READ]), async (req, res, next) => {
    try {
        const demoId = parseInt(req.params.id, 10);
        if (isNaN(demoId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        const demo = await DemoService.getDemo(req.user, demoId);
        return res.status(200).json({ demo });
    }
    catch (error) {
        logger_1.logger.error('Fetch demo error:', error);
        next(error);
    }
});
// GET /api/v1/demos/:id/history - Get demo routing/audit history
router.get('/:id/history', auth_1.authenticateToken, (0, auth_2.requirePermission)([shared_1.Permissions.DEMOS_READ]), async (req, res, next) => {
    try {
        const demoId = parseInt(req.params.id, 10);
        if (isNaN(demoId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        // Fetch demo with handler history
        const demo = await prisma_1.prisma.demo.findFirst({
            where: {
                id: demoId,
                lead: { company_id: req.user.companyId },
            },
            select: {
                id: true,
                scheduled_at: true,
                accepted_at: true,
                accepted_by: true,
                created_at: true,
                updated_at: true,
                handler: { select: { id: true, full_name: true, employee_code: true } },
                lead: {
                    select: {
                        customer_name: true,
                        assigned_to: { select: { id: true, full_name: true, employee_code: true } },
                        created_by: { select: { id: true, full_name: true, employee_code: true } },
                    },
                },
            },
        });
        if (!demo)
            throw { status: 404, message: 'Demo not found' };
        // Build audit timeline from available demo metadata
        const history = [];
        if (demo.created_at) {
            history.push({
                event: 'CREATED',
                timestamp: demo.created_at,
                handler: demo.handler,
                details: 'Demo created and routed to handler',
            });
        }
        if (demo.accepted_at) {
            history.push({
                event: 'ACCEPTED',
                timestamp: demo.accepted_at,
                handler: demo.handler,
                details: 'Handler accepted the demo',
            });
        }
        if (demo.updated_at && demo.updated_at > demo.created_at) {
            history.push({
                event: 'UPDATED',
                timestamp: demo.updated_at,
                handler: demo.handler,
                details: 'Demo details updated',
            });
        }
        return res.status(200).json({
            history,
            demo: {
                id: demo.id,
                scheduled_at: demo.scheduled_at,
                accepted_at: demo.accepted_at,
                handler: demo.handler,
                lead: demo.lead,
            },
        });
    }
    catch (error) {
        logger_1.logger.error('Fetch demo history error:', error);
        next(error);
    }
});
// POST /api/v1/demos/:id/accept - Handler accepts the demo (blind approval: reveals customer info)
router.post('/:id/accept', auth_1.authenticateToken, (0, auth_2.requirePermission)([shared_1.Permissions.DEMOS_ACCEPT]), (0, validate_1.validateRequestBody)(shared_2.DemoAcceptSchema), async (req, res, next) => {
    try {
        const demoId = parseInt(req.params.id, 10);
        if (isNaN(demoId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        const { notes } = req.body;
        const demo = await DemoService.acceptDemo(req.user, demoId, notes);
        return res.status(200).json({
            message: `Demo ${demo.id} accepted! Customer details are now visible.`,
            demo,
        });
    }
    catch (error) {
        logger_1.logger.error('Accept demo error:', error);
        next(error);
    }
});
// POST /api/v1/demos/:id/decline - Handler declines the demo
router.post('/:id/decline', auth_1.authenticateToken, (0, auth_2.requirePermission)([shared_1.Permissions.DEMOS_ACCEPT]), (0, validate_1.validateRequestBody)(shared_2.DemoAcceptSchema), async (req, res, next) => {
    try {
        const demoId = parseInt(req.params.id, 10);
        if (isNaN(demoId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        const { notes } = req.body;
        const demo = await DemoService.declineDemo(req.user, demoId, notes);
        return res.status(200).json({
            message: `Demo ${demo.id} declined.`,
            demo,
        });
    }
    catch (error) {
        logger_1.logger.error('Decline demo error:', error);
        next(error);
    }
});
// POST /api/v1/demos/:id/complete - Handler completes the demo
router.post('/:id/complete', auth_1.authenticateToken, (0, auth_2.requirePermission)([shared_1.Permissions.DEMOS_COMPLETE]), (0, validate_1.validateRequestBody)(shared_2.DemoAcceptSchema), // Reuse schema since it just takes optional notes
async (req, res, next) => {
    try {
        const demoId = parseInt(req.params.id, 10);
        if (isNaN(demoId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        const { notes } = req.body;
        const demo = await DemoService.completeDemo(req.user, demoId, notes);
        return res.status(200).json({
            message: `Demo ${demo.id} marked as completed.`,
            demo,
        });
    }
    catch (error) {
        logger_1.logger.error('Complete demo error:', error);
        next(error);
    }
});
// POST /api/v1/demos/:id/cancel - Handler cancels the demo
router.post('/:id/cancel', auth_1.authenticateToken, (0, auth_2.requirePermission)([shared_1.Permissions.DEMOS_COMPLETE]), (0, validate_1.validateRequestBody)(shared_2.DemoAcceptSchema), // Reuse schema
async (req, res, next) => {
    try {
        const demoId = parseInt(req.params.id, 10);
        if (isNaN(demoId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        const { notes } = req.body;
        const demo = await DemoService.cancelDemo(req.user, demoId, notes);
        return res.status(200).json({
            message: `Demo ${demo.id} cancelled.`,
            demo,
        });
    }
    catch (error) {
        logger_1.logger.error('Cancel demo error:', error);
        next(error);
    }
});
// POST /api/v1/demos/:id/reassign - Route demo to a different handler
router.post('/:id/reassign', auth_1.authenticateToken, (0, auth_2.requirePermission)([shared_1.Permissions.DEMOS_ASSIGN_AGENT]), (0, validate_1.validateRequestBody)(shared_2.DemoAcceptSchema), // Reuse schema — body: { handler_id, reason }
async (req, res, next) => {
    try {
        const demoId = parseInt(req.params.id, 10);
        if (isNaN(demoId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        const { handler_id, reason } = req.body;
        const demo = await DemoService.reassignDemo(req.user, demoId, handler_id, reason);
        if (!demo)
            throw { status: 404, message: 'Demo not found after reassignment' };
        return res.status(200).json({
            message: `Demo ${demo.id} reassigned to handler ${demo.handler_id}.`,
            demo,
        });
    }
    catch (error) {
        logger_1.logger.error('Reassign demo error:', error);
        next(error);
    }
});
exports.default = router;
