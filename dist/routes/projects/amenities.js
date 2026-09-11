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
const amenity_service_1 = require("../../services/amenity.service");
const router = (0, express_1.Router)();
const p = prisma_1.prisma;
const projectInScope = () => async (req) => {
    const projectId = parseInt(req.params.id, 10);
    const scope = await (0, dataScope_1.buildProjectScope)(req.user);
    return p.project.findFirst({ where: { id: projectId, ...scope } });
};
// GET /api/v1/projects/:id/amenities
router.get('/:id/amenities', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROJECTS_READ, projectInScope()), async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const amenities = await amenity_service_1.AmenityService.listProjectAmenities(req.user, projectId);
        return res.status(200).json({ amenities });
    }
    catch (error) {
        logger_1.logger.error('List project amenities error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to fetch project amenities' });
    }
});
// PUT /api/v1/projects/:id/amenities/:amenityId - upsert this project's
// configuration of one catalog amenity (Included/Optional/Chargeable, etc).
router.put('/:id/amenities/:amenityId', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROJECTS_UPDATE, projectInScope()), (0, validate_1.validateRequestBody)(shared_1.ProjectAmenityUpsertSchema), async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const amenityId = parseInt(req.params.amenityId, 10);
        const projectAmenity = await amenity_service_1.AmenityService.setProjectAmenity(req.user, projectId, amenityId, req.body);
        return res
            .status(200)
            .json({ message: 'Amenity configuration saved', amenity: projectAmenity });
    }
    catch (error) {
        logger_1.logger.error('Set project amenity error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to save amenity configuration' });
    }
});
// DELETE /api/v1/projects/:id/amenities/:amenityId - drop this project's
// configuration of a catalog amenity entirely (it stays in the catalog).
router.delete('/:id/amenities/:amenityId', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROJECTS_UPDATE, projectInScope()), async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const amenityId = parseInt(req.params.amenityId, 10);
        const result = await amenity_service_1.AmenityService.removeProjectAmenity(req.user, projectId, amenityId);
        return res.status(200).json(result);
    }
    catch (error) {
        logger_1.logger.error('Remove project amenity error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to remove amenity' });
    }
});
exports.default = router;
