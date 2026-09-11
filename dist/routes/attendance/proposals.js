"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("../../utils/logger");
const express_1 = require("express");
const prisma_1 = require("../../lib/prisma");
const auth_1 = require("../../middleware/auth");
const time_1 = require("../../utils/time");
const shared_1 = require("../../shared");
const validate_1 = require("../../middleware/validate");
const notifyEmployee_1 = require("../../utils/notifyEmployee");
const router = (0, express_1.Router)();
const p = prisma_1.prisma;
// POST /api/v1/attendance/late-proposal - Submit late proposal (< 09:30 AM IST)
router.post('/late-proposal', auth_1.authenticateToken, (0, validate_1.validateRequestBody)(shared_1.LateProposalSchema), async (req, res) => {
    try {
        const { hours, minutes } = (0, time_1.getISTComponents)(new Date());
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
                employee_id: req.user.employeeId,
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
                actor_id: req.user.employeeId,
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
    }
    catch (error) {
        logger_1.logger.error('Late proposal error:', error);
        return res
            .status(500)
            .json({ error: 'Failed to submit late proposal', detail: error?.message });
    }
});
// POST /api/v1/attendance/leave-proposal - Submit leave proposal
router.post('/leave-proposal', auth_1.authenticateToken, (0, validate_1.validateRequestBody)(shared_1.LeaveProposalSchema), async (req, res) => {
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
                employee_id: req.user.employeeId,
                type: 'LEAVE',
                target_date: new Date(`${start_date}T00:00:00+05:30`),
                reason: reason,
                status: 'PENDING',
            },
        });
        // Write AuditEvent so the HR approval queue can surface it
        await p.auditEvent.create({
            data: {
                actor_id: req.user.employeeId,
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
    }
    catch (error) {
        logger_1.logger.error('Leave proposal error:', error);
        return res
            .status(500)
            .json({ error: 'Failed to submit leave proposal', detail: error?.message });
    }
});
// POST /api/v1/attendance/early-logout-proposal - Submit emergency early logout
router.post('/early-logout-proposal', auth_1.authenticateToken, (0, validate_1.validateRequestBody)(shared_1.LateProposalSchema), // Reusing LateProposalSchema since it has date, expected_time, reason
async (req, res) => {
    try {
        // Record proposal in AttendanceProposal table
        const proposal = await p.attendanceProposal.create({
            data: {
                employee_id: req.user.employeeId,
                type: 'EARLY_CHECKOUT',
                target_date: new Date(`${req.body.date}T${req.body.expected_time}:00+05:30`),
                reason: req.body.reason,
                status: 'APPROVED', // Auto-approved for emergencies
            },
        });
        // Write AuditEvent so HR sees it
        await p.auditEvent.create({
            data: {
                actor_id: req.user.employeeId,
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
            message: 'Emergency logout request recorded successfully. You may now scan out at the Kiosk.',
            proposalId: proposal.id,
        });
    }
    catch (error) {
        logger_1.logger.error('Early logout proposal error:', error);
        return res
            .status(500)
            .json({ error: 'Failed to submit emergency logout request', detail: error?.message });
    }
});
// GET /api/v1/attendance/proposals/queue - HR Manager approval queue
router.get('/proposals/queue', auth_1.authenticateToken, (0, auth_1.requireRole)([shared_1.Roles.HR_MANAGER, shared_1.Roles.MD, shared_1.Roles.ADMIN]), async (req, res) => {
    try {
        const companyEmployees = await p.employee.findMany({
            where: { company_id: req.user.companyId },
            select: { id: true, full_name: true, employee_code: true },
        });
        const proposals = await p.attendanceProposal.findMany({
            where: {
                employee_id: { in: companyEmployees.map((e) => e.id) },
                status: 'PENDING',
            },
            orderBy: { created_at: 'desc' },
        });
        const mappedProposals = proposals.map((proposal) => {
            const emp = companyEmployees.find((e) => e.id === proposal.employee_id);
            return {
                ...proposal,
                employee: emp,
            };
        });
        return res.status(200).json({ proposals: mappedProposals });
    }
    catch (error) {
        logger_1.logger.error('Proposal queue error:', error);
        return res.status(500).json({ error: 'Failed to load HR proposal queue' });
    }
});
// GET /api/v1/attendance/proposals/history - HR Manager approval history
router.get('/proposals/history', auth_1.authenticateToken, (0, auth_1.requireRole)([shared_1.Roles.HR_MANAGER, shared_1.Roles.MD, shared_1.Roles.ADMIN]), async (req, res) => {
    try {
        const companyEmployees = await p.employee.findMany({
            where: { company_id: req.user.companyId },
            select: { id: true, full_name: true, employee_code: true },
        });
        const proposals = await p.attendanceProposal.findMany({
            where: {
                employee_id: { in: companyEmployees.map((e) => e.id) },
                status: { in: ['APPROVED', 'REJECTED'] },
            },
            orderBy: { reviewed_at: 'desc' },
            take: 100, // Limit to recent 100 to avoid huge payloads
        });
        const mappedProposals = proposals.map((proposal) => {
            const emp = companyEmployees.find((e) => e.id === proposal.employee_id);
            return {
                ...proposal,
                employee: emp,
            };
        });
        return res.status(200).json({ proposals: mappedProposals });
    }
    catch (error) {
        logger_1.logger.error('Proposal history error:', error);
        return res.status(500).json({ error: 'Failed to load HR proposal history' });
    }
});
// POST /api/v1/attendance/proposals/:id/approve - Approve proposal (changes attendance status, e.g. LATE -> PRESENT)
router.post('/proposals/:id/approve', auth_1.authenticateToken, (0, auth_1.requireRole)([shared_1.Roles.MD, shared_1.Roles.ADMIN]), (0, validate_1.validateRequestBody)(shared_1.EmptyBodySchema), async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const proposal = await p.attendanceProposal.findUnique({ where: { id } });
        if (!proposal)
            return res.status(404).json({ error: 'Proposal not found' });
        const updated = await p.attendanceProposal.update({
            where: { id },
            data: {
                status: 'APPROVED',
                reviewed_by: req.user.employeeId,
                reviewed_at: new Date(),
            },
        });
        if (updated.type === 'LATE_CHECKIN') {
            const targetDate = new Date(updated.target_date);
            const { dateString } = (0, time_1.getISTComponents)(targetDate);
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
                    const newStatus = (0, time_1.calculateAttendanceStatus)(existingLog.check_in_at, true, emp.employment_type || 'FULL_TIME');
                    if (newStatus !== existingLog.status) {
                        await p.attendanceLog.update({
                            where: { id: existingLog.id },
                            data: { status: newStatus },
                        });
                    }
                }
            }
        }
        (0, notifyEmployee_1.notifyEmployee)(proposal.employee_id, {
            title: 'Proposal Approved',
            message: `Your ${proposal.type === 'LEAVE' ? 'leave' : 'late'} request for ${new Date(proposal.target_date).toLocaleDateString()} has been approved.`,
            type: 'SYSTEM',
            link: '/attendance',
        });
        return res.status(200).json({ message: 'Proposal approved', proposal: updated });
    }
    catch (error) {
        logger_1.logger.error('Proposal approve error:', error);
        return res.status(500).json({ error: 'Failed to approve proposal' });
    }
});
// POST /api/v1/attendance/proposals/:id/reject - Reject proposal (changes attendance status)
router.post('/proposals/:id/reject', auth_1.authenticateToken, (0, auth_1.requireRole)([shared_1.Roles.MD, shared_1.Roles.ADMIN]), (0, validate_1.validateRequestBody)(shared_1.EmptyBodySchema), async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const proposal = await p.attendanceProposal.findUnique({ where: { id } });
        if (!proposal)
            return res.status(404).json({ error: 'Proposal not found' });
        const updated = await p.attendanceProposal.update({
            where: { id },
            data: {
                status: 'REJECTED',
                reviewed_by: req.user.employeeId,
                reviewed_at: new Date(),
            },
        });
        (0, notifyEmployee_1.notifyEmployee)(proposal.employee_id, {
            title: 'Proposal Rejected',
            message: `Your ${proposal.type === 'LEAVE' ? 'leave' : 'late'} request for ${new Date(proposal.target_date).toLocaleDateString()} has been rejected.`,
            type: 'SYSTEM',
            link: '/attendance',
        });
        return res.status(200).json({ message: 'Proposal rejected', proposal: updated });
    }
    catch (error) {
        logger_1.logger.error('Proposal reject error:', error);
        return res.status(500).json({ error: 'Failed to reject proposal' });
    }
});
// GET /api/v1/attendance/proposals/my - Employee's own proposals
router.get('/proposals/my', auth_1.authenticateToken, async (req, res) => {
    try {
        const proposals = await p.attendanceProposal.findMany({
            where: { employee_id: req.user.employeeId },
            orderBy: { created_at: 'desc' },
            take: 20,
        });
        return res.status(200).json({ proposals });
    }
    catch (error) {
        logger_1.logger.error('My proposals error:', error);
        return res.status(500).json({ error: 'Failed to load my proposals' });
    }
});
exports.default = router;
