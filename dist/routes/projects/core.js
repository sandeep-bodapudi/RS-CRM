"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("../../utils/logger");
const express_1 = require("express");
const auth_1 = require("../../middleware/auth");
const authz_1 = require("../../middleware/authz");
const shared_1 = require("../../shared");
const validate_1 = require("../../middleware/validate");
const project_service_1 = require("../../services/project.service");
const storage_service_1 = require("../../services/storage.service");
const prisma_1 = require("../../lib/prisma");
const dataScope_1 = require("../../authz/dataScope");
const router = (0, express_1.Router)();
const p = prisma_1.prisma;
// PROJECTS_UPDATE has no "!resource => true" fallback in the can() engine
// (see authz/authorization.ts) — it requires a resource to evaluate
// ProjectPolicy.canUpdate's company/PM-assignment checks, so every
// PROJECTS_UPDATE-gated route below must pass this as requireAuthz's second
// argument or every non-Admin caller is denied regardless of permissions.
const projectInScope = () => async (req) => {
    const projectId = parseInt(req.params.id, 10);
    const scope = await (0, dataScope_1.buildProjectScope)(req.user);
    return p.project.findFirst({ where: { id: projectId, ...scope } });
};
// GET /api/v1/projects - List projects
router.get('/', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROJECTS_READ), async (req, res) => {
    try {
        const { status } = req.query;
        const filters = {
            status: typeof status === 'string' ? status : undefined,
        };
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100);
        const offset = Math.max(parseInt(req.query.offset) || 0, 0);
        const projects = await project_service_1.ProjectService.listProjects(req.user, filters, limit, offset);
        return res.status(200).json({ projects, pagination: { limit, offset } });
    }
    catch (error) {
        logger_1.logger.error('Fetch projects error:', error);
        if (error.status) {
            return res.status(error.status).json({ error: error.message });
        }
        return res.status(500).json({ error: 'Failed to fetch projects' });
    }
});
// GET /api/v1/projects/:id - Get single project
router.get('/:id', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROJECTS_READ, async (req) => {
    const projectId = parseInt(req.params.id, 10);
    return await p.project.findFirst({ where: { id: projectId } });
}), async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const project = await project_service_1.ProjectService.getProject(req.user, projectId);
        return res.status(200).json({ project });
    }
    catch (error) {
        logger_1.logger.error('Fetch project error:', error);
        if (error.status) {
            return res.status(error.status).json({ error: error.message });
        }
        return res.status(500).json({ error: 'Failed to fetch project' });
    }
});
// POST /api/v1/projects - Create Project
router.post('/', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROJECTS_CREATE), (0, validate_1.validateRequestBody)(shared_1.ProjectCreateSchema), async (req, res) => {
    try {
        const project = await project_service_1.ProjectService.createProject(req.user, req.body);
        return res.status(201).json({
            message: 'Project created successfully',
            project,
        });
    }
    catch (error) {
        logger_1.logger.error('Create project error:', error);
        if (error.status) {
            return res.status(error.status).json({ error: error.message });
        }
        return res.status(500).json({ error: 'Failed to create project' });
    }
});
// PUT /api/v1/projects/:id - Update Project
router.put('/:id', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROJECTS_UPDATE, async (req) => {
    const projectId = parseInt(req.params.id, 10);
    // Use scoped query so out-of-scope projects return 404 (not 403), consistent with GET
    const scope = await (0, dataScope_1.buildProjectScope)(req.user);
    try {
        return await p.project.findFirst({ where: { id: projectId, ...scope } });
    }
    catch (e) {
        logger_1.logger.error('Prisma validation error payload:', e.message);
        throw e;
    }
}), (0, validate_1.validateRequestBody)(shared_1.ProjectUpdateSchema), async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const project = await project_service_1.ProjectService.updateProject(req.user, projectId, req.body);
        return res.status(200).json({
            message: 'Project updated successfully',
            project,
        });
    }
    catch (error) {
        logger_1.logger.error('Update project error:', error);
        if (error.status) {
            return res.status(error.status).json({ error: error.message });
        }
        return res.status(500).json({ error: 'Failed to update project' });
    }
});
// DELETE /api/v1/projects/:id - Delete Project (Status transition)
router.delete('/:id', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROJECTS_DELETE, async (req) => {
    const projectId = parseInt(req.params.id, 10);
    // Use scoped query so out-of-scope projects return 404 (not 403), consistent with GET
    const scope = await (0, dataScope_1.buildProjectScope)(req.user);
    try {
        return await p.project.findFirst({ where: { id: projectId, ...scope } });
    }
    catch (e) {
        logger_1.logger.error('Prisma validation error payload DELETE:', e.message);
        throw e;
    }
}), async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const project = await project_service_1.ProjectService.deleteProject(req.user, projectId);
        return res.status(200).json({
            message: 'Project deleted successfully',
            project,
        });
    }
    catch (error) {
        logger_1.logger.error('Delete project error:', error);
        if (error.status) {
            return res.status(error.status).json({ error: error.message });
        }
        return res.status(500).json({ error: 'Failed to delete project' });
    }
});
// POST /api/v1/projects/:id/reassign - Reassign a project's PM, as a distinct
// reasoned action (mandatory reason, dedicated REASSIGNMENT audit entry) —
// separate from the general edit form, which already lets assigned_pm_id
// change freely with no reason/audit trail (Phase 2.7).
router.post('/:id/reassign', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROJECTS_UPDATE, async (req) => {
    const projectId = parseInt(req.params.id, 10);
    const scope = await (0, dataScope_1.buildProjectScope)(req.user);
    return await p.project.findFirst({ where: { id: projectId, ...scope } });
}), (0, validate_1.validateRequestBody)(shared_1.ProjectReassignSchema), async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const { new_pm_id, reason } = req.body;
        const project = await project_service_1.ProjectService.reassignProject(req.user, projectId, new_pm_id, reason);
        return res.status(200).json({
            message: 'Project reassigned successfully',
            project,
        });
    }
    catch (error) {
        logger_1.logger.error('Reassign project error:', error);
        if (error.status) {
            return res.status(error.status).json({ error: error.message });
        }
        return res.status(500).json({ error: 'Failed to reassign project' });
    }
});
// ─────────────────────────────────────────────────────────────
// Project Verification Workflow
// ─────────────────────────────────────────────────────────────
// POST /api/v1/projects/:id/submit-for-review
// PM submits their project for MD review (DRAFT|REJECTED → PENDING_VERIFICATION)
router.post('/:id/submit-for-review', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROJECTS_SUBMIT_VERIFY, projectInScope()), async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        if (isNaN(projectId))
            return res.status(400).json({ error: 'Invalid ID' });
        const project = await p.project.findFirst({ where: { id: projectId } });
        if (!project)
            return res.status(404).json({ error: 'Project not found' });
        if (!['DRAFT', 'REJECTED'].includes(project.status)) {
            return res
                .status(400)
                .json({ error: `Cannot submit: project is already ${project.status}` });
        }
        const updated = await p.project.update({
            where: { id: projectId },
            data: {
                status: 'PENDING_VERIFICATION',
                verified_by_id: null,
                verified_at: null,
                verification_notes: null,
            },
        });
        logger_1.logger.info(`Project ${projectId} submitted for review by employee ${req.user.employeeId}`);
        return res
            .status(200)
            .json({ message: 'Project submitted for MD review.', project: updated });
    }
    catch (error) {
        logger_1.logger.error('Submit project for review error:', error);
        return res.status(500).json({ error: 'Failed to submit project for review' });
    }
});
// POST /api/v1/projects/:id/verify
// MD approves or rejects: body { action: 'APPROVE' | 'REJECT', notes?: string }
router.post('/:id/verify', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROJECTS_VERIFY), async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        if (isNaN(projectId))
            return res.status(400).json({ error: 'Invalid ID' });
        const { action, notes } = req.body;
        if (!['APPROVE', 'REJECT'].includes(action)) {
            return res.status(400).json({ error: 'action must be APPROVE or REJECT' });
        }
        const project = await p.project.findFirst({ where: { id: projectId } });
        if (!project)
            return res.status(404).json({ error: 'Project not found' });
        if (project.status !== 'PENDING_VERIFICATION') {
            return res
                .status(400)
                .json({ error: `Project is not pending verification (current: ${project.status})` });
        }
        const newStatus = action === 'APPROVE' ? 'VERIFIED' : 'REJECTED';
        const updated = await p.project.update({
            where: { id: projectId },
            data: {
                status: newStatus,
                verified_by_id: req.user.employeeId,
                verified_at: new Date(),
                verification_notes: notes || null,
            },
        });
        logger_1.logger.info(`Project ${projectId} ${newStatus} by MD employee ${req.user.employeeId}`);
        const msg = action === 'APPROVE'
            ? `Project "${project.name}" approved and is now visible to all staff.`
            : `Project "${project.name}" rejected. The PM has been informed.`;
        return res.status(200).json({ message: msg, project: updated });
    }
    catch (error) {
        logger_1.logger.error('Verify project error:', error);
        return res.status(500).json({ error: 'Failed to verify project' });
    }
});
// ─────────────────────────────────────────────────────────────
// Phase 2.23: Layout images & unit-position regions
// ─────────────────────────────────────────────────────────────
// POST /api/v1/projects/:id/layout-images - Upload a layout/site-plan image
router.post('/:id/layout-images', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROJECTS_UPDATE, projectInScope()), storage_service_1.memoryUpload.single('image'), async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided' });
        }
        const image = await project_service_1.ProjectService.uploadLayoutImage(req.user, projectId, req.file, req.body?.title);
        return res.status(201).json({ message: 'Layout image uploaded successfully', image });
    }
    catch (error) {
        logger_1.logger.error('Upload layout image error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to upload layout image' });
    }
});
// GET /api/v1/projects/:id/layout-images - List layout images with pins + unit summaries
router.get('/:id/layout-images', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROJECTS_READ), async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const images = await project_service_1.ProjectService.listLayoutImages(req.user, projectId);
        return res.status(200).json({ images });
    }
    catch (error) {
        logger_1.logger.error('List layout images error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to fetch layout images' });
    }
});
// DELETE /api/v1/projects/:id/layout-images/:imageId
router.delete('/:id/layout-images/:imageId', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROJECTS_UPDATE, projectInScope()), async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const imageId = parseInt(req.params.imageId, 10);
        const result = await project_service_1.ProjectService.deleteLayoutImage(req.user, projectId, imageId);
        return res.status(200).json(result);
    }
    catch (error) {
        logger_1.logger.error('Delete layout image error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to delete layout image' });
    }
});
// PUT /api/v1/projects/:id/layout-images/:imageId/regions - Bulk save pin positions
router.put('/:id/layout-images/:imageId/regions', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROJECTS_UPDATE, projectInScope()), (0, validate_1.validateRequestBody)(shared_1.ProjectLayoutRegionsSchema), async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const imageId = parseInt(req.params.imageId, 10);
        const result = await project_service_1.ProjectService.upsertLayoutRegions(req.user, projectId, imageId, req.body.regions);
        return res.status(200).json({
            message: `${result.saved} of ${result.total} region(s) saved successfully`,
            ...result,
        });
    }
    catch (error) {
        logger_1.logger.error('Save layout regions error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to save layout regions' });
    }
});
// DELETE /api/v1/projects/layout-regions/:regionId - Remove a single pin
// (no :id param on this route — resolve the owning project via the region's layout image)
const projectOfRegionInScope = () => async (req) => {
    const regionId = parseInt(req.params.regionId, 10);
    const region = await p.propertyLayoutRegion.findUnique({
        where: { id: regionId },
        include: { layout_image: { select: { project_id: true } } },
    });
    if (!region)
        return null;
    const scope = await (0, dataScope_1.buildProjectScope)(req.user);
    return p.project.findFirst({ where: { id: region.layout_image.project_id, ...scope } });
};
router.delete('/layout-regions/:regionId', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROJECTS_UPDATE, projectOfRegionInScope()), async (req, res) => {
    try {
        const regionId = parseInt(req.params.regionId, 10);
        const result = await project_service_1.ProjectService.deleteLayoutRegion(req.user, regionId);
        return res.status(200).json(result);
    }
    catch (error) {
        logger_1.logger.error('Delete layout region error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to delete layout region' });
    }
});
// ─────────────────────────────────────────────────────────────
// Media, Documents, Activity
// ─────────────────────────────────────────────────────────────
// POST /api/v1/projects/:id/media - Upload a media file (cover/gallery/video/brochure/plans)
router.post('/:id/media', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROJECTS_UPDATE, projectInScope()), storage_service_1.memoryUpload.single('file'), async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        if (!req.file)
            return res.status(400).json({ error: 'No file provided' });
        const kind = req.body?.kind || 'GALLERY';
        const media = await project_service_1.ProjectService.uploadMedia(req.user, projectId, req.file, kind, req.body?.title);
        return res.status(201).json({ message: 'Media uploaded successfully', media });
    }
    catch (error) {
        logger_1.logger.error('Upload project media error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to upload media' });
    }
});
// GET /api/v1/projects/:id/media
router.get('/:id/media', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROJECTS_READ), async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const media = await project_service_1.ProjectService.listMedia(req.user, projectId);
        return res.status(200).json({ media });
    }
    catch (error) {
        logger_1.logger.error('List project media error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to fetch media' });
    }
});
// DELETE /api/v1/projects/:id/media/:mediaId
router.delete('/:id/media/:mediaId', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROJECTS_UPDATE, projectInScope()), async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const mediaId = parseInt(req.params.mediaId, 10);
        const result = await project_service_1.ProjectService.deleteMedia(req.user, projectId, mediaId);
        return res.status(200).json(result);
    }
    catch (error) {
        logger_1.logger.error('Delete project media error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to delete media' });
    }
});
// POST /api/v1/projects/:id/documents - Upload a document (RERA/approval/legal/other)
router.post('/:id/documents', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROJECTS_UPDATE, projectInScope()), storage_service_1.memoryUpload.single('file'), async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        if (!req.file)
            return res.status(400).json({ error: 'No file provided' });
        const kind = req.body?.kind || 'OTHER';
        const doc = await project_service_1.ProjectService.uploadDocument(req.user, projectId, req.file, kind, req.body?.title);
        return res.status(201).json({ message: 'Document uploaded successfully', document: doc });
    }
    catch (error) {
        logger_1.logger.error('Upload project document error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to upload document' });
    }
});
// GET /api/v1/projects/:id/documents
router.get('/:id/documents', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROJECTS_READ), async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const documents = await project_service_1.ProjectService.listDocuments(req.user, projectId);
        return res.status(200).json({ documents });
    }
    catch (error) {
        logger_1.logger.error('List project documents error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to fetch documents' });
    }
});
// DELETE /api/v1/projects/:id/documents/:documentId
router.delete('/:id/documents/:documentId', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROJECTS_UPDATE, projectInScope()), async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const documentId = parseInt(req.params.documentId, 10);
        const result = await project_service_1.ProjectService.deleteDocument(req.user, projectId, documentId);
        return res.status(200).json(result);
    }
    catch (error) {
        logger_1.logger.error('Delete project document error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to delete document' });
    }
});
// GET /api/v1/projects/:id/activity
router.get('/:id/activity', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROJECTS_READ), async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const events = await project_service_1.ProjectService.listActivity(req.user, projectId);
        return res.status(200).json({ events });
    }
    catch (error) {
        logger_1.logger.error('List project activity error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to fetch activity' });
    }
});
exports.default = router;
