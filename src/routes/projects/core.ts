import { logger } from '../../utils/logger';
import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../../middleware/auth';
import { requireAuthz } from '../../middleware/authz';
import {
  ProjectCreateSchema,
  ProjectUpdateSchema,
  ProjectReassignSchema,
  ProjectLayoutRegionsSchema,
  Permissions,
} from '../../shared';
import { validateRequestBody } from '../../middleware/validate';
import { ProjectService } from '../../services/project.service';
import { memoryUpload } from '../../services/storage.service';
import { prisma } from '../../lib/prisma';
import { buildProjectScope } from '../../authz/dataScope';

const router = Router();

const p = prisma;

// PROJECTS_UPDATE has no "!resource => true" fallback in the can() engine
// (see authz/authorization.ts) — it requires a resource to evaluate
// ProjectPolicy.canUpdate's company/PM-assignment checks, so every
// PROJECTS_UPDATE-gated route below must pass this as requireAuthz's second
// argument or every non-Admin caller is denied regardless of permissions.
const projectInScope = () => async (req: AuthenticatedRequest) => {
  const projectId = parseInt(req.params.id, 10);
  const scope = await buildProjectScope(req.user!);
  return p.project.findFirst({ where: { id: projectId, ...scope } });
};

// GET /api/v1/projects - List projects
router.get(
  '/',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_READ),
  async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status } = req.query;
    const filters = {
      status: typeof status === 'string' ? status : undefined,
    };

    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 100);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

    const projects = await ProjectService.listProjects(req.user!, filters, limit, offset);
    return res.status(200).json({ projects, pagination: { limit, offset } });
  } catch (error: any) {
    logger.error('Fetch projects error:', error);
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// GET /api/v1/projects/:id - Get single project
router.get('/:id', authenticateToken, requireAuthz(Permissions.PROJECTS_READ, async (req) => {
  const projectId = parseInt(req.params.id, 10);
  return await p.project.findFirst({ where: { id: projectId } });
}), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const project = await ProjectService.getProject(req.user!, projectId);
    return res.status(200).json({ project });
  } catch (error: any) {
    logger.error('Fetch project error:', error);
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Failed to fetch project' });
  }
});

// POST /api/v1/projects - Create Project
router.post(
  '/',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_CREATE),
  validateRequestBody(ProjectCreateSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const project = await ProjectService.createProject(req.user!, req.body);
      return res.status(201).json({
        message: 'Project created successfully',
        project,
      });
    } catch (error: any) {
      logger.error('Create project error:', error);
      if (error.status) {
        return res.status(error.status).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Failed to create project' });
    }
  }
);

// PUT /api/v1/projects/:id - Update Project
router.put(
  '/:id',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_UPDATE, async (req: AuthenticatedRequest) => {
    const projectId = parseInt(req.params.id, 10);
    // Use scoped query so out-of-scope projects return 404 (not 403), consistent with GET
    const scope = await buildProjectScope(req.user!);
    try {
      return await p.project.findFirst({ where: { id: projectId, ...scope } });
    } catch (e: any) {
      logger.error('Prisma validation error payload:', e.message);
      throw e;
    }
  }),
  validateRequestBody(ProjectUpdateSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = parseInt(req.params.id, 10);
      const project = await ProjectService.updateProject(req.user!, projectId, req.body);
      return res.status(200).json({
        message: 'Project updated successfully',
        project,
      });
    } catch (error: any) {
      logger.error('Update project error:', error);
      if (error.status) {
        return res.status(error.status).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Failed to update project' });
    }
  }
);

// DELETE /api/v1/projects/:id - Delete Project (Status transition)
router.delete(
  '/:id',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_DELETE, async (req: AuthenticatedRequest) => {
    const projectId = parseInt(req.params.id, 10);
    // Use scoped query so out-of-scope projects return 404 (not 403), consistent with GET
    const scope = await buildProjectScope(req.user!);
    try {
      return await p.project.findFirst({ where: { id: projectId, ...scope } });
    } catch (e: any) {
      logger.error('Prisma validation error payload DELETE:', e.message);
      throw e;
    }
  }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = parseInt(req.params.id, 10);
      const project = await ProjectService.deleteProject(req.user!, projectId);
      return res.status(200).json({
        message: 'Project deleted successfully',
        project,
      });
    } catch (error: any) {
      logger.error('Delete project error:', error);
      if (error.status) {
        return res.status(error.status).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Failed to delete project' });
    }
  }
);

