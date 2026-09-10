import { logger } from '../../utils/logger';
import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticateToken, AuthenticatedRequest } from '../../middleware/auth';
import { EmployeeSelfUpdateSchema } from '../../shared';
import { encryptData, decryptData } from '../../utils/crypto';
import { publicAssetUrl } from '../../utils/media';
import { validateRequestBody } from '../../middleware/validate';
import { memoryUpload, getStorageService } from '../../services/storage.service';

const router = Router();

const profileUpload = memoryUpload;

// PATCH /api/v1/employees/me - Self-update for safe profile fields
router.patch(
  '/me',
  authenticateToken,
  validateRequestBody(EmployeeSelfUpdateSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const employeeId = req.user!.employeeId;
      const {
        full_name,
        phone,
        secondary_phone,
        whatsapp_number,
        email,
        current_address,
        permanent_address,
        emergency_contact_name,
        emergency_contact_relation,
        emergency_contact_phone,
        blood_group,
        social_links,
        pan_number,
        aadhaar_number,
        bank_name,
        bank_account_number,
        bank_ifsc,
        bank_branch,
      } = req.body;

      const currentEmp = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { bank_account_number: true },
      });

      if (!currentEmp) {
        return res.status(404).json({ error: 'Employee not found' });
      }

      const updateData: any = {};
      if (full_name !== undefined) updateData.full_name = full_name;
      if (phone !== undefined) updateData.phone = phone;
      if (secondary_phone !== undefined) updateData.secondary_phone = secondary_phone;
      if (whatsapp_number !== undefined) updateData.whatsapp_number = whatsapp_number;
      if (email !== undefined) updateData.email = email;
      if (current_address !== undefined) updateData.current_address = current_address;
      if (permanent_address !== undefined) updateData.permanent_address = permanent_address;
      if (emergency_contact_name !== undefined)
        updateData.emergency_contact_name = emergency_contact_name;
      if (emergency_contact_relation !== undefined)
        updateData.emergency_contact_relation = emergency_contact_relation;
      if (emergency_contact_phone !== undefined)
        updateData.emergency_contact_phone = emergency_contact_phone;
      if (blood_group !== undefined) updateData.blood_group = blood_group;
      if (social_links !== undefined) updateData.social_links = social_links;

      // KYC — encrypted at rest (Phase 1.4). Previously written as plaintext
      // here, bypassing encryptData() entirely even though the employee-create
      // path already encrypted these same fields.
      if (pan_number !== undefined) updateData.pan_number = encryptData(pan_number);
      if (aadhaar_number !== undefined) updateData.aadhaar_number = encryptData(aadhaar_number);

      // Bank Details (always allow updating now)
      if (bank_name !== undefined) updateData.bank_name = encryptData(bank_name);
      if (bank_account_number !== undefined)
        updateData.bank_account_number = encryptData(bank_account_number);
      if (bank_ifsc !== undefined) updateData.bank_ifsc = encryptData(bank_ifsc);
      if (bank_branch !== undefined) updateData.bank_branch = encryptData(bank_branch);

      const updatedEmp = await prisma.employee.update({
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
          pan_number: decryptData(updatedEmp.pan_number),
          aadhaar_number: decryptData(updatedEmp.aadhaar_number),
          bank_name: decryptData(updatedEmp.bank_name),
          bank_account_number: decryptData(updatedEmp.bank_account_number),
          bank_ifsc: decryptData(updatedEmp.bank_ifsc),
          bank_branch: decryptData(updatedEmp.bank_branch),
        },
      });
    } catch (error) {
      logger.error('Self update error:', error);
      return res.status(500).json({ error: 'Failed to update profile' });
    }
  },
);

// POST /api/v1/employees/me/photo - Upload profile photo
// POST /api/v1/employees/me/photo - Upload profile photo
router.post('/me/photo', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  (profileUpload.single('profile_image') as any)(req, res, async (err: any) => {
    if (err) {
      logger.error('Multer error:', err);
      return res.status(400).json({ error: err.message || 'File upload failed' });
    }

    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: 'No image file provided.' });
      }

      const employeeId = req.user!.employeeId;

      const emp = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { profile_image_url: true },
      });

      const storageService = getStorageService('profiles');
      const newImageUrl = await storageService.upload(
        file.buffer,
        file.originalname,
        file.mimetype,
      );

      await prisma.employee.update({
        where: { id: employeeId },
        data: { profile_image_url: newImageUrl },
      });

      if (emp?.profile_image_url) {
        await storageService
          .delete(emp.profile_image_url)
          .catch((e) => logger.warn('Could not delete old profile photo:', e));
      }

      return res.status(200).json({
        message: 'Profile photo updated successfully',
        profile_image_url: publicAssetUrl(newImageUrl),
      });
    } catch (error) {
      logger.error('Profile photo upload error:', error);
      return res.status(500).json({ error: 'Failed to upload profile photo' });
    }
  });
});

export default router;
