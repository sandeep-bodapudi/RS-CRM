// Company-wide amenity catalog — mounted at /api/v1/amenities. Distinct from
// routes/projects/amenities.ts, which manages one project's configuration of
// these catalog entries. See services/amenity.service.ts's doc comment for
// why write routes here don't use requireAuthz(PROJECTS_UPDATE): that policy
// requires a project resource to evaluate and always denies without one, so
// catalog writes are gated in the service layer instead (hasCatalogAccess).
import { Router, Response } from 'express';
import { logger } from '../utils/logger';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { requireAuthz } from '../middleware/authz';
import { validateRequestBody } from '../middleware/validate';
import { Permissions, AmenityCreateSchema, AmenityUpdateSchema } from '../shared';
import { AmenityService } from '../services/amenity.service';

const router = Router();

router.get('/', authenticateToken, requireAuthz(Permissions.PROJECTS_READ), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const amenities = await AmenityService.listCatalog(req.user!);
    return res.status(200).json({ amenities });
  } catch (error: any) {
    logger.error('List amenity catalog error:', error);
    return res.status(500).json({ error: 'Failed to fetch amenity catalog' });
  }
});

router.post('/', authenticateToken, validateRequestBody(AmenityCreateSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const amenity = await AmenityService.createCatalogAmenity(req.user!, req.body);
    return res.status(201).json({ message: 'Amenity added to catalog', amenity });
  } catch (error: any) {
    logger.error('Create catalog amenity error:', error);
    if (error.status) return res.status(error.status).json({ error: error.message });
    return res.status(500).json({ error: 'Failed to create amenity' });
  }
});

router.put('/:amenityId', authenticateToken, validateRequestBody(AmenityUpdateSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const amenityId = parseInt(req.params.amenityId, 10);
    const amenity = await AmenityService.updateCatalogAmenity(req.user!, amenityId, req.body);
    return res.status(200).json({ message: 'Amenity updated', amenity });
  } catch (error: any) {
    logger.error('Update catalog amenity error:', error);
    if (error.status) return res.status(error.status).json({ error: error.message });
    return res.status(500).json({ error: 'Failed to update amenity' });
  }
});

router.delete('/:amenityId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const amenityId = parseInt(req.params.amenityId, 10);
    const result = await AmenityService.deleteCatalogAmenity(req.user!, amenityId);
    return res.status(200).json(result);
  } catch (error: any) {
    logger.error('Delete catalog amenity error:', error);
    if (error.status) return res.status(error.status).json({ error: error.message });
    return res.status(500).json({ error: 'Failed to delete amenity' });
  }
});

export default router;
