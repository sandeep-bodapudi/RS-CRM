import { logger } from '../../utils/logger';
import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma';
import bcrypt from 'bcryptjs';
import { authenticateToken, AuthenticatedRequest } from '../../middleware/auth';
import { requireAuthz } from '../../middleware/authz';
import { Roles, Permissions, EmptyBodySchema, EmployeeRolesUpdateSchema } from '../../shared';
import { can } from '../../authz/authorization';
import { notifyEmployee } from '../../utils/notifyEmployee';
import { validateRequestBody } from '../../middleware/validate';

const router = Router();

// POST /api/v1/employees/:id/reset-password - Admin 1-click Password Reset
router.post(
  '/:id/reset-password',
  authenticateToken,
  requireAuthz(Permissions.EMPLOYEES_RESET_PASSWORD),
  validateRequestBody(EmptyBodySchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const employeeId = parseInt(req.params.id, 10);
      const targetEmployee = await prisma.employee.findUnique({ where: { id: employeeId } });
      if (!targetEmployee) {
        return res.status(404).json({ error: 'Employee not found' });
      }

      if (!can(req.user!, Permissions.EMPLOYEES_RESET_PASSWORD, targetEmployee)) {
        return res
          .status(403)
          .json({ error: 'Forbidden: Cannot reset password for employee outside your company' });
      }

      const newHash = await bcrypt.hash('Radhareal@123', 12);

      await prisma.$transaction(async (tx) => {
        await tx.employee.update({
          where: { id: employeeId },
          data: {
            password_hash: newHash,
            first_login_done: false,
            token_version: { increment: 1 },
          },
        });

        await tx.authSession.updateMany({
          where: { employee_id: employeeId, revoked: false },
          data: { revoked: true, revocation_reason: 'ADMIN_PASSWORD_RESET' },
        });
      });

      // Notify employee their password was reset by admin
      await notifyEmployee(employeeId, {
        type: 'PASSWORD_RESET',
        title: '🔐 Your Password Has Been Reset',
        message:
          'An administrator has reset your password to the default. Please log in and change it immediately.',
      });

      return res.status(200).json({
        message: 'Password reset to default (Password@123) successfully',
      });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to reset employee password' });
    }
  },
);

// PUT /api/v1/employees/:id/roles - Update an employee's roles
router.put(
  '/:id/roles',
  authenticateToken,
  validateRequestBody(EmployeeRolesUpdateSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const employeeId = parseInt(req.params.id, 10);
      const { role_names } = req.body;

      if (!Array.isArray(role_names)) {
        return res.status(400).json({ error: 'role_names must be an array of strings' });
      }

      const userRoles = req.user!.roles;
      const isUserAdmin = userRoles.includes(Roles.ADMIN);
      const isUserMD = userRoles.includes(Roles.MD);

      if (!isUserAdmin && !isUserMD) {
        return res.status(403).json({ error: 'Forbidden: Only MD or ADMIN can assign roles' });
      }

      const targetEmployee = await prisma.employee.findUnique({
        where: { id: employeeId },
        include: { branch: true },
      });

      if (!targetEmployee) {
        return res.status(404).json({ error: 'Employee not found' });
      }

      // Tenant check: target employee must be in same company_id
      if (targetEmployee.branch?.company_id !== req.user!.companyId && !isUserAdmin) {
        return res
          .status(403)
          .json({ error: 'Forbidden: Cannot manage roles for an employee outside your company' });
      }

      // Check if roles are valid according to shared constants
      const validRolesSet = new Set(Object.values(Roles));
      for (const role of role_names) {
        if (!validRolesSet.has(role)) {
          return res.status(400).json({ error: `Invalid role: ${role}` });
        }
      }

      // Privilege escalation check
      if (role_names.includes(Roles.ADMIN) && !isUserAdmin) {
        return res.status(403).json({ error: 'Forbidden: Only ADMIN can assign ADMIN role' });
      }

      // Check if removing the last MD in the company
      const currentRoles = await prisma.employeeRole.findMany({
        where: { employee_id: employeeId },
        include: { role: true },
      });

      const wasMD = currentRoles.some((r: any) => r.role.name === Roles.MD);
      const willBeMD = role_names.includes(Roles.MD);

      if (wasMD && !willBeMD) {
        const companyId = targetEmployee.branch?.company_id;
        if (companyId) {
          const otherMDs = await prisma.employeeRole.count({
            where: {
              role: { name: Roles.MD },
              employee_id: { not: employeeId },
              employee: { branch: { company_id: companyId } },
            },
          });
          if (otherMDs === 0) {
            return res
              .status(400)
              .json({ error: 'Cannot remove the last Managing Director from the company' });
          }
        }
      }

      // Fetch role DB IDs
      const targetRoles = await prisma.role.findMany({
        where: { name: { in: role_names } },
      });

      if (targetRoles.length !== role_names.length) {
        return res.status(400).json({ error: 'One or more roles do not exist in the database' });
      }

      await prisma.$transaction(async (tx) => {
        // Clear existing roles
        await tx.employeeRole.deleteMany({ where: { employee_id: employeeId } });

        // Add new roles
        await tx.employeeRole.createMany({
          data: targetRoles.map((r: any) => ({
            employee_id: employeeId,
            role_id: r.id,
          })),
        });

        // Invalidate sessions
        await tx.employee.update({
          where: { id: employeeId },
          data: { token_version: { increment: 1 } },
        });

        await tx.authSession.updateMany({
          where: { employee_id: employeeId, revoked: false },
          data: { revoked: true, revocation_reason: 'AUTHORIZATION_CHANGED' },
        });
      });

      await notifyEmployee(employeeId, {
        type: 'ROLE_CHANGED',
        title: '🏷️ Your Roles Have Been Updated',
        message:
          'Your system roles have been updated by an administrator. Please log in again to apply changes.',
      });

      return res.status(200).json({ message: 'Roles updated successfully' });
    } catch (error) {
      logger.error('Update roles error:', error);
      return res.status(500).json({ error: 'Failed to update roles' });
    }
  },
);

export default router;
