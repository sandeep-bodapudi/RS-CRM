import { logger } from '../../utils/logger';
import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticateToken, AuthenticatedRequest, requireRole } from '../../middleware/auth';
import { getISTComponents } from '../../utils/time';
import { Roles } from '../../shared';

const router = Router();

const p = prisma;

// GET /api/v1/attendance/live - HR Live Attendance Feed (Today only)
router.get(
  '/live',
  authenticateToken,
  requireRole([Roles.HR_MANAGER, Roles.MD, Roles.ADMIN]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { dateString } = getISTComponents(new Date());

      // Fetch all attendance logs that occurred today
      const allLogs = await p.attendanceLog.findMany({
        where: { employee: { company_id: req.user!.companyId } },
        orderBy: { check_in_at: 'desc' },
        include: {
          employee: {
            select: {
              full_name: true,
              employee_code: true,
            },
          },
        },
      });

      // Filter for today in IST
      const todayLogs = allLogs.filter((l: any) => {
        if (!l.check_in_at) return false;
        return getISTComponents(new Date(l.check_in_at)).dateString === dateString;
      });

      return res.status(200).json({ logs: todayLogs });
    } catch (error) {
      logger.error('Live attendance error:', error);
      return res.status(500).json({ error: 'Failed to load live attendance' });
    }
  },
);

// GET /api/v1/attendance/history - HR Paginated Historical Attendance
router.get(
  '/history',
  authenticateToken,
  requireRole([Roles.HR_MANAGER, Roles.MD, Roles.ADMIN]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { search, status, startDate, endDate, page = '1', limit = '50' } = req.query;
      const skip = (Number(page) - 1) * Number(limit);

      const whereClause: any = {
        employee: {
          company_id: req.user!.companyId,
          ...(search && {
            OR: [
              { full_name: { contains: search as string } },
              { employee_code: { contains: search as string } },
            ],
          }),
        },
      };

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
      logger.error('History attendance error:', error);
      return res.status(500).json({ error: 'Failed to load attendance history' });
    }
  },
);

export default router;
