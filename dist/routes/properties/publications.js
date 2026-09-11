"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("../../utils/logger");
const express_1 = require("express");
const auth_1 = require("../../middleware/auth");
const authz_1 = require("../../middleware/authz");
const shared_1 = require("../../shared");
const validate_1 = require("../../middleware/validate");
const property_service_1 = require("../../services/property.service");
const router = (0, express_1.Router)();
// POST /api/v1/properties/:id/publications - Toggle publication for a brand
router.post('/:id/publications', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROPERTIES_UPDATE), (0, validate_1.validateRequestBody)(shared_1.PropertyTogglePublicationBodySchema), async (req, res, next) => {
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
        const publication = await property_service_1.PropertyService.togglePublication(req.user, propertyId, company_id, is_published);
        return res.status(200).json({
            message: `Property ${is_published ? 'published' : 'unpublished'} successfully`,
            publication,
        });
    }
    catch (error) {
        logger_1.logger.error('Toggle publication error:', error);
        if (error.status) {
            return next(error);
        }
        return res.status(500).json({ error: 'Failed to toggle publication' });
    }
});
// GET /api/v1/properties/:id/publications - List publications for a property
router.get('/:id/publications', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROPERTIES_READ), async (req, res, next) => {
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
        const publications = await property_service_1.PropertyService.getPublications(req.user, propertyId);
        return res.status(200).json({ publications });
    }
    catch (error) {
        logger_1.logger.error('Get publications error:', error);
        if (error.status) {
            return next(error);
        }
        return res.status(500).json({ error: 'Failed to fetch publications' });
    }
});
exports.default = router;
