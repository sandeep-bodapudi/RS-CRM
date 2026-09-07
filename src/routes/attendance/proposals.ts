import { logger } from '../../utils/logger';
import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticateToken, AuthenticatedRequest, requireRole } from '../../middleware/auth';
import { calculateAttendanceStatus, getISTComponents } from '../../utils/time';
import { Roles, LateProposalSchema, LeaveProposalSchema, EmptyBodySchema } from '../../shared';
import { validateRequestBody } from '../../middleware/validate';
import { notifyEmployee } from '../../utils/notifyEmployee';

const router = Router();

const p = prisma;

// POST /api/v1/attendance/late-proposal - Submit late proposal (< 09:30 AM IST)
router.post(
  '/late-proposal',
  authenticateToken,
  validateRequestBody(LateProposalSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { hours, minutes } = getISTComponents(new Date());
      const currentMinutes = hours * 60 + minutes;
      const cutoff930 = 9 * 60 + 30; // 09:30 AM

      if (currentMinutes > cutoff930) {
        return res.status(400).json({
          error: 'Late proposals must be submitted before 09:30 AM IST on the same day.',
        });
      }

      // Record proposal in AttendanceProposal table
      const proposal = await p.attendanceProposal.create({
        data: {
          employee_id: req.user!.employeeId,
          type: 'LATE_CHECKIN',
          target_date: new Date(`${req.body.date}T${req.body.expected_time}:00+05:30`),
          reason: req.body.reason,
          status: 'PENDING',
        },
      });

      // Write AuditEvent so the HR approval queue (GET /attendance/proposals/queue)
      // can surface this submission — queue filters on action: 'SUBMIT_LATE_PROPOSAL'
      await p.auditEvent.create({
        data: {
          actor_id: req.user!.employeeId,
          action: 'SUBMIT_LATE_PROPOSAL',
          entity_type: 'ATTENDANCE_PROPOSAL',
          entity_id: proposal.id,
          new_value: JSON.stringify({
            type: 'LATE_CHECKIN',
            target_date: proposal.target_date,
            reason: req.body.reason,
          }),
        },
      });

      return res.status(201).json({
        message: 'Late proposal submitted successfully to HR queue',
        proposalId: proposal.id,
      });
    } catch (error: any) {
      logger.error('Late proposal error:', error);
      return res
        .status(500)
        .json({ error: 'Failed to submit late proposal', detail: error?.message });
    }
  },
);

// POST /api/v1/attendance/leave-proposal - Submit leave proposal
router.post(
  '/leave-proposal',
  authenticateToken,
  validateRequestBody(LeaveProposalSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { start_date, end_date, reason } = req.body;
      if (!start_date || !reason) {
        return res.status(400).json({ error: 'Start date and reason are required' });
      }

      // Check if start_date is >= tomorrow
      const startDateObj = new Date(start_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (startDateObj <= today) {
        return res.status(400).json({
          error: 'Leave requests must be submitted at least 1 day in advance.',
        });
      }

      // Record proposal
      const proposal = await p.attendanceProposal.create({
        data: {
          employee_id: req.user!.employeeId,
          type: 'LEAVE',
          target_date: new Date(`${start_date}T00:00:00+05:30`),
          reason: reason,
          status: 'PENDING',
        },
      });

      // Write AuditEvent so the HR approval queue can surface it
      await p.auditEvent.create({
        data: {
          actor_id: req.user!.employeeId,
          action: 'SUBMIT_LEAVE_PROPOSAL',
          entity_type: 'ATTENDANCE_PROPOSAL',
          entity_id: proposal.id,
          new_value: JSON.stringify({
            type: 'LEAVE',
            target_date: proposal.target_date,
            end_date,
            reason,
          }),
        },
      });

      return res.status(201).json({
        message: 'Leave proposal submitted successfully to HR queue',
        proposalId: proposal.id,
      });
    } catch (error: any) {
      logger.error('Leave proposal error:', error);
      return res
        .status(500)
        .json({ error: 'Failed to submit leave proposal', detail: error?.message });
    }
  },
);

// POST /api/v1/attendance/early-logout-proposal - Submit emergency early logout
router.post(
  '/early-logout-proposal',
  authenticateToken,
  validateRequestBody(LateProposalSchema), // Reusing LateProposalSchema since it has date, expected_time, reason
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Record proposal in AttendanceProposal table
      const proposal = await p.attendanceProposal.create({
        data: {
          employee_id: req.user!.employeeId,
          type: 'EARLY_CHECKOUT',
          target_date: new Date(`${req.body.date}T${req.body.expected_time}:00+05:30`),
          reason: req.body.reason,
          status: 'APPROVED', // Auto-approved for emergencies
        },
      });

      // Write AuditEvent so HR sees it
      await p.auditEvent.create({
        data: {
          actor_id: req.user!.employeeId,
          action: 'SUBMIT_EARLY_LOGOUT',
          entity_type: 'ATTENDANCE_PROPOSAL',
          entity_id: proposal.id,
          new_value: JSON.stringify({
            type: 'EARLY_CHECKOUT',
            target_date: proposal.target_date,
            reason: req.body.reason,
          }),
        },
      });

      return res.status(201).json({
        message:
          'Emergency logout request recorded successfully. You may now scan out at the Kiosk.',
        proposalId: proposal.id,
      });
    } catch (error: any) {
      logger.error('Early logout proposal error:', error);
      return res
        .status(500)
        .json({ error: 'Failed to submit emergency logout request', detail: error?.message });
    }
  },
);

