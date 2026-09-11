import { logger } from '../../utils/logger';
import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticateToken, AuthenticatedRequest, requireRole } from '../../middleware/auth';
import { Roles, Permissions } from '../../shared';
import { validateRequestBody } from '../../middleware/validate';
import { z } from 'zod';
import { setRolePermissionOverrideCacheDirty } from '../../authz/dbPermissions';

const router = Router();
const p = prisma;

const UpdateRolePermissionsSchema = z.object({
  granted: z.array(z.string()).optional(),
  denied: z.array(z.string()).optional(),
});

/**
 * Dynamic Permissions Management — Admin / MD only
 * These endpoints manage the RolePermission join table, which the auth
 * middleware consults at request-time (with a short in-memory cache) so
 * changes take effect immediately without re-login.
 */

// GET /api/v1/admin/permissions — Get all roles with their effective permissions
router.get(
  '/permissions',
  authenticateToken,
  requireRole([Roles.MD, Roles.ADMIN]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const roles = await p.role.findMany({
        include: {
          permissions: {
            include: {
              permission: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      });

      // Also fetch all known permission keys from the shared enum for the UI dropdowns
      const allPermissionKeys = Object.values(Permissions);

      const rolePerms = roles.map((r: any) => ({
        id: r.id,
        name: r.name,
        is_system: r.is_system,
        permissions: r.permissions.map((rp: any) => rp.permission.name),
      }));

      return res.status(200).json({
        roles: rolePerms,
        allPermissionKeys,
      });
    } catch (error) {
      logger.error('[Admin] Permissions fetch failed:', error);
      return res.status(500).json({ error: 'Failed to fetch role permissions' });
    }
  },
);

// GET /api/v1/admin/permissions/:roleName — Get permissions for a specific role
router.get(
  '/permissions/:roleName',
  authenticateToken,
  requireRole([Roles.MD, Roles.ADMIN]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const role = await p.role.findUnique({
        where: { name: req.params.roleName },
        include: {
          permissions: {
            include: {
              permission: true,
            },
          },
        },
      });

      if (!role) {
        return res.status(404).json({ error: 'Role not found' });
      }

      return res.status(200).json({
        id: role.id,
        name: role.name,
        is_system: role.is_system,
        permissions: role.permissions.map((rp: any) => rp.permission.name),
      });
    } catch (error) {
      logger.error('[Admin] Single role permissions fetch failed:', error);
      return res.status(500).json({ error: 'Failed to fetch role permissions' });
    }
  },
);

// PATCH /api/v1/admin/permissions/:roleName — Update permissions for a role
router.patch(
  '/permissions/:roleName',
  authenticateToken,
  requireRole([Roles.MD, Roles.ADMIN]),
  validateRequestBody(UpdateRolePermissionsSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const roleName = req.params.roleName;
      const { granted, denied } = req.body;

      const role = await p.role.findUnique({
        where: { name: roleName },
      });

      if (!role) {
        return res.status(404).json({ error: 'Role not found' });
      }

      const actions: string[] = [];

      // Add granted permissions (if not already present)
      const existingPermRecords = await p.rolePermission.findMany({
        where: { role_id: role.id },
        select: { permission: { select: { name: true } } },
      });
      const existingPerms = new Set(existingPermRecords.map((rp: any) => rp.permission.name));

      const toAdd = granted?.filter((p: string) => !existingPerms.has(p)) ?? [];
      const toRemove = denied?.filter((p: string) => existingPerms.has(p)) ?? [];

      // Look up permission records by name
      const permRecords = await p.permission.findMany({
        where: { name: { in: [...toAdd, ...toRemove] } },
      });
      const permMap = new Map(permRecords.map((p: any) => [p.name, p.id]));

      await p.$transaction(async (tx: any) => {
        for (const permName of toAdd) {
          const permId = permMap.get(permName);
          if (permId) {
            await tx.rolePermission.create({
              data: {
                role_id: role.id,
                permission_id: permId,
              },
            });
            actions.push(`GRANT ${permName}`);
          }
        }

        for (const permName of toRemove) {
          const permId = permMap.get(permName);
          if (permId) {
            await tx.rolePermission.delete({
              where: {
                role_id_permission_id: {
                  role_id: role.id,
                  permission_id: permId,
                },
              },
            });
            actions.push(`DENY ${permName}`);
          }
        }
      });

      // Audit trail
      await p.auditEvent.create({
        data: {
          actor_id: req.user!.employeeId,
          action: 'UPDATE_ROLE_PERMISSIONS',
          entity_type: 'ROLE',
          entity_id: role.id,
          old_value: JSON.stringify({ permissions: [...existingPerms] }),
          new_value: JSON.stringify({ granted: toAdd, denied: toRemove, actions }),
        },
      });

      // Invalidate authz cache so changes take effect immediately
      setRolePermissionOverrideCacheDirty();

      // Fetch updated permissions
      const updated = await p.role.findUnique({
        where: { id: role.id },
        include: {
          permissions: {
            include: {
              permission: true,
            },
          },
        },
      });

      return res.status(200).json({
        message: `Permissions updated for role ${roleName}`,
        role: {
          id: updated!.id,
          name: updated!.name,
          permissions: updated!.permissions.map((rp: any) => rp.permission.name),
        },
      });
    } catch (error: any) {
      logger.error('[Admin] Role permissions update failed:', error);
      return res
        .status(500)
        .json({ error: 'Failed to update role permissions', detail: error?.message });
    }
  },
);

