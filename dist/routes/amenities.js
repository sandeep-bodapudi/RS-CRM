"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Company-wide amenity catalog — mounted at /api/v1/amenities. Distinct from
// routes/projects/amenities.ts, which manages one project's configuration of
// these catalog entries. See services/amenity.service.ts's doc comment for
// why write routes here don't use requireAuthz(PROJECTS_UPDATE): that policy
// requires a project resource to evaluate and always denies without one, so
// catalog writes are gated in the service layer instead (hasCatalogAccess).
const express_1 = require("express");
const logger_1 = require("../utils/logger");
const auth_1 = require("../middleware/auth");
const authz_1 = require("../middleware/authz");
const validate_1 = require("../middleware/validate");
const shared_1 = require("../shared");
const amenity_service_1 = require("../services/amenity.service");
const router = (0, express_1.Router)();
router.get('/', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROJECTS_READ), async (req, res) => {
    try {
        const amenities = await amenity_service_1.AmenityService.listCatalog(req.user);
        return res.status(200).json({ amenities });
    }
    catch (error) {
        logger_1.logger.error('List amenity catalog error:', error);
        return res.status(500).json({ error: 'Failed to fetch amenity catalog' });
    }
});
router.post('/', auth_1.authenticateToken, (0, validate_1.validateRequestBody)(shared_1.AmenityCreateSchema), async (req, res) => {
    try {
        const amenity = await amenity_service_1.AmenityService.createCatalogAmenity(req.user, req.body);
        return res.status(201).json({ message: 'Amenity added to catalog', amenity });
    }
    catch (error) {
        logger_1.logger.error('Create catalog amenity error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to create amenity' });
    }
});
router.put('/:amenityId', auth_1.authenticateToken, (0, validate_1.validateRequestBody)(shared_1.AmenityUpdateSchema), async (req, res) => {
    try {
        const amenityId = parseInt(req.params.amenityId, 10);
        const amenity = await amenity_service_1.AmenityService.updateCatalogAmenity(req.user, amenityId, req.body);
        return res.status(200).json({ message: 'Amenity updated', amenity });
    }
    catch (error) {
        logger_1.logger.error('Update catalog amenity error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to update amenity' });
    }
});
router.delete('/:amenityId', auth_1.authenticateToken, async (req, res) => {
    try {
        const amenityId = parseInt(req.params.amenityId, 10);
        const result = await amenity_service_1.AmenityService.deleteCatalogAmenity(req.user, amenityId);
        return res.status(200).json(result);
    }
    catch (error) {
        logger_1.logger.error('Delete catalog amenity error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to delete amenity' });
    }
});
exports.default = router;