// POST /api/v1/projects/:id/reassign - Reassign a project's PM, as a distinct
// reasoned action (mandatory reason, dedicated REASSIGNMENT audit entry) —
// separate from the general edit form, which already lets assigned_pm_id
// change freely with no reason/audit trail (Phase 2.7).
router.post(
  '/:id/reassign',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_UPDATE, async (req: AuthenticatedRequest) => {
    const projectId = parseInt(req.params.id, 10);
    const scope = await buildProjectScope(req.user!);
    return await p.project.findFirst({ where: { id: projectId, ...scope } });
  }),
  validateRequestBody(ProjectReassignSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = parseInt(req.params.id, 10);
      const { new_pm_id, reason } = req.body;
      const project = await ProjectService.reassignProject(req.user!, projectId, new_pm_id, reason);
      return res.status(200).json({
        message: 'Project reassigned successfully',
        project,
      });
    } catch (error: any) {
      logger.error('Reassign project error:', error);
      if (error.status) {
        return res.status(error.status).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Failed to reassign project' });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// Phase 2.23: Layout images & unit-position regions
// ─────────────────────────────────────────────────────────────

// POST /api/v1/projects/:id/layout-images - Upload a layout/site-plan image
router.post(
  '/:id/layout-images',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_UPDATE, projectInScope()),
  memoryUpload.single('image') as any,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = parseInt(req.params.id, 10);
      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
      }
      const image = await ProjectService.uploadLayoutImage(req.user!, projectId, req.file, req.body?.title);
      return res.status(201).json({ message: 'Layout image uploaded successfully', image });
    } catch (error: any) {
      logger.error('Upload layout image error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to upload layout image' });
    }
  },
);

// GET /api/v1/projects/:id/layout-images - List layout images with pins + unit summaries
router.get(
  '/:id/layout-images',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_READ),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = parseInt(req.params.id, 10);
      const images = await ProjectService.listLayoutImages(req.user!, projectId);
      return res.status(200).json({ images });
    } catch (error: any) {
      logger.error('List layout images error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to fetch layout images' });
    }
  },
);

// DELETE /api/v1/projects/:id/layout-images/:imageId
router.delete(
  '/:id/layout-images/:imageId',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_UPDATE, projectInScope()),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = parseInt(req.params.id, 10);
      const imageId = parseInt(req.params.imageId, 10);
      const result = await ProjectService.deleteLayoutImage(req.user!, projectId, imageId);
      return res.status(200).json(result);
    } catch (error: any) {
      logger.error('Delete layout image error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to delete layout image' });
    }
  },
);

// PUT /api/v1/projects/:id/layout-images/:imageId/regions - Bulk save pin positions
router.put(
  '/:id/layout-images/:imageId/regions',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_UPDATE, projectInScope()),
  validateRequestBody(ProjectLayoutRegionsSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = parseInt(req.params.id, 10);
      const imageId = parseInt(req.params.imageId, 10);
      const result = await ProjectService.upsertLayoutRegions(req.user!, projectId, imageId, req.body.regions);
      return res.status(200).json({
        message: `${result.saved} of ${result.total} region(s) saved successfully`,
        ...result,
      });
    } catch (error: any) {
      logger.error('Save layout regions error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to save layout regions' });
    }
  },
);

// DELETE /api/v1/projects/layout-regions/:regionId - Remove a single pin
// (no :id param on this route — resolve the owning project via the region's layout image)
const projectOfRegionInScope = () => async (req: AuthenticatedRequest) => {
  const regionId = parseInt(req.params.regionId, 10);
  const region = await p.propertyLayoutRegion.findUnique({
    where: { id: regionId },
    include: { layout_image: { select: { project_id: true } } },
  });
  if (!region) return null;
  const scope = await buildProjectScope(req.user!);
  return p.project.findFirst({ where: { id: region.layout_image.project_id, ...scope } });
};

