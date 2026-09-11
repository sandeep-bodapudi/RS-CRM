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
// POST /api/v1/properties/:id/confirm-location - PM confirms on-site location details are accurate
// This is a prerequisite for the verify action — setting this flag is a distinct, explicit PM decision.
router.post('/:id/confirm-location', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROPERTIES_VERIFY), (0, validate_1.validateRequestBody)(shared_1.EmptyBodySchema), async (req, res, next) => {
    try {
        const propertyId = parseInt(req.params.id, 10);
        if (isNaN(propertyId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        const result = await property_service_1.PropertyService.confirmLocationByPM(req.user, propertyId);
        return res.status(200).json({
            message: `Location confirmed for property ${result.property_code}`,
            property: result,
        });
    }
    catch (error) {
        logger_1.logger.error('Confirm location error:', error);
        if (error.status)
            return next(error);
        return res.status(500).json({ error: 'Failed to confirm location' });
    }
});
// POST /api/v1/properties/:id/verify - PM On-Site Verification Step
router.post('/:id/verify', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROPERTIES_VERIFY), (0, validate_1.validateRequestBody)(shared_1.PropertyVerificationSchema), async (req, res, next) => {
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
        const updated = await property_service_1.PropertyService.verifyProperty(req.user, propertyId, req.body);
        return res.status(200).json({
            message: `Property ${updated.property_code} verification updated to ${updated.status}`,
            property: updated,
        });
    }
    catch (error) {
        logger_1.logger.error('PM Verify error:', error);
        if (error.status) {
            return next(error);
        }
        return res.status(500).json({ error: 'Failed to execute PM verification step' });
    }
});
// POST /api/v1/properties/:id/dm-polish - Digital Marketing Polish & SEO Tagging Step
router.post('/:id/dm-polish', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROPERTIES_DM_POLISH), (0, validate_1.validateRequestBody)(shared_1.PropertyDMUpdateSchema), async (req, res, next) => {
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
        const updated = await property_service_1.PropertyService.dmPolishProperty(req.user, propertyId, req.body);
        return res.status(200).json({
            message: `Property ${updated.property_code} polished by DM team and submitted for MD Approval`,
            property: updated,
        });
    }
    catch (error) {
        logger_1.logger.error('DM Polish error:', error);
        if (error.status) {
            return next(error);
        }
        return res.status(500).json({ error: 'Failed to execute DM polish step' });
    }
});
// POST /api/v1/properties/:id/dm-verify-as-is - Digital Marketing Head "Verified As-Is" bypass
// Skips polish assignment and advances directly to PENDING_MD_APPROVAL.
// Uses same PROPERTIES_DM_POLISH permission gate as the standard polish path.
router.post('/:id/dm-verify-as-is', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROPERTIES_DM_POLISH), (0, validate_1.validateRequestBody)(shared_1.PropertyDMVerifyAsIsSchema), async (req, res, next) => {
    try {
        const propertyId = parseInt(req.params.id, 10);
        if (isNaN(propertyId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        const updated = await property_service_1.PropertyService.dmVerifyAsIsProperty(req.user, propertyId, req.body);
        return res.status(200).json({
            message: `Property ${updated.property_code} verified as-is by DM Head and submitted for MD Approval`,
            property: updated,
        });
    }
    catch (error) {
        logger_1.logger.error('DM Verify As-Is error:', error);
        if (error.status) {
            return next(error);
        }
        return res.status(500).json({ error: 'Failed to execute DM verify-as-is step' });
    }
});
// POST /api/v1/properties/:id/md-approve - MD Final Approval Step (Go Live)
router.post('/:id/md-approve', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROPERTIES_MD_APPROVE), (0, validate_1.validateRequestBody)(shared_1.PropertyMDApprovalSchema), async (req, res, next) => {
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
        const updated = await property_service_1.PropertyService.mdApproveProperty(req.user, propertyId, req.body);
        return res.status(200).json({
            message: `Property ${updated.property_code} is now ${updated.status}`,
            property: updated,
        });
    }
    catch (error) {
        logger_1.logger.error('MD Approve error:', error);
        if (error.status) {
            return next(error);
        }
        return res.status(500).json({ error: 'Failed to execute MD approval step' });
    }
});
// POST /api/v1/properties/:id/resubmit - PM resubmits a REJECTED property back into the pipeline
router.post('/:id/resubmit', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.PROPERTIES_VERIFY), (0, validate_1.validateRequestBody)(shared_1.PropertyResubmitSchema), async (req, res, next) => {
    try {
        const propertyId = parseInt(req.params.id, 10);
        if (isNaN(propertyId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        const updated = await property_service_1.PropertyService.resubmitProperty(req.user, propertyId, req.body);
        return res.status(200).json({
            message: `Property ${updated.property_code} resubmitted and is now ${updated.status}`,
            property: updated,
        });
    }
    catch (error) {
        logger_1.logger.error('Property resubmit error:', error);
        if (error.status) {
            return next(error);
        }
        return res.status(500).json({ error: 'Failed to resubmit property' });
    }
});
exports.default = router;
