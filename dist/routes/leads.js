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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("../utils/logger");
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const authz_1 = require("../middleware/authz");
const shared_1 = require("../shared");
const validate_1 = require("../middleware/validate");
const lead_service_1 = require("../services/lead.service");
const shared_2 = require("../services/lead/shared");
const opportunity_service_1 = require("../services/opportunity.service");
const prisma_1 = __importDefault(require("../lib/prisma"));
const router = (0, express_1.Router)();
// Helper to catch and route AppErrors to HTTP responses
const handleServiceError = (error, res) => {
    if (error instanceof lead_service_1.AppError || error.name === 'AppError' || error.statusCode) {
        return res.status(error.statusCode || 400).json({ error: error.message, code: error.code });
    }
    logger_1.logger.error('Unhandled route error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
};
// GET /api/v1/leads - Fetch leads list (Role-aware)
router.get('/', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.LEADS_READ), async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
        const offset = Math.max(parseInt(req.query.offset) || 0, 0);
        const leads = await lead_service_1.LeadService.getLeads(req.user, limit, offset);
        return res.status(200).json({ leads, pagination: { limit, offset } });
    }
    catch (error) {
        return handleServiceError(error, res);
    }
});
// GET /api/v1/leads/distribution-monitor - Telecaller load & intake monitor
router.get('/distribution-monitor', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.LEADS_DISTRIBUTION_MONITOR), async (req, res) => {
    try {
        const data = await lead_service_1.LeadService.getDistributionMonitor(req.user.companyId);
        return res.status(200).json(data);
    }
    catch (error) {
        return handleServiceError(error, res);
    }
});
// POST /api/v1/leads - Telecaller creates new lead
router.post('/', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.LEADS_CREATE), (0, validate_1.validateRequestBody)(shared_1.LeadCreateSchema), async (req, res) => {
    try {
        const result = await lead_service_1.LeadService.createLead(req.user, req.body);
        return res.status(201).json({
            message: 'Lead created successfully',
            ...result,
        });
    }
    catch (error) {
        return handleServiceError(error, res);
    }
});
// POST /api/v1/leads/:id/convert-to-customer
router.post('/:id/convert-to-customer', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.CUSTOMERS_CONVERT), async (req, res) => {
    try {
        // We delegate to CustomerService to handle the transaction
        const { CustomerService } = await Promise.resolve().then(() => __importStar(require('../services/customer.service')));
        const result = await CustomerService.convertFromLead(req.user, parseInt(req.params.id));
        return res.status(201).json({
            message: 'Lead converted to customer successfully',
            customer: result,
        });
    }
    catch (error) {
        return handleServiceError(error, res);
    }
});
// POST /api/v1/leads/bulk-upload - Bulk CSV/Excel importer (Digital Lead Operator / MD / Admin)
router.post('/bulk-upload', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.LEADS_BULK_UPLOAD), async (req, res) => {
    try {
        const { leads: rawLeads } = req.body;
        if (!Array.isArray(rawLeads) || rawLeads.length === 0) {
            return res.status(400).json({ error: 'Array of lead rows required in body under "leads"' });
        }
        const result = await lead_service_1.LeadService.bulkUploadLeads(req.user, rawLeads);
        return res.status(200).json({
            message: `Successfully processed and auto-distributed ${result.successful_imports} leads`,
            count: result.successful_imports,
            // Previously dropped on the floor -- a partial failure (duplicates,
            // missing fields, etc.) was invisible to the uploader beyond a lower
            // count than expected, with no explanation of which rows or why.
            total_rows: result.total_rows,
            duplicates: result.duplicates,
            failed_rows: result.failed_rows,
            errors: result.errors,
        });
    }
    catch (error) {
        return handleServiceError(error, res);
    }
});
// POST /api/v1/leads/:id/assign - Manual Re-assignment Override (Audited)
router.post('/:id/assign', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.LEADS_ASSIGN), (0, validate_1.validateRequestBody)(shared_1.LeadReassignSchema), async (req, res) => {
    try {
        const leadId = parseInt(req.params.id, 10);
        const { assigned_to_id, reason } = req.body;
        const updated = await lead_service_1.LeadService.reassignLead(req.user, leadId, assigned_to_id, reason);
        return res.status(200).json({
            message: `Lead ${updated.lead_code} reassigned successfully`,
            lead: updated,
        });
    }
    catch (error) {
        return handleServiceError(error, res);
    }
});
// PATCH /api/v1/leads/:id/status - Update lead status (through the workflow engine)
router.patch('/:id/status', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.LEADS_UPDATE), (0, validate_1.validateRequestBody)(shared_1.LeadStatusUpdateSchema), async (req, res) => {
    try {
        const leadId = parseInt(req.params.id, 10);
        const { status, notes, exit_reason, exit_reason_detail, demo_scheduled_at, demo_handler_id, qualification } = req.body;
        const updated = await lead_service_1.LeadService.updateLeadStatus(req.user, leadId, status, notes, { exit_reason, exit_reason_detail, demo_scheduled_at, demo_handler_id, qualification });
        return res.status(200).json({
            message: `Lead ${updated.lead_code} status updated to ${status}`,
            lead: updated,
        });
    }
    catch (error) {
        return handleServiceError(error, res);
    }
});
// PATCH /api/v1/leads/:id - Generic lead update (for qualification, budget, notes, etc.)
router.patch('/:id', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.LEADS_UPDATE), async (req, res) => {
    try {
        const leadId = parseInt(req.params.id, 10);
        const updateData = req.body;
        const existingLead = await lead_service_1.LeadService.getLeadById(req.user, leadId);
        if (!existingLead) {
            return res.status(404).json({ error: 'Lead not found' });
        }
        // Basic update using prisma
        const updated = await prisma_1.default.$transaction(async (tx) => {
            const lead = await tx.lead.update({
                where: { id: leadId },
                data: {
                    budget_min: updateData.budget_min !== undefined ? updateData.budget_min : undefined,
                    budget_max: updateData.budget_max !== undefined ? updateData.budget_max : undefined,
                    property_type_preference: updateData.property_type_preference !== undefined ? updateData.property_type_preference : undefined,
                    // Full multi-location list (§ Phase 2) wins over the legacy single
                    // field when both are sent — its first entry becomes the primary.
                    preferred_location: updateData.preferred_locations && updateData.preferred_locations.length > 0
                        ? updateData.preferred_locations[0]
                        : (updateData.preferred_location !== undefined ? updateData.preferred_location : undefined),
                    notes: updateData.notes !== undefined ? updateData.notes : undefined,
                }
            });
            if (updateData.preferred_locations !== undefined) {
                await (0, shared_2.syncLeadPreferredLocations)(tx, leadId, updateData.preferred_locations || []);
            }
            return lead;
        });
        // Log activity for qualification update if provided
        if (updateData.budget_min !== undefined || updateData.property_type_preference) {
            await prisma_1.default.leadActivity.create({
                data: {
                    lead_id: leadId,
                    actor_id: req.user.employeeId,
                    activity_type: 'QUALIFIED',
                    notes: 'Lead qualification details updated manually.',
                }
            });
        }
        return res.status(200).json({
            message: `Lead ${updated.lead_code} updated successfully`,
            lead: updated,
        });
    }
    catch (error) {
        return handleServiceError(error, res);
    }
});
// GET /api/v1/leads/:id - Fetch single lead
router.get('/:id', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.LEADS_READ), async (req, res) => {
    try {
        const leadId = parseInt(req.params.id, 10);
        if (isNaN(leadId)) {
            return res.status(400).json({ error: 'Invalid Lead ID' });
        }
        const lead = await lead_service_1.LeadService.getLeadById(req.user, leadId);
        if (!lead) {
            return res.status(404).json({ error: 'Lead not found' });
        }
        // Authorization already passed at middleware level (role-based)
        // and getLeadById enforces tenant isolation.
        return res.status(200).json({ lead });
    }
    catch (error) {
        return handleServiceError(error, res);
    }
});
router.get('/:id/matches', auth_1.authenticateToken, async (req, res) => {
    try {
        const leadId = parseInt(req.params.id, 10);
        const matches = await lead_service_1.LeadService.getMatches(req.user, leadId);
        return res.status(200).json({ matches });
    }
    catch (error) {
        return handleServiceError(error, res);
    }
});
// GET /api/v1/leads/:id/opportunities
router.get('/:id/opportunities', auth_1.authenticateToken, async (req, res) => {
    try {
        const leadId = parseInt(req.params.id, 10);
        // Enforce Lead read authorization (ensure Lead belongs to company, etc)
        const existingLead = await lead_service_1.LeadService.getLeadById(req.user, leadId);
        if (!existingLead) {
            return res.status(404).json({ error: 'Lead not found' });
        }
        const opportunities = await opportunity_service_1.OpportunityService.getOpportunitiesByLead(req.user, leadId);
        return res.status(200).json({ opportunities });
    }
    catch (error) {
        return handleServiceError(error, res);
    }
});
// POST /api/v1/leads/:id/whatsapp-proposal/:propertyId - Send WhatsApp Proposal Payload & Log Activity
router.post('/:id/whatsapp-proposal/:propertyId', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.LEADS_UPDATE), async (req, res) => {
    try {
        const leadId = parseInt(req.params.id, 10);
        const propertyId = parseInt(req.params.propertyId, 10);
        const result = await lead_service_1.LeadService.sendWhatsAppProposal(req.user, leadId, propertyId);
        return res.status(200).json({
            message: 'WhatsApp proposal generated',
            ...result,
        });
    }
    catch (error) {
        return handleServiceError(error, res);
    }
});
// POST /api/v1/leads/:id/properties - Add a property interest
router.post('/:id/properties', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.LEADS_UPDATE), (0, validate_1.validateRequestBody)(shared_1.AddPropertyInterestSchema), async (req, res) => {
    try {
        const leadId = parseInt(req.params.id, 10);
        const { property_id } = req.body;
        const interest = await lead_service_1.LeadService.addPropertyInterest(req.user, leadId, property_id);
        return res.status(201).json({
            message: 'Property interest added successfully',
            interest,
        });
    }
    catch (error) {
        return handleServiceError(error, res);
    }
});
// DELETE /api/v1/leads/:id/properties/:propertyId - Remove a property interest
router.delete('/:id/properties/:propertyId', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.LEADS_UPDATE), async (req, res) => {
    try {
        const leadId = parseInt(req.params.id, 10);
        const propertyId = parseInt(req.params.propertyId, 10);
        const result = await lead_service_1.LeadService.removePropertyInterest(req.user, leadId, propertyId);
        return res.status(200).json(result);
    }
    catch (error) {
        return handleServiceError(error, res);
    }
});
// GET /api/v1/leads/:id/properties - Get properties the lead is interested in
router.get('/:id/properties', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.LEADS_READ), async (req, res) => {
    try {
        const leadId = parseInt(req.params.id, 10);
        const interests = await lead_service_1.LeadService.getPropertyInterests(req.user, leadId);
        return res.status(200).json({ interests });
    }
    catch (error) {
        return handleServiceError(error, res);
    }
});
// GET /api/v1/leads/:id/tasks - Get tasks associated with the lead
router.get('/:id/tasks', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.LEADS_READ), async (req, res) => {
    try {
        const leadId = parseInt(req.params.id, 10);
        const tasks = await lead_service_1.LeadService.getLeadTasks(req.user, leadId);
        return res.status(200).json({ tasks });
    }
    catch (error) {
        return handleServiceError(error, res);
    }
});
// POST /api/v1/leads/:id/recover-manual - Manually recover a dropped/cancelled lead (Same ID)
router.post('/:id/recover-manual', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.LEADS_UPDATE), async (req, res) => {
    try {
        const leadId = parseInt(req.params.id, 10);
        const recovered = await lead_service_1.LeadService.recoverManualLead(req.user, leadId);
        return res.status(200).json({
            message: 'Lead manually recovered successfully',
            lead: recovered
        });
    }
    catch (error) {
        return handleServiceError(error, res);
    }
});
// POST /api/v1/leads/:id/recover-fresh - Start a fresh lead from a dropped/cancelled one (New ID)
router.post('/:id/recover-fresh', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.LEADS_UPDATE), // Or LEADS_CREATE, but practically they need access to the old lead
async (req, res) => {
    try {
        const leadId = parseInt(req.params.id, 10);
        const freshLead = await lead_service_1.LeadService.recoverFreshLead(req.user, leadId);
        return res.status(201).json({
            message: 'Fresh lead created successfully from history',
            lead: freshLead
        });
    }
    catch (error) {
        return handleServiceError(error, res);
    }
});
exports.default = router;
