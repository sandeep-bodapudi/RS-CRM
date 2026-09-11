import { logger } from '../../utils/logger';
import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../../middleware/auth';
import { requireAuthz } from '../../middleware/authz';
import { validateRequestBody } from '../../middleware/validate';
import { prisma } from '../../lib/prisma';
import { buildProjectScope } from '../../authz/dataScope';
import {
  Permissions,
  ProjectUnitCreateSchema,
  ProjectUnitUpdateSchema,
  ProjectUnitBulkCreateSchema,
  ChangeUnitStatusSchema,
  OverrideUnitPriceSchema,
  PricePreviewSchema,
  AddUnitFeatureSchema,
} from '../../shared';
import { ProjectUnitService } from '../../services/projectUnit.service';
import { PricingService } from '../../services/pricing/pricing.service';

const router = Router();
const p = prisma;

const projectInScope = () => async (req: AuthenticatedRequest) => {
  const projectId = parseInt(req.params.id, 10);
  const scope = await buildProjectScope(req.user!);
  return p.project.findFirst({ where: { id: projectId, ...scope } });
};

// ─────────────────────────────────────────────────────────────
// Literal-path routes MUST be registered before the /:unitId catch-all below,
// or Express would match e.g. "preview-price" as a unitId.
// ─────────────────────────────────────────────────────────────

// POST /api/v1/projects/:id/units/preview-price - live cost-sheet preview for
// the Add Unit wizard, before any row exists. The server computes; the client
// never does (see services/pricing/engine.ts header comment).
router.post(
  '/:id/units/preview-price',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_READ, projectInScope()),
  validateRequestBody(PricePreviewSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = parseInt(req.params.id, 10);
      const computation = await PricingService.previewForProject(req.user!, projectId, req.body);
      return res.status(200).json({ computation });
    } catch (error: any) {
      logger.error('Preview unit price error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to preview price' });
    }
  },
);

// GET /api/v1/projects/:id/units/summary - live inventory counts/value, never
// manually entered (spec section 24).
router.get(
  '/:id/units/summary',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_READ, projectInScope()),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = parseInt(req.params.id, 10);
      const summary = await ProjectUnitService.getInventorySummary(req.user!, projectId);
      return res.status(200).json({ summary });
    } catch (error: any) {
      logger.error('Unit inventory summary error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to fetch inventory summary' });
    }
  },
);

// POST /api/v1/projects/:id/units/generate - "Generate many" bulk creation of
// real ProjectUnit rows (GenerateUnitsWizard.tsx).
router.post(
  '/:id/units/generate',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_UPDATE, projectInScope()),
  validateRequestBody(ProjectUnitBulkCreateSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = parseInt(req.params.id, 10);
      const result = await ProjectUnitService.bulkCreateUnits(req.user!, projectId, req.body);
      return res.status(201).json({
        message: `${result.created} of ${result.total} unit(s) created successfully`,
        ...result,
      });
    } catch (error: any) {
      logger.error('Generate units error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to generate units' });
    }
  },
);

// GET /api/v1/projects/:id/units - list/filter units
router.get(
  '/:id/units',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_READ, projectInScope()),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = parseInt(req.params.id, 10);
      const { unit_type, sales_status, tower, bhk, facing, search } = req.query;
      const floor =
        req.query.floor !== undefined ? parseInt(req.query.floor as string, 10) : undefined;
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
      const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

      const { units, total } = await ProjectUnitService.listUnits(
        req.user!,
        projectId,
        {
          unit_type: typeof unit_type === 'string' ? unit_type : undefined,
          sales_status: typeof sales_status === 'string' ? sales_status : undefined,
          tower: typeof tower === 'string' ? tower : undefined,
          floor: Number.isFinite(floor) ? floor : undefined,
          bhk: typeof bhk === 'string' ? bhk : undefined,
          facing: typeof facing === 'string' ? facing : undefined,
          search: typeof search === 'string' ? search : undefined,
        },
        limit,
        offset,
      );
      return res.status(200).json({ units, pagination: { limit, offset, total } });
    } catch (error: any) {
      logger.error('List units error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to fetch units' });
    }
  },
);

// POST /api/v1/projects/:id/units - create a single unit
router.post(
  '/:id/units',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_UPDATE, projectInScope()),
  validateRequestBody(ProjectUnitCreateSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = parseInt(req.params.id, 10);
      const unit = await ProjectUnitService.createUnit(req.user!, projectId, req.body);
      return res.status(201).json({ message: 'Unit created successfully', unit });
    } catch (error: any) {
      logger.error('Create unit error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to create unit' });
    }
  },
);

