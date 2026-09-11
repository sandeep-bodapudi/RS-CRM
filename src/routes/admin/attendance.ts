import { logger } from '../../utils/logger';
import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticateToken, AuthenticatedRequest, requireRole } from '../../middleware/auth';
import { Roles, AttendanceStatus, AttendanceStatusType } from '../../shared';
import { getISTComponents } from '../../utils/time';

const router = Router();
const p = prisma;

// GET /api/v1/admin/attendance/search — search/filter attendance logs
router.get(
  '/attendance/search',
  authenticateToken,
  requireRole([Roles.MD, Roles.ADMIN]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { search, status, startDate, endDate, page = '1', limit = '50' } = req.query;
      const skip = (Number(page) - 1) * Number(limit);

      const whereClause: any = {
        employee: { company_id: req.user!.companyId },
      };

      if (search) {
        whereClause.employee.OR = [
          { full_name: { contains: search as string } },
          { employee_code: { contains: search as string } },
        ];
      }

      if (status) {
        whereClause.status = status;
      }

      if (startDate || endDate) {
        whereClause.check_in_at = {};
        if (startDate) whereClause.check_in_at.gte = new Date(startDate as string);
        if (endDate) {
          const end = new Date(endDate as string);
          end.setHours(23, 59, 59, 999);
          whereClause.check_in_at.lte = end;
        }
      }

      const [logs, total] = await Promise.all([
        p.attendanceLog.findMany({
          where: whereClause,
          orderBy: { check_in_at: 'desc' },
          skip,
          take: Number(limit),
          include: {
            employee: {
              select: {
                full_name: true,
                employee_code: true,
                roles: { select: { role: { select: { name: true } } } },
              },
            },
          },
        }),
        p.attendanceLog.count({ where: whereClause }),
      ]);

      return res.status(200).json({
        logs,
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (error) {
      logger.error('[Admin] Attendance search failed:', error);
      return res.status(500).json({ error: 'Failed to search attendance' });
    }
  },
);

// GET /api/v1/admin/attendance/:id — single attendance log detail
router.get(
  '/attendance/:id',
  authenticateToken,
  requireRole([Roles.MD, Roles.ADMIN]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const log = await p.attendanceLog.findFirst({
        where: {
          id: Number(req.params.id),
          employee: { company_id: req.user!.companyId },
        },
        include: {
          employee: {
            select: {
              id: true,
              full_name: true,
              employee_code: true,
              roles: { select: { role: { select: { name: true } } } },
            },
          },
        },
      });

      if (!log) {
        return res.status(404).json({ error: 'Attendance log not found' });
      }

      return res.status(200).json({ log });
    } catch (error) {
      logger.error('[Admin] Attendance fetch failed:', error);
      return res.status(500).json({ error: 'Failed to fetch attendance' });
    }
  },
);

// PATCH /api/v1/admin/attendance/:id — correct attendance status, checkout, notes
router.patch(
  '/attendance/:id',
  authenticateToken,
  requireRole([Roles.MD, Roles.ADMIN]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const logId = Number(req.params.id);
      const { status, check_out_at, notes } = req.body;

      const log = await p.attendanceLog.findFirst({
        where: {
          id: logId,
          employee: { company_id: req.user!.companyId },
        },
        include: { employee: { select: { employment_type: true } } },
      });

      if (!log) {
        return res.status(404).json({ error: 'Attendance log not found' });
      }

      // Record old values for audit
      const oldData = {
        status: log.status,
        check_out_at: log.check_out_at,
        notes: log.notes,
      };

      const updateData: any = {};
      const auditActions: string[] = [];

      if (status !== undefined) {
        updateData.status = status;
        auditActions.push(`status: ${oldData.status} → ${status}`);
      }

      if (check_out_at !== undefined) {
        updateData.check_out_at = check_out_at ? new Date(check_out_at) : null;

        // Recalculate working_duration_minutes
        const checkInTime = new Date(log.check_in_at).getTime();
        const checkOutTime = check_out_at ? new Date(check_out_at).getTime() : Date.now();
        const durationMinutes = Math.max(0, Math.round((checkOutTime - checkInTime) / 60000));
        updateData.working_duration_minutes = durationMinutes;

        auditActions.push(`checkout: ${oldData.check_out_at || 'None'} → ${check_out_at || 'Cleared'}`);
      }

      if (notes !== undefined) {
        updateData.notes = notes || null;
        auditActions.push(`notes updated`);
      }

      const updated = await p.attendanceLog.update({
        where: { id: logId },
        data: updateData,
      });

      // Audit trail
      await p.auditEvent.create({
        data: {
          actor_id: req.user!.employeeId,
          action: 'ADMIN_ATTENDANCE_UPDATE',
          entity_type: 'ATTENDANCE_LOG',
          entity_id: logId,
          old_value: JSON.stringify(oldData),
          new_value: JSON.stringify({ ...updateData, audit_actions: auditActions }),
        },
      });

      return res.status(200).json({
        message: 'Attendance updated successfully',
        log: updated,
      });
    } catch (error: any) {
      logger.error('[Admin] Attendance update failed:', error);
      return res.status(500).json({ error: 'Failed to update attendance', detail: error?.message });
    }
  },
);

// GET /api/v1/admin/attendance/:id/log — audit trail for a specific attendance log
router.get(
  '/attendance/:id/log',
  authenticateToken,
  requireRole([Roles.MD, Roles.ADMIN]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const auditLogs = await p.auditEvent.findMany({
        where: {
          entity_type: 'ATTENDANCE_LOG',
          entity_id: Number(req.params.id),
        },
        orderBy: { created_at: 'desc' },
        take: 50,
      });

      return res.status(200).json({ auditLogs });
    } catch (error) {
      logger.error('[Admin] Attendance audit log fetch failed:', error);
      return res.status(500).json({ error: 'Failed to fetch audit trail' });
    }
  },
);

export default router;
