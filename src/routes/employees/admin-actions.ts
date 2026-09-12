import { logger } from '../../utils/logger';
import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma';
import bcrypt from 'bcryptjs';
import { authenticateToken, AuthenticatedRequest, requireRole } from '../../middleware/auth';
import { requireAuthz } from '../../middleware/authz';
import { Roles, Permissions, EmptyBodySchema, EmployeeRolesUpdateSchema } from '../../shared';
import { can } from '../../authz/authorization';
import { notifyEmployee } from '../../utils/notifyEmployee';
import { validateRequestBody } from '../../middleware/validate';
import { z } from 'zod';

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

const SetPermissionOverrideSchema = z.object({
  permission: z.string().min(1),
  is_granted: z.boolean(),
});

/**
 * Per-employee permission overrides (#11) — grant or revoke a single
 * permission for one person without touching their role. Unlike the
 * role-level RolePermission table (routes/admin/permissions.ts), this table
 * is read directly into permissionsSet at every token-minting site in
 * routes/auth.ts, and a `is_granted: false` row actively DELETES the
 * permission from the set rather than merely not adding it — so both grant
 * and revoke apply as soon as the employee's JWT is rebuilt. Revoking still
 * force-invalidates existing sessions here, same as the role-level reset, so
 * a revoke can't be quietly outlived by an already-issued token.
 */

// GET /api/v1/employees/:id/permission-overrides — list this employee's overrides
router.get(
  '/:id/permission-overrides',
  authenticateToken,
  requireRole([Roles.MD, Roles.ADMIN]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const employeeId = parseInt(req.params.id, 10);
      if (isNaN(employeeId)) return res.status(400).json({ error: 'Invalid employee ID' });

      const overrides = await prisma.employeePermissionOverride.findMany({
        where: { employee_id: employeeId },
        include: { permission: true },
      });

      return res.status(200).json({
        overrides: overrides.map((o: any) => ({
          permission: o.permission.name,
          is_granted: o.is_granted,
        })),
        allPermissionKeys: Object.values(Permissions),
      });
    } catch (error) {
      logger.error('Fetch employee permission overrides error:', error);
      return res.status(500).json({ error: 'Failed to fetch permission overrides' });
    }
  },
);

// PUT /api/v1/employees/:id/permission-overrides — grant or revoke one permission for this employee
router.put(
  '/:id/permission-overrides',
  authenticateToken,
  requireRole([Roles.MD, Roles.ADMIN]),
  validateRequestBody(SetPermissionOverrideSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const employeeId = parseInt(req.params.id, 10);
      if (isNaN(employeeId)) return res.status(400).json({ error: 'Invalid employee ID' });
      const { permission, is_granted } = req.body;

      const [targetEmployee, permRecord] = await Promise.all([
        prisma.employee.findUnique({ where: { id: employeeId } }),
        prisma.permission.findUnique({ where: { name: permission } }),
      ]);
      if (!targetEmployee) return res.status(404).json({ error: 'Employee not found' });
      if (!permRecord) return res.status(400).json({ error: `Unknown permission: ${permission}` });

      await prisma.$transaction(async (tx) => {
        await tx.employeePermissionOverride.upsert({
          where: {
            employee_id_permission_id: { employee_id: employeeId, permission_id: permRecord.id },
          },
          create: { employee_id: employeeId, permission_id: permRecord.id, is_granted },
          update: { is_granted },
        });

        // A grant is safely picked up whenever the token is next refreshed;
        // a revoke needs to force that refresh now, since an already-issued
        // JWT still carries the permission it removes.
        if (!is_granted) {
          await tx.employee.update({
            where: { id: employeeId },
            data: { token_version: { increment: 1 } },
          });
          await tx.authSession.updateMany({
            where: { employee_id: employeeId, revoked: false },
            data: { revoked: true, revocation_reason: 'EMPLOYEE_PERMISSIONS_CHANGED' },
          });
        }

        await tx.auditEvent.create({
          data: {
            actor_id: req.user!.employeeId,
            action: is_granted ? 'GRANT_EMPLOYEE_PERMISSION' : 'REVOKE_EMPLOYEE_PERMISSION',
            entity_type: 'EMPLOYEE',
            entity_id: employeeId,
            new_value: JSON.stringify({ permission, is_granted }),
          },
        });
      });

      await notifyEmployee(employeeId, {
        type: 'ROLE_PERMISSIONS_CHANGED',
        title: '🔐 Your Access Was Updated',
        message: is_granted
          ? `You were individually granted the "${permission}" permission by an administrator.`
          : `Your "${permission}" permission was revoked by an administrator. Please log in again to apply the update.`,
      });

      return res.status(200).json({ message: 'Permission override saved', permission, is_granted });
    } catch (error) {
      logger.error('Set employee permission override error:', error);
      return res.status(500).json({ error: 'Failed to set permission override' });
    }
  },
);

// DELETE /api/v1/employees/:id/permission-overrides/:permission — clear one override, reverting to role default
router.delete(
  '/:id/permission-overrides/:permission',
  authenticateToken,
  requireRole([Roles.MD, Roles.ADMIN]),
  validateRequestBody(EmptyBodySchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const employeeId = parseInt(req.params.id, 10);
      if (isNaN(employeeId)) return res.status(400).json({ error: 'Invalid employee ID' });
      const permission = req.params.permission;

      const permRecord = await prisma.permission.findUnique({ where: { name: permission } });
      if (!permRecord) return res.status(400).json({ error: `Unknown permission: ${permission}` });

      const existing = await prisma.employeePermissionOverride.findUnique({
        where: {
          employee_id_permission_id: { employee_id: employeeId, permission_id: permRecord.id },
        },
      });
      if (!existing)
        return res.status(404).json({ error: 'No override found for this permission' });

      await prisma.$transaction(async (tx) => {
        await tx.employeePermissionOverride.delete({
          where: {
            employee_id_permission_id: { employee_id: employeeId, permission_id: permRecord.id },
          },
        });

        // Clearing a revoke restores whatever the role would otherwise grant,
        // which needs the same forced refresh a grant would; clearing a grant
        // removes access the employee may still hold via their current JWT.
        // Force re-auth in both directions since we can't tell locally which
        // effective outcome this produces without recomputing role defaults.
        await tx.employee.update({
          where: { id: employeeId },
          data: { token_version: { increment: 1 } },
        });
        await tx.authSession.updateMany({
          where: { employee_id: employeeId, revoked: false },
          data: { revoked: true, revocation_reason: 'EMPLOYEE_PERMISSIONS_CHANGED' },
        });

        await tx.auditEvent.create({
          data: {
            actor_id: req.user!.employeeId,
            action: 'CLEAR_EMPLOYEE_PERMISSION_OVERRIDE',
            entity_type: 'EMPLOYEE',
            entity_id: employeeId,
            old_value: JSON.stringify({ permission, was_granted: existing.is_granted }),
          },
        });
      });

      await notifyEmployee(employeeId, {
        type: 'ROLE_PERMISSIONS_CHANGED',
        title: '🔐 Your Access Was Updated',
        message: `Your individual override for "${permission}" was cleared by an administrator. Please log in again to apply the update.`,
      });

      return res.status(200).json({ message: 'Permission override cleared' });
    } catch (error) {
      logger.error('Clear employee permission override error:', error);
      return res.status(500).json({ error: 'Failed to clear permission override' });
    }
  },
);

export default router;
