"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("../../utils/logger");
const express_1 = require("express");
const auth_1 = require("../../middleware/auth");
const authz_1 = require("../../middleware/authz");
const shared_1 = require("../../shared");
const validate_1 = require("../../middleware/validate");
const property_service_1 = require("../../services/property.service");
const prisma_1 = require("../../lib/prisma");
const dataScope_1 = require("../../authz/dataScope");
const router = (0, express_1.Router)();
// GET /api/v1/properties - List properties with brand and status filtering
router.get('/', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROPERTIES_READ), async (req, res, next) => {
    try {
        const { brand, category, status, sales_status, project_id, unassigned, dm_executive_id } = req.query;
        const filters = {
            brand: typeof brand === 'string' ? brand : undefined,
            category: typeof category === 'string' ? category : undefined,
            status: typeof status === 'string' ? status : undefined,
            sales_status: typeof sales_status === 'string' ? sales_status : undefined,
            project_id: typeof project_id === 'string' ? parseInt(project_id, 10) : undefined,
            unassigned: unassigned === 'true',
            dm_executive_id: typeof dm_executive_id === 'string' ? parseInt(dm_executive_id, 10) : undefined,
        };
        // DM Executives automatically see only their own assigned-to-polish properties
        const userRoles = req.user?.roles || [];
        const isDMExecutiveOnly = userRoles.includes('digital marketing executive') &&
            !userRoles.some((r) => ['Digital Marketing head(manager)', 'Marketing Director', 'md', 'admin'].includes(r));
        if (isDMExecutiveOnly && !filters.dm_executive_id) {
            filters.dm_executive_id = req.user.employeeId;
        }
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
        const offset = Math.max(parseInt(req.query.offset) || 0, 0);
        const properties = await property_service_1.PropertyService.listProperties(req.user, filters, limit, offset);
        return res.status(200).json({ properties, pagination: { limit, offset } });
    }
    catch (error) {
        logger_1.logger.error('Fetch properties error:', error);
        if (error.status) {
            return next(error);
        }
        return res.status(500).json({ error: 'Failed to fetch properties' });
    }
});
// GET /api/v1/properties/:id - Fetch a single property (was missing entirely;
// the frontend worked around it by hitting the list endpoint with ?project_id=).
router.get('/:id', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROPERTIES_READ), async (req, res, next) => {
    try {
        const propertyId = parseInt(req.params.id, 10);
        if (isNaN(propertyId)) {
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        }
        const property = await property_service_1.PropertyService.getProperty(req.user, propertyId);
        return res.status(200).json({ property });
    }
    catch (error) {
        logger_1.logger.error('Fetch property error:', error);
        if (error.status) {
            return next(error);
        }
        return res.status(500).json({ error: 'Failed to fetch property' });
    }
});
// POST /api/v1/properties - Create Property Listing
router.post('/', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROPERTIES_CREATE), (0, validate_1.validateRequestBody)(shared_1.PropertyCreateSchema), async (req, res, next) => {
    try {
        const property = await property_service_1.PropertyService.createProperty(req.user, req.body);
        return res.status(201).json({
            message: 'Property listing created and submitted for PM On-Site Verification',
            property,
        });
    }
    catch (error) {
        logger_1.logger.error('Create property error:', error);
        if (error.status) {
            return next(error);
        }
        return res.status(500).json({ error: 'Failed to create property listing' });
    }
});
// PUT /api/v1/properties/:id - Update Property Listing
router.put('/:id', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROPERTIES_UPDATE), (0, validate_1.validateRequestBody)(shared_1.PropertyUpdateSchema), async (req, res, next) => {
    try {
        const propertyId = parseInt(req.params.id, 10);
        if (isNaN(propertyId)) {
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        }
        const property = await property_service_1.PropertyService.updateProperty(req.user, propertyId, req.body);
        return res.status(200).json({
            message: 'Property listing updated successfully',
            property,
        });
    }
    catch (error) {
        logger_1.logger.error('Update property error:', error);
        if (error.status) {
            return next(error);
        }
        return res.status(500).json({ error: 'Failed to update property listing' });
    }
});
// DELETE /api/v1/properties/:id - Archive (soft-delete) a property listing.
// Mirrors DELETE /api/v1/projects/:id's soft CANCELLED transition rather than
// a hard row delete, since Property is referenced by Lead/Booking/SiteVisit/etc.
router.delete('/:id', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROPERTIES_DELETE, async (req) => {
    const propertyId = parseInt(req.params.id, 10);
    const scope = await (0, dataScope_1.buildPropertyScope)(req.user);
    return await prisma_1.prisma.property.findFirst({ where: { id: propertyId, ...scope } });
}), async (req, res, next) => {
    try {
        const propertyId = parseInt(req.params.id, 10);
        if (isNaN(propertyId)) {
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        }
        const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
        const property = await property_service_1.PropertyService.archiveProperty(req.user, propertyId, reason);
        return res.status(200).json({ message: 'Property archived successfully', property });
    }
    catch (error) {
        logger_1.logger.error('Archive property error:', error);
        if (error.status) {
            return next(error);
        }
        return res.status(500).json({ error: 'Failed to archive property' });
    }
});
// POST /api/v1/properties/:id/reassign - Reassign a property's PM, as a distinct
// reasoned action (mandatory reason, dedicated REASSIGNMENT audit entry) —
// mirrors POST /api/v1/projects/:id/reassign. PropertyService.reassignProperty
// already existed but had no route calling it.
router.post('/:id/reassign', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROPERTIES_UPDATE, async (req) => {
    const propertyId = parseInt(req.params.id, 10);
    const scope = await (0, dataScope_1.buildPropertyScope)(req.user);
    return await prisma_1.prisma.property.findFirst({ where: { id: propertyId, ...scope } });
}), (0, validate_1.validateRequestBody)(shared_1.PropertyReassignSchema), async (req, res, next) => {
    try {
        const propertyId = parseInt(req.params.id, 10);
        const { new_pm_id, reason } = req.body;
        const property = await property_service_1.PropertyService.reassignProperty(req.user, propertyId, new_pm_id, reason);
        return res.status(200).json({ message: 'Property reassigned successfully', property });
    }
    catch (error) {
        logger_1.logger.error('Reassign property error:', error);
        if (error.status) {
            return next(error);
        }
        return res.status(500).json({ error: 'Failed to reassign property' });
    }
});
exports.default = router;
