import { logger } from '../../utils/logger';
import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../../middleware/auth';
import { requireAuthz } from '../../middleware/authz';
import { validateRequestBody } from '../../middleware/validate';
import { prisma } from '../../lib/prisma';
import { buildProjectScope } from '../../authz/dataScope';
import {
  Permissions,
  ProjectPricingRuleCreateSchema,
  ProjectPricingRuleUpdateSchema,
} from '../../shared';
import { PricingRulesService } from '../../services/pricing/rules.service';
import { PricingService } from '../../services/pricing/pricing.service';

const router = Router();
const p = prisma;

const projectInScope = () => async (req: AuthenticatedRequest) => {
  const projectId = parseInt(req.params.id, 10);
  const scope = await buildProjectScope(req.user!);
  return p.project.findFirst({ where: { id: projectId, ...scope } });
};

// GET /api/v1/projects/:id/pricing-rules
router.get(
  '/:id/pricing-rules',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_READ, projectInScope()),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = parseInt(req.params.id, 10);
      const rules = await PricingRulesService.listRules(req.user!, projectId);
      return res.status(200).json({ rules });
    } catch (error: any) {
      logger.error('List pricing rules error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to fetch pricing rules' });
    }
  },
);

// POST /api/v1/projects/:id/pricing-rules
router.post(
  '/:id/pricing-rules',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_UPDATE, projectInScope()),
  validateRequestBody(ProjectPricingRuleCreateSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = parseInt(req.params.id, 10);
      const rule = await PricingRulesService.createRule(req.user!, projectId, req.body);
      return res.status(201).json({ message: 'Pricing rule created', rule });
    } catch (error: any) {
      logger.error('Create pricing rule error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to create pricing rule' });
    }
  },
);

// PUT /api/v1/projects/:id/pricing-rules/:ruleId
router.put(
  '/:id/pricing-rules/:ruleId',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_UPDATE, projectInScope()),
  validateRequestBody(ProjectPricingRuleUpdateSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = parseInt(req.params.id, 10);
      const ruleId = parseInt(req.params.ruleId, 10);
      const rule = await PricingRulesService.updateRule(req.user!, projectId, ruleId, req.body);
      return res.status(200).json({ message: 'Pricing rule updated', rule });
    } catch (error: any) {
      logger.error('Update pricing rule error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to update pricing rule' });
    }
  },
);

// DELETE /api/v1/projects/:id/pricing-rules/:ruleId - deactivates (see
// services/pricing/rules.service.ts for why this isn't a hard delete).
router.delete(
  '/:id/pricing-rules/:ruleId',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_UPDATE, projectInScope()),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = parseInt(req.params.id, 10);
      const ruleId = parseInt(req.params.ruleId, 10);
      const result = await PricingRulesService.deleteRule(req.user!, projectId, ruleId);
      return res.status(200).json(result);
    } catch (error: any) {
      logger.error('Delete pricing rule error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to delete pricing rule' });
    }
  },
);

// GET /api/v1/projects/:id/pricing/recalculate-preview - diff preview before
// committing a project-wide recalculation.
router.get(
  '/:id/pricing/recalculate-preview',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_READ, projectInScope()),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = parseInt(req.params.id, 10);
      const preview = await PricingService.previewRecalculateProject(req.user!, projectId);
      return res.status(200).json(preview);
    } catch (error: any) {
      logger.error('Recalculate preview error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to preview recalculation' });
    }
  },
);

// POST /api/v1/projects/:id/pricing/recalculate - applies the recalculation to
// every unit in the project. The Pricing tab calls the preview above first and
// only calls this after the admin confirms the diff.
router.post(
  '/:id/pricing/recalculate',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_UPDATE, projectInScope()),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = parseInt(req.params.id, 10);
      const result = await PricingService.applyRecalculateProject(req.user!, projectId);
      return res
        .status(200)
        .json({ message: `Recalculated ${result.updated_count} unit(s)`, ...result });
    } catch (error: any) {
      logger.error('Apply recalculation error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to apply recalculation' });
    }
  },
);

export default router;
