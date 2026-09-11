"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("../../utils/logger");
const express_1 = require("express");
const prisma_1 = require("../../lib/prisma");
const auth_1 = require("../../middleware/auth");
const shared_1 = require("../../shared");
const crypto_1 = require("../../utils/crypto");
const media_1 = require("../../utils/media");
const validate_1 = require("../../middleware/validate");
const storage_service_1 = require("../../services/storage.service");
const router = (0, express_1.Router)();
const profileUpload = storage_service_1.memoryUpload;
// PATCH /api/v1/employees/me - Self-update for safe profile fields
router.patch('/me', auth_1.authenticateToken, (0, validate_1.validateRequestBody)(shared_1.EmployeeSelfUpdateSchema), async (req, res) => {
    try {
        const employeeId = req.user.employeeId;
        const { full_name, phone, secondary_phone, whatsapp_number, email, current_address, permanent_address, emergency_contact_name, emergency_contact_relation, emergency_contact_phone, blood_group, social_links, pan_number, aadhaar_number, bank_name, bank_account_number, bank_ifsc, bank_branch, } = req.body;
        const currentEmp = await prisma_1.prisma.employee.findUnique({
            where: { id: employeeId },
            select: { bank_account_number: true },
        });
        if (!currentEmp) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        const updateData = {};
        if (full_name !== undefined)
            updateData.full_name = full_name;
        if (phone !== undefined)
            updateData.phone = phone;
        if (secondary_phone !== undefined)
            updateData.secondary_phone = secondary_phone;
        if (whatsapp_number !== undefined)
            updateData.whatsapp_number = whatsapp_number;
        if (email !== undefined)
            updateData.email = email;
        if (current_address !== undefined)
            updateData.current_address = current_address;
        if (permanent_address !== undefined)
            updateData.permanent_address = permanent_address;
        if (emergency_contact_name !== undefined)
            updateData.emergency_contact_name = emergency_contact_name;
        if (emergency_contact_relation !== undefined)
            updateData.emergency_contact_relation = emergency_contact_relation;
        if (emergency_contact_phone !== undefined)
            updateData.emergency_contact_phone = emergency_contact_phone;
        if (blood_group !== undefined)
            updateData.blood_group = blood_group;
        if (social_links !== undefined)
            updateData.social_links = social_links;
        // KYC — encrypted at rest (Phase 1.4). Previously written as plaintext
        // here, bypassing encryptData() entirely even though the employee-create
        // path already encrypted these same fields.
        if (pan_number !== undefined)
            updateData.pan_number = (0, crypto_1.encryptData)(pan_number);
        if (aadhaar_number !== undefined)
            updateData.aadhaar_number = (0, crypto_1.encryptData)(aadhaar_number);
        // Bank Details (always allow updating now)
        if (bank_name !== undefined)
            updateData.bank_name = (0, crypto_1.encryptData)(bank_name);
        if (bank_account_number !== undefined)
            updateData.bank_account_number = (0, crypto_1.encryptData)(bank_account_number);
        if (bank_ifsc !== undefined)
            updateData.bank_ifsc = (0, crypto_1.encryptData)(bank_ifsc);
        if (bank_branch !== undefined)
            updateData.bank_branch = (0, crypto_1.encryptData)(bank_branch);
        const updatedEmp = await prisma_1.prisma.employee.update({
            where: { id: employeeId },
            data: updateData,
            select: {
                id: true,
                full_name: true,
                phone: true,
                secondary_phone: true,
                whatsapp_number: true,
                email: true,
                blood_group: true,
                social_links: true,
                current_address: true,
                permanent_address: true,
                emergency_contact_name: true,
                emergency_contact_relation: true,
                emergency_contact_phone: true,
                pan_number: true,
                aadhaar_number: true,
                bank_name: true,
                bank_account_number: true,
                bank_ifsc: true,
                bank_branch: true,
                profile_image_url: true,
            },
        });
        return res.status(200).json({
            message: 'Profile updated successfully',
            // Own profile — always safe to decrypt, no EMPLOYEES_VIEW_SENSITIVE
            // gate needed (you can always see your own KYC/bank details).
            employee: {
                ...updatedEmp,
                pan_number: (0, crypto_1.decryptData)(updatedEmp.pan_number),
                aadhaar_number: (0, crypto_1.decryptData)(updatedEmp.aadhaar_number),
                bank_name: (0, crypto_1.decryptData)(updatedEmp.bank_name),
                bank_account_number: (0, crypto_1.decryptData)(updatedEmp.bank_account_number),
                bank_ifsc: (0, crypto_1.decryptData)(updatedEmp.bank_ifsc),
                bank_branch: (0, crypto_1.decryptData)(updatedEmp.bank_branch),
            },
        });
    }
    catch (error) {
        logger_1.logger.error('Self update error:', error);
        return res.status(500).json({ error: 'Failed to update profile' });
    }
});
// POST /api/v1/employees/me/photo - Upload profile photo
// POST /api/v1/employees/me/photo - Upload profile photo
router.post('/me/photo', auth_1.authenticateToken, async (req, res) => {
    profileUpload.single('profile_image')(req, res, async (err) => {
        if (err) {
            logger_1.logger.error('Multer error:', err);
            return res.status(400).json({ error: err.message || 'File upload failed' });
        }
        try {
            const file = req.file;
            if (!file) {
                return res.status(400).json({ error: 'No image file provided.' });
            }
            const employeeId = req.user.employeeId;
            const emp = await prisma_1.prisma.employee.findUnique({
                where: { id: employeeId },
                select: { profile_image_url: true },
            });
            const storageService = (0, storage_service_1.getStorageService)('profiles');
            const newImageUrl = await storageService.upload(file.buffer, file.originalname, file.mimetype);
            await prisma_1.prisma.employee.update({
                where: { id: employeeId },
                data: { profile_image_url: newImageUrl },
            });
            if (emp?.profile_image_url) {
                await storageService
                    .delete(emp.profile_image_url)
                    .catch((e) => logger_1.logger.warn('Could not delete old profile photo:', e));
            }
            return res.status(200).json({
                message: 'Profile photo updated successfully',
                profile_image_url: (0, media_1.publicAssetUrl)(newImageUrl),
            });
        }
        catch (error) {
            logger_1.logger.error('Profile photo upload error:', error);
            return res.status(500).json({ error: 'Failed to upload profile photo' });
        }
    });
});
exports.default = router;
