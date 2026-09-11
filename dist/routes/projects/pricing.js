"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("../../utils/logger");
const express_1 = require("express");
const auth_1 = require("../../middleware/auth");
const authz_1 = require("../../middleware/authz");
const validate_1 = require("../../middleware/validate");
const prisma_1 = require("../../lib/prisma");
const dataScope_1 = require("../../authz/dataScope");
const shared_1 = require("../../shared");
const rules_service_1 = require("../../services/pricing/rules.service");
const pricing_service_1 = require("../../services/pricing/pricing.service");
const router = (0, express_1.Router)();
const p = prisma_1.prisma;
const projectInScope = () => async (req) => {
    const projectId = parseInt(req.params.id, 10);
    const scope = await (0, dataScope_1.buildProjectScope)(req.user);
    return p.project.findFirst({ where: { id: projectId, ...scope } });
};
// GET /api/v1/projects/:id/pricing-rules
router.get('/:id/pricing-rules', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROJECTS_READ, projectInScope()), async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const rules = await rules_service_1.PricingRulesService.listRules(req.user, projectId);
        return res.status(200).json({ rules });
    }
    catch (error) {
        logger_1.logger.error('List pricing rules error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to fetch pricing rules' });
    }
});
// POST /api/v1/projects/:id/pricing-rules
router.post('/:id/pricing-rules', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROJECTS_UPDATE, projectInScope()), (0, validate_1.validateRequestBody)(shared_1.ProjectPricingRuleCreateSchema), async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const rule = await rules_service_1.PricingRulesService.createRule(req.user, projectId, req.body);
        return res.status(201).json({ message: 'Pricing rule created', rule });
    }
    catch (error) {
        logger_1.logger.error('Create pricing rule error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to create pricing rule' });
    }
});
// PUT /api/v1/projects/:id/pricing-rules/:ruleId
router.put('/:id/pricing-rules/:ruleId', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROJECTS_UPDATE, projectInScope()), (0, validate_1.validateRequestBody)(shared_1.ProjectPricingRuleUpdateSchema), async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const ruleId = parseInt(req.params.ruleId, 10);
        const rule = await rules_service_1.PricingRulesService.updateRule(req.user, projectId, ruleId, req.body);
        return res.status(200).json({ message: 'Pricing rule updated', rule });
    }
    catch (error) {
        logger_1.logger.error('Update pricing rule error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to update pricing rule' });
    }
});
// DELETE /api/v1/projects/:id/pricing-rules/:ruleId - deactivates (see
// services/pricing/rules.service.ts for why this isn't a hard delete).
router.delete('/:id/pricing-rules/:ruleId', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROJECTS_UPDATE, projectInScope()), async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const ruleId = parseInt(req.params.ruleId, 10);
        const result = await rules_service_1.PricingRulesService.deleteRule(req.user, projectId, ruleId);
        return res.status(200).json(result);
    }
    catch (error) {
        logger_1.logger.error('Delete pricing rule error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to delete pricing rule' });
    }
});
// GET /api/v1/projects/:id/pricing/recalculate-preview - diff preview before
// committing a project-wide recalculation.
router.get('/:id/pricing/recalculate-preview', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROJECTS_READ, projectInScope()), async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const preview = await pricing_service_1.PricingService.previewRecalculateProject(req.user, projectId);
        return res.status(200).json(preview);
    }
    catch (error) {
        logger_1.logger.error('Recalculate preview error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to preview recalculation' });
    }
});
// POST /api/v1/projects/:id/pricing/recalculate - applies the recalculation to
// every unit in the project. The Pricing tab calls the preview above first and
// only calls this after the admin confirms the diff.
router.post('/:id/pricing/recalculate', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROJECTS_UPDATE, projectInScope()), async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const result = await pricing_service_1.PricingService.applyRecalculateProject(req.user, projectId);
        return res
            .status(200)
            .json({ message: `Recalculated ${result.updated_count} unit(s)`, ...result });
    }
    catch (error) {
        logger_1.logger.error('Apply recalculation error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to apply recalculation' });
    }
});
exports.default = router;
