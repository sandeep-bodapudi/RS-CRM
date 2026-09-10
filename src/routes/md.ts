import { logger } from '../utils/logger';
import { Router, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { requireAuthz } from '../middleware/authz';
import { Roles, Permissions } from '../shared';
import { AnalyticsService } from '../services/analytics.service';

const router = Router();

const p = prisma;

// GET /api/v1/md/employees - List employees for MD Control (Admin filtered out)
router.get(
  '/employees',
  authenticateToken,
  requireAuthz(Permissions.EMPLOYEES_READ),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const employees = await p.employee.findMany({
        where: {
          // Packet D (15-16): company-scoped to req.user.companyId
          company_id: req.user!.companyId,
          // Filter out Admin or invisible system roles per SDD Golden Rule #2
          roles: {
            none: {
              role: {
                is_invisible: true,
              },
            },
          },
        },
        include: {
          company: true,
          branch: true,
          roles: {
            include: {
              role: true,
            },
          },
        },
        orderBy: { id: 'asc' },
      });

      const formatted = employees.map((emp: any) => ({
        id: emp.id,
        employeeCode: emp.employee_code,
        fullName: emp.full_name || emp.employee_code,
        company: emp.company.name,
        branch: emp.branch?.name || 'All Branches',
        roles: emp.roles.map((r: any) => r.role.name),
        status: emp.status,
        attendanceRequired: emp.attendance_required,
        firstLoginDone: emp.first_login_done,
      }));

      return res.status(200).json({ employees: formatted });
    } catch (error) {
      logger.error('MD employees fetch error:', error);
      return res.status(500).json({ error: 'Failed to fetch employee list' });
    }
  }
);

// PATCH /api/v1/md/employees/:id/attendance-requirement - Toggle attendance requirement
router.patch(
  '/employees/:id/attendance-requirement',
  authenticateToken,
  requireAuthz(Permissions.EMPLOYEES_UPDATE),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const targetId = parseInt(req.params.id, 10);
      const { attendanceRequired } = req.body;

      if (typeof attendanceRequired !== 'boolean') {
        return res.status(400).json({ error: 'attendanceRequired must be a boolean' });
      }

      const existing = await p.employee.findUnique({
        where: { id: targetId },
        include: { roles: { include: { role: true } } },
      });

      if (!existing) {
        return res.status(404).json({ error: 'Employee not found' });
      }

      // Safeguard: Never modify invisible Admin
      if (existing.roles.some((r: any) => r.role.is_invisible)) {
        return res.status(403).json({ error: 'Cannot modify Admin technical account' });
      }

      const updated = await p.employee.update({
        where: { id: targetId },
        data: { attendance_required: attendanceRequired },
      });

      const actorId = req.user?.employeeId || 1;

      // Write Audit Event per SDD Golden Rule #6
      await p.auditEvent.create({
        data: {
          actor_id: actorId,
          action: 'TOGGLE_ATTENDANCE_REQUIREMENT',
          entity_type: 'EMPLOYEE',
          entity_id: targetId,
          old_value: JSON.stringify({ attendance_required: existing.attendance_required }),
          new_value: JSON.stringify({ attendance_required: updated.attendance_required }),
        },
      });

      return res.status(200).json({
        message: `Updated attendance requirement for ${updated.employee_code} to ${updated.attendance_required}`,
        employeeId: updated.id,
        attendanceRequired: updated.attendance_required,
      });
    } catch (error: any) {
      next(error);
    }
  }
);

// GET /api/v1/md/executive-metrics - Real DB Metrics Aggregator for MD Executive Dashboard
// Delegates to the centralized AnalyticsService (Phase 16 Packet B extraction) so the
// KPI calculations are shared with /api/v1/analytics/kpis. The flat response contract
// below is preserved EXACTLY (same field names) - this is behavior-preserving.
router.get(
  '/executive-metrics',
  authenticateToken,
  requireAuthz(Permissions.ADMIN_SYSTEM_METRICS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const companyId = req.user?.companyId || 1;
      const metrics = await AnalyticsService.getExecutiveMetrics(companyId);
      return res.status(200).json(metrics);
    } catch (error: any) {
      logger.error('Fetch executive metrics error:', error);
      return res.status(500).json({ error: 'Failed to fetch executive metrics' });
    }
  }
);

// GET /api/v1/md/recent-activity - Portal-wide activity feed for the MD dashboard
router.get(
  '/recent-activity',
  authenticateToken,
  requireAuthz(Permissions.ADMIN_SYSTEM_METRICS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const companyId = req.user?.companyId || 1;
      const activity = await AnalyticsService.getRecentActivity(companyId);
      return res.status(200).json({ activity });
    } catch (error: any) {
      logger.error('Fetch recent activity error:', error);
      return res.status(500).json({ error: 'Failed to fetch recent activity' });
    }
  }
);

export default router;
