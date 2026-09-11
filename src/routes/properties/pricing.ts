// § Phase 3: pricing-rule CRUD + preview/recalculate for a standalone
// Property — mirrors routes/projects/pricing.ts's shape for ProjectPricingRule.
import { logger } from '../../utils/logger';
import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../../middleware/auth';
import { requireAuthz } from '../../middleware/authz';
import { validateRequestBody } from '../../middleware/validate';
import { prisma } from '../../lib/prisma';
import { buildPropertyScope } from '../../authz/dataScope';
import {
  Permissions,
  PropertyPricingRuleCreateSchema,
  PropertyPricingRuleUpdateSchema,
  PropertyPricePreviewSchema,
  OverridePropertyPriceSchema,
} from '../../shared';
import { PropertyPricingRulesService } from '../../services/pricing/propertyRules.service';
import { PricingService } from '../../services/pricing/pricing.service';
import { PropertyService } from '../../services/property.service';

const router = Router();
const p = prisma;

const propertyInScope = () => async (req: AuthenticatedRequest) => {
  const propertyId = parseInt(req.params.id, 10);
  const scope = await buildPropertyScope(req.user!);
  return p.property.findFirst({ where: { id: propertyId, ...scope } });
};

// GET /api/v1/properties/:id/pricing-rules
router.get(
  '/:id/pricing-rules',
  authenticateToken,
  requireAuthz(Permissions.PROPERTIES_READ, propertyInScope()),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const propertyId = parseInt(req.params.id, 10);
      const rules = await PropertyPricingRulesService.listRules(req.user!, propertyId);
      return res.status(200).json({ rules });
    } catch (error: any) {
      logger.error('List property pricing rules error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to fetch pricing rules' });
    }
  },
);

// POST /api/v1/properties/:id/pricing-rules
router.post(
  '/:id/pricing-rules',
  authenticateToken,
  requireAuthz(Permissions.PROPERTIES_UPDATE, propertyInScope()),
  validateRequestBody(PropertyPricingRuleCreateSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const propertyId = parseInt(req.params.id, 10);
      const rule = await PropertyPricingRulesService.createRule(req.user!, propertyId, req.body);
      return res.status(201).json({ message: 'Pricing rule created', rule });
    } catch (error: any) {
      logger.error('Create property pricing rule error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to create pricing rule' });
    }
  },
);

// PUT /api/v1/properties/:id/pricing-rules/:ruleId
router.put(
  '/:id/pricing-rules/:ruleId',
  authenticateToken,
  requireAuthz(Permissions.PROPERTIES_UPDATE, propertyInScope()),
  validateRequestBody(PropertyPricingRuleUpdateSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const propertyId = parseInt(req.params.id, 10);
      const ruleId = parseInt(req.params.ruleId, 10);
      const rule = await PropertyPricingRulesService.updateRule(
        req.user!,
        propertyId,
        ruleId,
        req.body,
      );
      return res.status(200).json({ message: 'Pricing rule updated', rule });
    } catch (error: any) {
      logger.error('Update property pricing rule error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to update pricing rule' });
    }
  },
);

// DELETE /api/v1/properties/:id/pricing-rules/:ruleId - deactivates, mirrors
// ProjectPricingRule's soft-delete (PriceLine.property_rule_id references it).
router.delete(
  '/:id/pricing-rules/:ruleId',
  authenticateToken,
  requireAuthz(Permissions.PROPERTIES_UPDATE, propertyInScope()),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const propertyId = parseInt(req.params.id, 10);
      const ruleId = parseInt(req.params.ruleId, 10);
      const result = await PropertyPricingRulesService.deleteRule(req.user!, propertyId, ruleId);
      return res.status(200).json(result);
    } catch (error: any) {
      logger.error('Delete property pricing rule error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to delete pricing rule' });
    }
  },
);

// POST /api/v1/properties/:id/pricing/preview - computes a price against the
// property's persisted rules without persisting anything. Lets the dossier's
// Pricing tab show the exact number a recalculate would produce, before
// committing to it.
router.post(
  '/:id/pricing/preview',
  authenticateToken,
  requireAuthz(Permissions.PROPERTIES_READ, propertyInScope()),
  validateRequestBody(PropertyPricePreviewSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const propertyId = parseInt(req.params.id, 10);
      const computation = await PricingService.previewForProperty(req.user!, propertyId, req.body);
      return res.status(200).json({ computation });
    } catch (error: any) {
      logger.error('Property pricing preview error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to preview price' });
    }
  },
);

// POST /api/v1/properties/:id/pricing/recalculate - applies the current rule
// set + manual lines, persisting real PriceLine rows and the summary fields.
// A rule create/update/delete does NOT auto-recompute (same as Project) —
// this is the explicit action that does, so a batch of rule edits doesn't
// thrash the property's price on every single change.
router.post(
  '/:id/pricing/recalculate',
  authenticateToken,
  requireAuthz(Permissions.PROPERTIES_UPDATE, propertyInScope()),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const propertyId = parseInt(req.params.id, 10);
      const updated = await PricingService.recalculateProperty(propertyId);
      return res.status(200).json({ message: 'Price recalculated', property: updated });
    } catch (error: any) {
      logger.error('Property recalculate error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to recalculate price' });
    }
  },
);

// POST /api/v1/properties/:id/override-price - manual final-price override.
// The calculated price is always preserved separately, mirrors
// projects/units.ts's unit-level override.
router.post(
  '/:id/override-price',
  authenticateToken,
  requireAuthz(Permissions.PROPERTIES_UPDATE, propertyInScope()),
  validateRequestBody(OverridePropertyPriceSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const propertyId = parseInt(req.params.id, 10);
      const property = await PropertyService.overridePrice(
        req.user!,
        propertyId,
        req.body.override_price,
        req.body.override_reason,
      );
      return res.status(200).json({ message: 'Price override applied', property });
    } catch (error: any) {
      logger.error('Override property price error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to override price' });
    }
  },
);

export default router;
