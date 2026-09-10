import { logger } from '../../utils/logger';
import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../../middleware/auth';
import { requireAuthz } from '../../middleware/authz';
import { validateRequestBody } from '../../middleware/validate';
import { prisma } from '../../lib/prisma';
import { buildProjectScope } from '../../authz/dataScope';
import { Permissions, ProjectAmenityUpsertSchema } from '../../shared';
import { AmenityService } from '../../services/amenity.service';

const router = Router();
const p = prisma;

const projectInScope = () => async (req: AuthenticatedRequest) => {
  const projectId = parseInt(req.params.id, 10);
  const scope = await buildProjectScope(req.user!);
  return p.project.findFirst({ where: { id: projectId, ...scope } });
};

// GET /api/v1/projects/:id/amenities
router.get(
  '/:id/amenities',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_READ, projectInScope()),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = parseInt(req.params.id, 10);
      const amenities = await AmenityService.listProjectAmenities(req.user!, projectId);
      return res.status(200).json({ amenities });
    } catch (error: any) {
      logger.error('List project amenities error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to fetch project amenities' });
    }
  },
);

// PUT /api/v1/projects/:id/amenities/:amenityId - upsert this project's
// configuration of one catalog amenity (Included/Optional/Chargeable, etc).
router.put(
  '/:id/amenities/:amenityId',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_UPDATE, projectInScope()),
  validateRequestBody(ProjectAmenityUpsertSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = parseInt(req.params.id, 10);
      const amenityId = parseInt(req.params.amenityId, 10);
      const projectAmenity = await AmenityService.setProjectAmenity(req.user!, projectId, amenityId, req.body);
      return res.status(200).json({ message: 'Amenity configuration saved', amenity: projectAmenity });
    } catch (error: any) {
      logger.error('Set project amenity error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to save amenity configuration' });
    }
  },
);

// DELETE /api/v1/projects/:id/amenities/:amenityId - drop this project's
// configuration of a catalog amenity entirely (it stays in the catalog).
router.delete(
  '/:id/amenities/:amenityId',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_UPDATE, projectInScope()),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = parseInt(req.params.id, 10);
      const amenityId = parseInt(req.params.amenityId, 10);
      const result = await AmenityService.removeProjectAmenity(req.user!, projectId, amenityId);
      return res.status(200).json(result);
    } catch (error: any) {
      logger.error('Remove project amenity error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to remove amenity' });
    }
  },
);

export default router;