// DELETE /api/v1/admin/permissions/:roleName/reset — Reset a role's permissions to defaults
router.delete(
  '/permissions/:roleName/reset',
  authenticateToken,
  requireRole([Roles.MD, Roles.ADMIN]),
  validateRequestBody(z.object({})),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const roleName = req.params.roleName;
      const role = await p.role.findUnique({
        where: { name: roleName },
      });

      if (!role) {
        return res.status(404).json({ error: 'Role not found' });
      }

      const count = await p.rolePermission.deleteMany({
        where: { role_id: role.id },
      });

      await p.auditEvent.create({
        data: {
          actor_id: req.user!.employeeId,
          action: 'RESET_ROLE_PERMISSIONS',
          entity_type: 'ROLE',
          entity_id: role.id,
          old_value: `Reset ${count.count} permission overrides`,
          new_value: 'Reverted to hardcoded RolePermissionsMatrix defaults',
        },
      });

      // Invalidate authz cache
      setRolePermissionOverrideCacheDirty();

      return res.status(200).json({
        message: `Permissions reset to defaults for role ${roleName}`,
        permissionsRemoved: count.count,
      });
    } catch (error) {
      logger.error('[Admin] Role permissions reset failed:', error);
      return res.status(500).json({ error: 'Failed to reset role permissions' });
    }
  },
);

// GET /api/v1/admin/permissions/matrix — Full role-permission matrix as a flat map
// Useful for a quick matrix-style UI
router.get(
  '/permissions-matrix',
  authenticateToken,
  requireRole([Roles.MD, Roles.ADMIN]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const allPermissionKeys = Object.values(Permissions);
      const roles = await p.role.findMany({
        include: {
          permissions: {
            select: { permission: { select: { name: true } } },
          },
        },
        orderBy: { name: 'asc' },
      });

      const matrix: Record<string, Record<string, boolean>> = {};
      roles.forEach((role: any) => {
        const granted = new Set(role.permissions.map((rp: any) => rp.permission.name));
        matrix[role.name] = {};
        allPermissionKeys.forEach((key: any) => {
          matrix[role.name][key] = granted.has(key);
        });
      });

      return res.status(200).json({
        matrix,
        permissionKeys: allPermissionKeys,
        roleNames: roles.map((r: any) => r.name),
      });
    } catch (error) {
      logger.error('[Admin] Permissions matrix fetch failed:', error);
      return res.status(500).json({ error: 'Failed to fetch permissions matrix' });
    }
  },
);

export default router;
