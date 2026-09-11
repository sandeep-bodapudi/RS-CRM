"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// § Phase 3: pricing-rule CRUD + preview/recalculate for a standalone
// Property — mirrors routes/projects/pricing.ts's shape for ProjectPricingRule.
const logger_1 = require("../../utils/logger");
const express_1 = require("express");
const auth_1 = require("../../middleware/auth");
const authz_1 = require("../../middleware/authz");
const validate_1 = require("../../middleware/validate");
const prisma_1 = require("../../lib/prisma");
const dataScope_1 = require("../../authz/dataScope");
const shared_1 = require("../../shared");
const propertyRules_service_1 = require("../../services/pricing/propertyRules.service");
const pricing_service_1 = require("../../services/pricing/pricing.service");
const property_service_1 = require("../../services/property.service");
const router = (0, express_1.Router)();
const p = prisma_1.prisma;
const propertyInScope = () => async (req) => {
    const propertyId = parseInt(req.params.id, 10);
    const scope = await (0, dataScope_1.buildPropertyScope)(req.user);
    return p.property.findFirst({ where: { id: propertyId, ...scope } });
};
// GET /api/v1/properties/:id/pricing-rules
router.get('/:id/pricing-rules', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROPERTIES_READ, propertyInScope()), async (req, res) => {
    try {
        const propertyId = parseInt(req.params.id, 10);
        const rules = await propertyRules_service_1.PropertyPricingRulesService.listRules(req.user, propertyId);
        return res.status(200).json({ rules });
    }
    catch (error) {
        logger_1.logger.error('List property pricing rules error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to fetch pricing rules' });
    }
});
// POST /api/v1/properties/:id/pricing-rules
router.post('/:id/pricing-rules', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROPERTIES_UPDATE, propertyInScope()), (0, validate_1.validateRequestBody)(shared_1.PropertyPricingRuleCreateSchema), async (req, res) => {
    try {
        const propertyId = parseInt(req.params.id, 10);
        const rule = await propertyRules_service_1.PropertyPricingRulesService.createRule(req.user, propertyId, req.body);
        return res.status(201).json({ message: 'Pricing rule created', rule });
    }
    catch (error) {
        logger_1.logger.error('Create property pricing rule error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to create pricing rule' });
    }
});
// PUT /api/v1/properties/:id/pricing-rules/:ruleId
router.put('/:id/pricing-rules/:ruleId', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROPERTIES_UPDATE, propertyInScope()), (0, validate_1.validateRequestBody)(shared_1.PropertyPricingRuleUpdateSchema), async (req, res) => {
    try {
        const propertyId = parseInt(req.params.id, 10);
        const ruleId = parseInt(req.params.ruleId, 10);
        const rule = await propertyRules_service_1.PropertyPricingRulesService.updateRule(req.user, propertyId, ruleId, req.body);
        return res.status(200).json({ message: 'Pricing rule updated', rule });
    }
    catch (error) {
        logger_1.logger.error('Update property pricing rule error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to update pricing rule' });
    }
});
// DELETE /api/v1/properties/:id/pricing-rules/:ruleId - deactivates, mirrors
// ProjectPricingRule's soft-delete (PriceLine.property_rule_id references it).
router.delete('/:id/pricing-rules/:ruleId', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROPERTIES_UPDATE, propertyInScope()), async (req, res) => {
    try {
        const propertyId = parseInt(req.params.id, 10);
        const ruleId = parseInt(req.params.ruleId, 10);
        const result = await propertyRules_service_1.PropertyPricingRulesService.deleteRule(req.user, propertyId, ruleId);
        return res.status(200).json(result);
    }
    catch (error) {
        logger_1.logger.error('Delete property pricing rule error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to delete pricing rule' });
    }
});
// POST /api/v1/properties/:id/pricing/preview - computes a price against the
// property's persisted rules without persisting anything. Lets the dossier's
// Pricing tab show the exact number a recalculate would produce, before
// committing to it.
router.post('/:id/pricing/preview', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROPERTIES_READ, propertyInScope()), (0, validate_1.validateRequestBody)(shared_1.PropertyPricePreviewSchema), async (req, res) => {
    try {
        const propertyId = parseInt(req.params.id, 10);
        const computation = await pricing_service_1.PricingService.previewForProperty(req.user, propertyId, req.body);
        return res.status(200).json({ computation });
    }
    catch (error) {
        logger_1.logger.error('Property pricing preview error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to preview price' });
    }
});
// POST /api/v1/properties/:id/pricing/recalculate - applies the current rule
// set + manual lines, persisting real PriceLine rows and the summary fields.
// A rule create/update/delete does NOT auto-recompute (same as Project) —
// this is the explicit action that does, so a batch of rule edits doesn't
// thrash the property's price on every single change.
router.post('/:id/pricing/recalculate', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROPERTIES_UPDATE, propertyInScope()), async (req, res) => {
    try {
        const propertyId = parseInt(req.params.id, 10);
        const updated = await pricing_service_1.PricingService.recalculateProperty(propertyId);
        return res.status(200).json({ message: 'Price recalculated', property: updated });
    }
    catch (error) {
        logger_1.logger.error('Property recalculate error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to recalculate price' });
    }
});
// POST /api/v1/properties/:id/override-price - manual final-price override.
// The calculated price is always preserved separately, mirrors
// projects/units.ts's unit-level override.
router.post('/:id/override-price', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROPERTIES_UPDATE, propertyInScope()), (0, validate_1.validateRequestBody)(shared_1.OverridePropertyPriceSchema), async (req, res) => {
    try {
        const propertyId = parseInt(req.params.id, 10);
        const property = await property_service_1.PropertyService.overridePrice(req.user, propertyId, req.body.override_price, req.body.override_reason);
        return res.status(200).json({ message: 'Price override applied', property });
    }
    catch (error) {
        logger_1.logger.error('Override property price error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to override price' });
    }
});
exports.default = router;
