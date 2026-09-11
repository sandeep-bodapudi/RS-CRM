"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("../../utils/logger");
const prisma_1 = require("../../lib/prisma");
const express_1 = require("express");
const auth_1 = require("../../middleware/auth");
const authz_1 = require("../../middleware/authz");
const shared_1 = require("../../shared");
const validate_1 = require("../../middleware/validate");
const storage_service_1 = require("../../services/storage.service");
const router = (0, express_1.Router)();
const p = prisma_1.prisma;
// POST /api/v1/properties/:id/images - Upload property image
router.post('/:id/images', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROPERTIES_UPDATE), storage_service_1.propertyImageUpload.single('image'), (0, validate_1.validateRequestBody)(shared_1.PropertyImageMetadataSchema), async (req, res, next) => {
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
        const companyId = req.user.companyId;
        // Verify property exists and belongs to company
        const property = await p.property.findFirst({
            where: { id: propertyId, company_id: companyId },
        });
        if (!property) {
            return res.status(404).json({ error: 'Property not found or unauthorized' });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided' });
        }
        const storage = (0, storage_service_1.getPropertyImageStorage)();
        const imageUrl = await storage.upload(req.file.buffer, propertyId);
        const { alt_text, sort_order, is_primary } = req.body;
        const isPrimaryBool = is_primary === 'true' || is_primary === true;
        let image;
        await p.$transaction(async (tx) => {
            if (isPrimaryBool) {
                await tx.propertyImage.updateMany({
                    where: { property_id: propertyId, is_primary: true },
                    data: { is_primary: false },
                });
            }
            image = await tx.propertyImage.create({
                data: {
                    property_id: propertyId,
                    image_url: imageUrl,
                    is_primary: isPrimaryBool,
                    uploaded_by_id: req.user.employeeId,
                    sort_order: sort_order ? parseInt(sort_order, 10) : 0,
                    alt_text: alt_text || null,
                    status: 'PENDING',
                },
            });
        });
        return res.status(201).json({ message: 'Image uploaded successfully', image });
    }
    catch (error) {
        logger_1.logger.error('Upload property image error:', error);
        if (error.status) {
            return next(error);
        }
        return res.status(500).json({ error: 'Failed to upload image' });
    }
});
// PUT /api/v1/properties/:id/images/:imageId - Update image metadata
router.put('/:id/images/:imageId', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROPERTIES_UPDATE), (0, validate_1.validateRequestBody)(shared_1.PropertyImageMetadataSchema), async (req, res, next) => {
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
        const imageId = parseInt(req.params.imageId, 10);
        if (isNaN(imageId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        if (isNaN(imageId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        if (isNaN(imageId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        if (isNaN(imageId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        const companyId = req.user.companyId;
        // Verify property belongs to company
        const property = await p.property.findFirst({
            where: { id: propertyId, company_id: companyId },
        });
        if (!property) {
            return res.status(404).json({ error: 'Property not found or unauthorized' });
        }
        // Verify image belongs to property
        const image = await p.propertyImage.findFirst({
            where: { id: imageId, property_id: propertyId },
        });
        if (!image) {
            return res.status(404).json({ error: 'Image not found' });
        }
        const { alt_text, sort_order, is_primary } = req.body;
        const updateData = {};
        if (alt_text !== undefined)
            updateData.alt_text = alt_text || null;
        if (sort_order !== undefined)
            updateData.sort_order = parseInt(sort_order, 10);
        const isPrimaryBool = is_primary === 'true' || is_primary === true;
        if (is_primary !== undefined)
            updateData.is_primary = isPrimaryBool;
        let updated;
        await p.$transaction(async (tx) => {
            if (is_primary !== undefined && isPrimaryBool) {
                await tx.propertyImage.updateMany({
                    where: { property_id: propertyId, is_primary: true },
                    data: { is_primary: false },
                });
            }
            updated = await tx.propertyImage.update({
                where: { id: imageId },
                data: updateData,
            });
        });
        return res.status(200).json({ message: 'Image updated successfully', image: updated });
    }
    catch (error) {
        logger_1.logger.error('Update property image error:', error);
        if (error.status) {
            return next(error);
        }
        return res.status(500).json({ error: 'Failed to update image' });
    }
});
// DELETE /api/v1/properties/:id/images/:imageId - Delete property image
router.delete('/:id/images/:imageId', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROPERTIES_UPDATE), (0, validate_1.validateRequestBody)(shared_1.EmptyBodySchema), async (req, res, next) => {
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
        const imageId = parseInt(req.params.imageId, 10);
        if (isNaN(imageId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        if (isNaN(imageId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        if (isNaN(imageId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        if (isNaN(imageId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        const companyId = req.user.companyId;
        // Verify property belongs to company
        const property = await p.property.findFirst({
            where: { id: propertyId, company_id: companyId },
        });
        if (!property) {
            return res.status(404).json({ error: 'Property not found or unauthorized' });
        }
        // Verify image belongs to property
        const image = await p.propertyImage.findFirst({
            where: { id: imageId, property_id: propertyId },
        });
        if (!image) {
            return res.status(404).json({ error: 'Image not found' });
        }
        // Delete file from disk securely
        const storage = (0, storage_service_1.getPropertyImageStorage)();
        await storage.delete(image.image_url);
        // Delete record and auto-promote next image if needed
        await p.$transaction(async (tx) => {
            await tx.propertyImage.delete({ where: { id: imageId } });
            // If the deleted image was the primary one, promote the next available image
            if (image.is_primary) {
                const nextImage = await tx.propertyImage.findFirst({
                    where: { property_id: propertyId },
                    orderBy: { sort_order: 'asc' },
                });
                if (nextImage) {
                    await tx.propertyImage.update({
                        where: { id: nextImage.id },
                        data: { is_primary: true },
                    });
                }
            }
        });
        return res.status(200).json({ message: 'Image deleted successfully' });
    }
    catch (error) {
        logger_1.logger.error('Delete property image error:', error);
        if (error.status) {
            return next(error);
        }
        return res.status(500).json({ error: 'Failed to delete image' });
    }
});
// POST /api/v1/properties/:id/images/:imageId/approve - Approve image
router.post('/:id/images/:imageId/approve', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROPERTIES_DM_POLISH), (0, validate_1.validateRequestBody)(shared_1.EmptyBodySchema), async (req, res, next) => {
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
        const imageId = parseInt(req.params.imageId, 10);
        if (isNaN(imageId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        if (isNaN(imageId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        if (isNaN(imageId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        if (isNaN(imageId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        const companyId = req.user.companyId;
        const image = await p.propertyImage.findFirst({
            where: {
                id: imageId,
                property_id: propertyId,
                property: { company_id: companyId },
            },
        });
        if (!image) {
            return res.status(404).json({ error: 'Image not found' });
        }
        const updated = await p.propertyImage.update({
            where: { id: imageId },
            data: { status: 'APPROVED' },
        });
        return res.status(200).json({ message: 'Image approved', image: updated });
    }
    catch (error) {
        logger_1.logger.error('Approve image error:', error);
        if (error.status) {
            return next(error);
        }
        return res.status(500).json({ error: 'Failed to approve image' });
    }
});
// POST /api/v1/properties/:id/images/:imageId/reject - Reject image
router.post('/:id/images/:imageId/reject', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROPERTIES_DM_POLISH), (0, validate_1.validateRequestBody)(shared_1.EmptyBodySchema), async (req, res, next) => {
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
        const imageId = parseInt(req.params.imageId, 10);
        if (isNaN(imageId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        if (isNaN(imageId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        if (isNaN(imageId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        if (isNaN(imageId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        const companyId = req.user.companyId;
        const image = await p.propertyImage.findFirst({
            where: {
                id: imageId,
                property_id: propertyId,
                property: { company_id: companyId },
            },
        });
        if (!image) {
            return res.status(404).json({ error: 'Image not found' });
        }
        const updated = await p.propertyImage.update({
            where: { id: imageId },
            data: { status: 'REJECTED' },
        });
        return res.status(200).json({ message: 'Image rejected', image: updated });
    }
    catch (error) {
        logger_1.logger.error('Reject image error:', error);
        if (error.status) {
            return next(error);
        }
        return res.status(500).json({ error: 'Failed to reject image' });
    }
});
exports.default = router;