// GET /api/v1/attendance/proposals/queue - HR Manager approval queue
router.get(
  '/proposals/queue',
  authenticateToken,
  requireRole([Roles.HR_MANAGER, Roles.MD, Roles.ADMIN]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const companyEmployees = await p.employee.findMany({
        where: { company_id: req.user!.companyId },
        select: { id: true, full_name: true, employee_code: true },
      });

      const proposals = await p.attendanceProposal.findMany({
        where: {
          employee_id: { in: companyEmployees.map((e: any) => e.id) },
          status: 'PENDING',
        },
        orderBy: { created_at: 'desc' },
      });

      const mappedProposals = proposals.map((proposal: any) => {
        const emp = companyEmployees.find((e: any) => e.id === proposal.employee_id);
        return {
          ...proposal,
          employee: emp,
        };
      });

      return res.status(200).json({ proposals: mappedProposals });
    } catch (error) {
      logger.error('Proposal queue error:', error);
      return res.status(500).json({ error: 'Failed to load HR proposal queue' });
    }
  },
);

// GET /api/v1/attendance/proposals/history - HR Manager approval history
router.get(
  '/proposals/history',
  authenticateToken,
  requireRole([Roles.HR_MANAGER, Roles.MD, Roles.ADMIN]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const companyEmployees = await p.employee.findMany({
        where: { company_id: req.user!.companyId },
        select: { id: true, full_name: true, employee_code: true },
      });

      const proposals = await p.attendanceProposal.findMany({
        where: {
          employee_id: { in: companyEmployees.map((e: any) => e.id) },
          status: { in: ['APPROVED', 'REJECTED'] },
        },
        orderBy: { reviewed_at: 'desc' },
        take: 100, // Limit to recent 100 to avoid huge payloads
      });

      const mappedProposals = proposals.map((proposal: any) => {
        const emp = companyEmployees.find((e: any) => e.id === proposal.employee_id);
        return {
          ...proposal,
          employee: emp,
        };
      });

      return res.status(200).json({ proposals: mappedProposals });
    } catch (error) {
      logger.error('Proposal history error:', error);
      return res.status(500).json({ error: 'Failed to load HR proposal history' });
    }
  },
);

// POST /api/v1/attendance/proposals/:id/approve - Approve proposal
router.post(
  '/proposals/:id/approve',
  authenticateToken,
  requireRole([Roles.HR_MANAGER, Roles.MD, Roles.ADMIN]),
  validateRequestBody(EmptyBodySchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const proposal = await p.attendanceProposal.findUnique({ where: { id } });
      if (!proposal) return res.status(404).json({ error: 'Proposal not found' });

      const updated = await p.attendanceProposal.update({
        where: { id },
        data: {
          status: 'APPROVED',
          reviewed_by: req.user!.employeeId,
          reviewed_at: new Date(),
        },
      });

      if (updated.type === 'LATE_CHECKIN') {
        const targetDate = new Date(updated.target_date);
        const { dateString } = getISTComponents(targetDate);
        const istTodayStart = new Date(`${dateString}T00:00:00+05:30`);
        const istTodayEnd = new Date(`${dateString}T23:59:59+05:30`);

        const existingLog = await p.attendanceLog.findFirst({
          where: {
            employee_id: updated.employee_id,
            check_in_at: { gte: istTodayStart, lte: istTodayEnd },
          },
        });

        if (existingLog) {
          const emp = await p.employee.findUnique({ where: { id: updated.employee_id } });
          if (emp) {
            const newStatus = calculateAttendanceStatus(
              existingLog.check_in_at,
              true,
              emp.employment_type || 'FULL_TIME',
            );
            if (newStatus !== existingLog.status) {
              await p.attendanceLog.update({
                where: { id: existingLog.id },
                data: { status: newStatus },
              });
            }
          }
        }
      }

      notifyEmployee(proposal.employee_id, {
        title: 'Proposal Approved',
        message: `Your ${proposal.type === 'LEAVE' ? 'leave' : 'late'} request for ${new Date(proposal.target_date).toLocaleDateString()} has been approved.`,
        type: 'SYSTEM',
        link: '/attendance',
      });

      return res.status(200).json({ message: 'Proposal approved', proposal: updated });
    } catch (error) {
      logger.error('Proposal approve error:', error);
      return res.status(500).json({ error: 'Failed to approve proposal' });
    }
  },
);

// POST /api/v1/attendance/proposals/:id/reject - Reject proposal
router.post(
  '/proposals/:id/reject',
  authenticateToken,
  requireRole([Roles.HR_MANAGER, Roles.MD, Roles.ADMIN]),
  validateRequestBody(EmptyBodySchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const proposal = await p.attendanceProposal.findUnique({ where: { id } });
      if (!proposal) return res.status(404).json({ error: 'Proposal not found' });

      const updated = await p.attendanceProposal.update({
        where: { id },
        data: {
          status: 'REJECTED',
          reviewed_by: req.user!.employeeId,
          reviewed_at: new Date(),
        },
      });

      notifyEmployee(proposal.employee_id, {
        title: 'Proposal Rejected',
        message: `Your ${proposal.type === 'LEAVE' ? 'leave' : 'late'} request for ${new Date(proposal.target_date).toLocaleDateString()} has been rejected.`,
        type: 'SYSTEM',
        link: '/attendance',
      });

      return res.status(200).json({ message: 'Proposal rejected', proposal: updated });
    } catch (error) {
      logger.error('Proposal reject error:', error);
      return res.status(500).json({ error: 'Failed to reject proposal' });
    }
  },
);

// GET /api/v1/attendance/proposals/my - Employee's own proposals
router.get('/proposals/my', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const proposals = await p.attendanceProposal.findMany({
      where: { employee_id: req.user!.employeeId },
      orderBy: { created_at: 'desc' },
      take: 20,
    });

    return res.status(200).json({ proposals });
  } catch (error) {
    logger.error('My proposals error:', error);
    return res.status(500).json({ error: 'Failed to load my proposals' });
  }
});

export default router;
