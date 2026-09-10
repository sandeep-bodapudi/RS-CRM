import { logger } from '../../utils/logger';
import { Response, NextFunction, Router } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../../middleware/auth';
import { requireAuthz } from '../../middleware/authz';
import { PropertyTogglePublicationBodySchema, Permissions } from '../../shared';
import { validateRequestBody } from '../../middleware/validate';
import { PropertyService } from '../../services/property.service';

const router = Router();

// POST /api/v1/properties/:id/publications - Toggle publication for a brand
router.post(
  '/:id/publications',
  authenticateToken,
  requireAuthz(Permissions.PROPERTIES_UPDATE),
  validateRequestBody(PropertyTogglePublicationBodySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const propertyId = parseInt(req.params.id, 10);
      if (isNaN(propertyId))
        return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
      if (isNaN(propertyId))
        return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
      if (isNaN(propertyId))
        return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
      if (isNaN(propertyId))
        return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
      const { company_id, is_published } = req.body;

      if (!company_id || typeof is_published !== 'boolean') {
        return res
          .status(400)
          .json({ error: 'company_id and is_published (boolean) are required' });
      }

      const publication = await PropertyService.togglePublication(
        req.user!,
        propertyId,
        company_id,
        is_published,
      );

      return res.status(200).json({
        message: `Property ${is_published ? 'published' : 'unpublished'} successfully`,
        publication,
      });
    } catch (error: any) {
      logger.error('Toggle publication error:', error);
      if (error.status) {
        return next(error);
      }
      return res.status(500).json({ error: 'Failed to toggle publication' });
    }
  },
);

// GET /api/v1/properties/:id/publications - List publications for a property
router.get(
  '/:id/publications',
  authenticateToken,
  requireAuthz(Permissions.PROPERTIES_READ),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const propertyId = parseInt(req.params.id, 10);
      if (isNaN(propertyId))
        return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
      if (isNaN(propertyId))
        return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
      if (isNaN(propertyId))
        return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
      if (isNaN(propertyId))
        return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
      const publications = await PropertyService.getPublications(req.user!, propertyId);
      return res.status(200).json({ publications });
    } catch (error: any) {
      logger.error('Get publications error:', error);
      if (error.status) {
        return next(error);
      }
      return res.status(500).json({ error: 'Failed to fetch publications' });
    }
  },
);

export default router;