// GET /api/v1/projects/:id/units/:unitId
router.get(
  '/:id/units/:unitId',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_READ, projectInScope()),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const unitId = parseInt(req.params.unitId, 10);
      const unit = await ProjectUnitService.getUnit(req.user!, unitId);
      return res.status(200).json({ unit });
    } catch (error: any) {
      logger.error('Fetch unit error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to fetch unit' });
    }
  },
);

// PUT /api/v1/projects/:id/units/:unitId
router.put(
  '/:id/units/:unitId',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_UPDATE, projectInScope()),
  validateRequestBody(ProjectUnitUpdateSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const unitId = parseInt(req.params.unitId, 10);
      const unit = await ProjectUnitService.updateUnit(req.user!, unitId, req.body);
      return res.status(200).json({ message: 'Unit updated successfully', unit });
    } catch (error: any) {
      logger.error('Update unit error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to update unit' });
    }
  },
);

// DELETE /api/v1/projects/:id/units/:unitId
router.delete(
  '/:id/units/:unitId',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_UPDATE, projectInScope()),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const unitId = parseInt(req.params.unitId, 10);
      const result = await ProjectUnitService.deleteUnit(req.user!, unitId);
      return res.status(200).json(result);
    } catch (error: any) {
      logger.error('Delete unit error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to delete unit' });
    }
  },
);

// POST /api/v1/projects/:id/units/:unitId/status - manual status change
// (AVAILABLE/HOLD/BLOCKED/UNAVAILABLE/SOLD only — RESERVED/BOOKED are owned by
// the booking workflow, see services/projectUnit.service.ts changeStatus()).
router.post(
  '/:id/units/:unitId/status',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_UPDATE, projectInScope()),
  validateRequestBody(ChangeUnitStatusSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const unitId = parseInt(req.params.unitId, 10);
      const unit = await ProjectUnitService.changeStatus(
        req.user!,
        unitId,
        req.body.sales_status,
        req.body.reason,
      );
      return res.status(200).json({ message: 'Unit status updated', unit });
    } catch (error: any) {
      logger.error('Change unit status error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to change unit status' });
    }
  },
);

// POST /api/v1/projects/:id/units/:unitId/override-price - manual final-price
// override. The calculated price is always preserved separately (spec section 20).
router.post(
  '/:id/units/:unitId/override-price',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_UPDATE, projectInScope()),
  validateRequestBody(OverrideUnitPriceSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const unitId = parseInt(req.params.unitId, 10);
      const unit = await ProjectUnitService.overridePrice(
        req.user!,
        unitId,
        req.body.override_price,
        req.body.override_reason,
      );
      return res.status(200).json({ message: 'Price override applied', unit });
    } catch (error: any) {
      logger.error('Override unit price error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to override price' });
    }
  },
);

// POST /api/v1/projects/:id/units/:unitId/features - add a one-off feature
// ("Park Facing", "2 Car Parking"), distinct from a project-wide amenity.
router.post(
  '/:id/units/:unitId/features',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_UPDATE, projectInScope()),
  validateRequestBody(AddUnitFeatureSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const unitId = parseInt(req.params.unitId, 10);
      const feature = await ProjectUnitService.addFeature(
        req.user!,
        unitId,
        req.body.label,
        req.body.charge_amount,
      );
      return res.status(201).json({ message: 'Feature added', feature });
    } catch (error: any) {
      logger.error('Add unit feature error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to add feature' });
    }
  },
);

// DELETE /api/v1/projects/:id/units/:unitId/features/:featureId
router.delete(
  '/:id/units/:unitId/features/:featureId',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_UPDATE, projectInScope()),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const unitId = parseInt(req.params.unitId, 10);
      const featureId = parseInt(req.params.featureId, 10);
      const result = await ProjectUnitService.removeFeature(req.user!, unitId, featureId);
      return res.status(200).json(result);
    } catch (error: any) {
      logger.error('Remove unit feature error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to remove feature' });
    }
  },
);

// GET /api/v1/projects/:id/units/:unitId/activity
router.get(
  '/:id/units/:unitId/activity',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_READ, projectInScope()),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const unitId = parseInt(req.params.unitId, 10);
      const events = await ProjectUnitService.listActivity(req.user!, unitId);
      return res.status(200).json({ events });
    } catch (error: any) {
      logger.error('Unit activity error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to fetch activity' });
    }
  },
);

export default router;