router.delete(
  '/layout-regions/:regionId',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_UPDATE, projectOfRegionInScope()),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const regionId = parseInt(req.params.regionId, 10);
      const result = await ProjectService.deleteLayoutRegion(req.user!, regionId);
      return res.status(200).json(result);
    } catch (error: any) {
      logger.error('Delete layout region error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to delete layout region' });
    }
  },
);

// ─────────────────────────────────────────────────────────────
// Media, Documents, Activity
// ─────────────────────────────────────────────────────────────

// POST /api/v1/projects/:id/media - Upload a media file (cover/gallery/video/brochure/plans)
router.post(
  '/:id/media',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_UPDATE, projectInScope()),
  memoryUpload.single('file') as any,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = parseInt(req.params.id, 10);
      if (!req.file) return res.status(400).json({ error: 'No file provided' });
      const kind = req.body?.kind || 'GALLERY';
      const media = await ProjectService.uploadMedia(req.user!, projectId, req.file, kind, req.body?.title);
      return res.status(201).json({ message: 'Media uploaded successfully', media });
    } catch (error: any) {
      logger.error('Upload project media error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to upload media' });
    }
  },
);

// GET /api/v1/projects/:id/media
router.get(
  '/:id/media',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_READ),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = parseInt(req.params.id, 10);
      const media = await ProjectService.listMedia(req.user!, projectId);
      return res.status(200).json({ media });
    } catch (error: any) {
      logger.error('List project media error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to fetch media' });
    }
  },
);

// DELETE /api/v1/projects/:id/media/:mediaId
router.delete(
  '/:id/media/:mediaId',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_UPDATE, projectInScope()),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = parseInt(req.params.id, 10);
      const mediaId = parseInt(req.params.mediaId, 10);
      const result = await ProjectService.deleteMedia(req.user!, projectId, mediaId);
      return res.status(200).json(result);
    } catch (error: any) {
      logger.error('Delete project media error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to delete media' });
    }
  },
);

// POST /api/v1/projects/:id/documents - Upload a document (RERA/approval/legal/other)
router.post(
  '/:id/documents',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_UPDATE, projectInScope()),
  memoryUpload.single('file') as any,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = parseInt(req.params.id, 10);
      if (!req.file) return res.status(400).json({ error: 'No file provided' });
      const kind = req.body?.kind || 'OTHER';
      const doc = await ProjectService.uploadDocument(req.user!, projectId, req.file, kind, req.body?.title);
      return res.status(201).json({ message: 'Document uploaded successfully', document: doc });
    } catch (error: any) {
      logger.error('Upload project document error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to upload document' });
    }
  },
);

// GET /api/v1/projects/:id/documents
router.get(
  '/:id/documents',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_READ),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = parseInt(req.params.id, 10);
      const documents = await ProjectService.listDocuments(req.user!, projectId);
      return res.status(200).json({ documents });
    } catch (error: any) {
      logger.error('List project documents error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to fetch documents' });
    }
  },
);

// DELETE /api/v1/projects/:id/documents/:documentId
router.delete(
  '/:id/documents/:documentId',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_UPDATE, projectInScope()),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = parseInt(req.params.id, 10);
      const documentId = parseInt(req.params.documentId, 10);
      const result = await ProjectService.deleteDocument(req.user!, projectId, documentId);
      return res.status(200).json(result);
    } catch (error: any) {
      logger.error('Delete project document error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to delete document' });
    }
  },
);

// GET /api/v1/projects/:id/activity
router.get(
  '/:id/activity',
  authenticateToken,
  requireAuthz(Permissions.PROJECTS_READ),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = parseInt(req.params.id, 10);
      const events = await ProjectService.listActivity(req.user!, projectId);
      return res.status(200).json({ events });
    } catch (error: any) {
      logger.error('List project activity error:', error);
      if (error.status) return res.status(error.status).json({ error: error.message });
      return res.status(500).json({ error: 'Failed to fetch activity' });
    }
  },
);

export default router;
