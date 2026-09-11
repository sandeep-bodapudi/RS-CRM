"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("../utils/logger");
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
const auth_1 = require("../middleware/auth");
const shared_1 = require("../shared");
const performance_metric_1 = require("../services/performance-metric");
const time_1 = require("../utils/time");
const router = (0, express_1.Router)();
const p = prisma_1.prisma;
router.post('/reset-score-history', auth_1.authenticateToken, (0, auth_1.requireRole)([shared_1.Roles.ADMIN]), async (req, res) => {
    try {
        await p.auditEvent.deleteMany({});
        await p.dailyReport.deleteMany({});
        await p.attendanceLog.deleteMany({});
        await p.task.deleteMany({});
        await p.performanceSnapshot.deleteMany({});
        return res.status(200).json({ message: 'All account scores reset to clean 50.0 / 100+ pts successfully!' });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to reset score history' });
    }
});
router.get('/my-score', auth_1.authenticateToken, async (req, res) => {
    try {
        const employeeId = req.user.employeeId;
        const [istYear, istMonth] = (0, time_1.getISTComponents)().dateString.split('-').map(Number);
        const year = req.query.year ? Number(req.query.year) : istYear;
        const month = req.query.month ? Number(req.query.month) : istMonth;
        const { startOfMonth, endOfMonth } = (0, time_1.getISTMonthRange)(year, month);
        const taskEvents = await p.task.count({ where: { assignee_id: employeeId, status: 'COMPLETED', updated_at: { gte: startOfMonth, lte: endOfMonth } } });
        const reportEvents = await p.dailyReport.count({ where: { employee_id: employeeId, submitted_at: { gte: startOfMonth, lte: endOfMonth } } });
        const belowTargetEvents = await p.auditEvent.count({ where: { actor_id: employeeId, action: 'DAILY_REPORT_BELOW_TARGET', created_at: { gte: startOfMonth, lte: endOfMonth } } });
        const targetExceededEvents = await p.auditEvent.count({ where: { actor_id: employeeId, action: 'DAILY_REPORT_TARGET_EXCEEDED', created_at: { gte: startOfMonth, lte: endOfMonth } } });
        const overdueTasksCount = await p.task.count({ where: { assignee_id: employeeId, status: 'OVERDUE', updated_at: { gte: startOfMonth, lte: endOfMonth } } });
        const uninformedAbsentEvents = await p.auditEvent.count({ where: { actor_id: employeeId, action: 'UNINFORMED_ABSENT', created_at: { gte: startOfMonth, lte: endOfMonth } } });
        const propertyBookingContributions = await p.auditEvent.count({ where: { actor_id: employeeId, action: 'PROPERTY_BOOKED_CONTRIBUTION', created_at: { gte: startOfMonth, lte: endOfMonth } } });
        const attendanceLogs = await p.attendanceLog.findMany({
            where: { employee_id: employeeId, check_in_at: { gte: startOfMonth, lte: endOfMonth } },
            include: { employee: { select: { employment_type: true } } },
        });
        let presentCount = 0;
        let lateCount = 0;
        let halfDayCount = 0;
        let attendanceBoost = 0;
        for (const log of attendanceLogs) {
            if (log.status === 'PRESENT' || log.status === 'APPROVED_LATE')
                presentCount++;
            if (log.status === 'LATE')
                lateCount++;
            if (log.status === 'HALF_DAY')
                halfDayCount++;
            // Only PRESENT logs feed the boost here — LATE/HALF_DAY are still
            // penalized via lateCount/halfDayCount below (unchanged), and calling
            // calculateAttendancePoints on them too would double-count that
            // penalty. APPROVED_LATE/APPROVED_HALF_DAY correctly contribute 0 by
            // simply not being added anywhere, matching "no gain, no lose".
            if (log.status === 'PRESENT') {
                attendanceBoost += (0, time_1.calculateAttendancePoints)(log.status, log.check_in_at, log.employee.employment_type || 'FULL_TIME');
            }
        }
        const { score: totalScore, breakdown } = (0, performance_metric_1.calculatePerformanceScore)({
            completedTasks: taskEvents,
            overdueTasks: overdueTasksCount,
            dailyReports: reportEvents,
            belowTargetEvents,
            targetExceededEvents,
            uninformedAbsentEvents,
            propertyBookingContributions,
            presentCount,
            attendanceBoost,
            lateCount,
            halfDayCount,
        });
        return res.status(200).json({ employeeId, score: totalScore, breakdown });
    }
    catch (error) {
        logger_1.logger.error('Performance score calculation error:', error);
        return res.status(500).json({ error: 'Failed to calculate performance score' });
    }
});
router.get('/history', auth_1.authenticateToken, async (req, res) => {
    try {
        const employeeId = req.user.employeeId;
        const [istYear, istMonth] = (0, time_1.getISTComponents)().dateString.split('-').map(Number);
        const year = req.query.year ? Number(req.query.year) : istYear;
        const month = req.query.month ? Number(req.query.month) : istMonth;
        const { startOfMonth, endOfMonth } = (0, time_1.getISTMonthRange)(year, month);
        const events = [];
        events.push({
            id: 'base-50', action: 'INITIAL_BASE_SCORE', title: 'Initial Base Performance Index', points: 50.0, type: 'BOOST',
            description: 'Default starting performance index for all team members', timestamp: startOfMonth,
        });
        const completedTasks = await p.task.findMany({ where: { assignee_id: employeeId, status: 'COMPLETED', updated_at: { gte: startOfMonth, lte: endOfMonth } }, orderBy: { completed_at: 'desc' } });
        for (const t of completedTasks) {
            events.push({ id: `task-${t.id}`, action: 'TASK_COMPLETED', title: 'Task Completed', points: +2.0, type: 'BOOST', description: `Completed task: "${t.title}"`, timestamp: t.completed_at || t.updated_at });
        }
        const overdueTasks = await p.task.findMany({ where: { assignee_id: employeeId, status: 'OVERDUE', updated_at: { gte: startOfMonth, lte: endOfMonth } }, orderBy: { updated_at: 'desc' } });
        for (const t of overdueTasks) {
            events.push({ id: `task-od-${t.id}`, action: 'TASK_OVERDUE', title: 'Task Overdue', points: -1.0, type: 'PENALTY', description: `Overdue task: "${t.title}"`, timestamp: t.updated_at });
        }
        const dailyReports = await p.dailyReport.findMany({ where: { employee_id: employeeId, submitted_at: { gte: startOfMonth, lte: endOfMonth } }, orderBy: { submitted_at: 'desc' } });
        for (const r of dailyReports) {
            events.push({ id: `report-${r.id}`, action: 'DAILY_REPORT_SUBMIT', title: 'Daily Report Submitted', points: +0.5, type: 'BOOST', description: 'Submitted EOD report', timestamp: r.submitted_at });
        }
        const auditEvents = await p.auditEvent.findMany({ where: { actor_id: employeeId, created_at: { gte: startOfMonth, lte: endOfMonth } }, orderBy: { created_at: 'desc' } });
        for (const b of auditEvents) {
            if (b.action === 'DAILY_REPORT_BELOW_TARGET') {
                events.push({ id: `bt-${b.id}`, action: b.action, title: 'Sub-Target Log Penalty', points: -1.0, type: 'PENALTY', description: 'Submitted daily report below assigned target', timestamp: b.created_at });
            }
            else if (b.action === 'DAILY_REPORT_TARGET_EXCEEDED') {
                events.push({ id: `te-${b.id}`, action: b.action, title: 'Target Exceeded', points: +0.5, type: 'BOOST', description: 'Submitted daily report exceeding targets', timestamp: b.created_at });
            }
            else if (b.action === 'UNINFORMED_ABSENT') {
                events.push({ id: `ua-${b.id}`, action: b.action, title: 'Uninformed Absence', points: -2.0, type: 'PENALTY', description: 'Absent without prior approval', timestamp: b.created_at });
            }
            else if (b.action === 'PROPERTY_BOOKED_CONTRIBUTION') {
                events.push({ id: `bk-${b.id}`, action: b.action, title: 'Lead Converted to Booking', points: +10.0, type: 'BOOST', description: b.reason || 'Contributed to a Lead that converted to a Booking', timestamp: b.created_at });
            }
        }
        const attendanceLogs = await p.attendanceLog.findMany({
            where: { employee_id: employeeId, check_in_at: { gte: startOfMonth, lte: endOfMonth } },
            include: { employee: { select: { employment_type: true } } },
        });
        for (const log of attendanceLogs) {
            const ts = log.check_in_at || new Date();
            if (log.status === 'LATE') {
                events.push({ id: `att-late-${log.id}`, action: 'LATE_CHECKIN', title: 'Late Check-In Penalty', points: -1.0, type: 'PENALTY', description: 'Check-in recorded late', timestamp: ts });
            }
            else if (log.status === 'HALF_DAY') {
                events.push({ id: `att-hd-${log.id}`, action: 'HALF_DAY_CHECKIN', title: 'Half Day Check-In Penalty', points: -1.0, type: 'PENALTY', description: 'Check-in recorded after 11:30 AM', timestamp: ts });
            }
            else if (log.status === 'APPROVED_LATE') {
                // § Phase 4: an approval means "not penalized", not "still earns the
                // on-time bonus" — this used to be lumped in with PRESENT at +0.5.
                events.push({ id: `att-apl-${log.id}`, action: 'APPROVED_LATE_CHECKIN', title: 'Approved Late Check-In', points: 0.0, type: 'NEUTRAL', description: 'Late check-in was approved — no gain, no penalty', timestamp: ts });
            }
            else if (log.status === 'APPROVED_HALF_DAY') {
                events.push({ id: `att-aphd-${log.id}`, action: 'APPROVED_HALF_DAY_CHECKIN', title: 'Approved Half-Day Check-In', points: 0.0, type: 'NEUTRAL', description: 'Half-day check-in was approved — no gain, no penalty', timestamp: ts });
            }
            else if (log.status === 'PRESENT') {
                const points = (0, time_1.calculateAttendancePoints)(log.status, log.check_in_at, log.employee.employment_type || 'FULL_TIME');
                const title = points >= 1.0 ? 'Early Check-In' : points >= 0.5 ? 'On-Time Check-In (Grace Period)' : 'On-Time Check-In';
                events.push({ id: `att-present-${log.id}`, action: 'PRESENT_CHECKIN', title, points, type: points > 0 ? 'BOOST' : 'NEUTRAL', description: 'Checked in before the 10:30 AM cutoff', timestamp: ts });
            }
        }
        events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        return res.status(200).json({ events });
    }
    catch (error) {
        logger_1.logger.error('Fetch performance history error:', error);
        return res.status(500).json({ error: 'Failed to fetch performance history' });
    }
});
router.get('/team', auth_1.authenticateToken, async (req, res) => {
    try {
        const roles = req.user.roles;
        const isMD = roles.includes(shared_1.Roles.MD);
        const isAdmin = roles.includes(shared_1.Roles.ADMIN);
        const isHR = roles.includes(shared_1.Roles.HR_MANAGER);
        const hasTeamPermission = (req.user.permissions || []).includes(shared_1.Permissions.PERFORMANCE_READ_TEAM);
        const canViewTeam = hasTeamPermission || isAdmin;
        if (!canViewTeam)
            return res.status(403).json({ error: 'Access denied: Manager or above permission required.' });
        const whereClause = { company_id: req.user.companyId, deleted_at: null, roles: { none: { role: { is_invisible: true } } } };
        if (!isMD && !isAdmin && !isHR)
            whereClause.reporting_manager_id = req.user.employeeId;
        const [istYear, istMonth] = (0, time_1.getISTComponents)().dateString.split('-').map(Number);
        const year = req.query.year ? Number(req.query.year) : istYear;
        const month = req.query.month ? Number(req.query.month) : istMonth;
        const { startOfMonth, endOfMonth } = (0, time_1.getISTMonthRange)(year, month);
        const employees = await p.employee.findMany({ where: whereClause, include: { branch: true, roles: { include: { role: true } } }, orderBy: { employee_code: 'asc' } });
        const teamScores = await Promise.all(employees.map(async (emp) => {
            const [tasksDone, tasksOverdue, reportsDone, belowTargetCount, targetExceededEvents, attendanceLogs, uninformedAbsent, propertyBookingContributions] = await Promise.all([
                p.task.count({ where: { assignee_id: emp.id, status: 'COMPLETED', updated_at: { gte: startOfMonth, lte: endOfMonth } } }),
                p.task.count({ where: { assignee_id: emp.id, status: 'OVERDUE', updated_at: { gte: startOfMonth, lte: endOfMonth } } }),
                p.dailyReport.count({ where: { employee_id: emp.id, submitted_at: { gte: startOfMonth, lte: endOfMonth } } }),
                p.auditEvent.count({ where: { actor_id: emp.id, action: 'DAILY_REPORT_BELOW_TARGET', created_at: { gte: startOfMonth, lte: endOfMonth } } }),
                p.auditEvent.count({ where: { actor_id: emp.id, action: 'DAILY_REPORT_TARGET_EXCEEDED', created_at: { gte: startOfMonth, lte: endOfMonth } } }),
                p.attendanceLog.findMany({ where: { employee_id: emp.id, check_in_at: { gte: startOfMonth, lte: endOfMonth } }, select: { status: true, check_in_at: true } }),
                p.auditEvent.count({ where: { actor_id: emp.id, action: 'UNINFORMED_ABSENT', created_at: { gte: startOfMonth, lte: endOfMonth } } }),
                p.auditEvent.count({ where: { actor_id: emp.id, action: 'PROPERTY_BOOKED_CONTRIBUTION', created_at: { gte: startOfMonth, lte: endOfMonth } } }),
            ]);
            let presentCount = 0;
            let lateCount = 0;
            let halfDayCount = 0;
            let attendanceBoost = 0;
            for (const log of attendanceLogs) {
                if (log.status === 'PRESENT' || log.status === 'APPROVED_LATE')
                    presentCount++;
                else if (log.status === 'LATE')
                    lateCount++;
                else if (log.status === 'HALF_DAY')
                    halfDayCount++;
                // Only PRESENT feeds the boost — LATE/HALF_DAY stay penalized via
                // lateCount/halfDayCount below; adding calculateAttendancePoints's
                // -1.0 for those here too would double-count the penalty.
                if (log.status === 'PRESENT') {
                    attendanceBoost += (0, time_1.calculateAttendancePoints)(log.status, log.check_in_at, emp.employment_type || 'FULL_TIME');
                }
            }
            const { score, breakdown } = (0, performance_metric_1.calculatePerformanceScore)({
                completedTasks: tasksDone,
                overdueTasks: tasksOverdue,
                dailyReports: reportsDone,
                belowTargetEvents: belowTargetCount,
                targetExceededEvents,
                uninformedAbsentEvents: uninformedAbsent,
                propertyBookingContributions,
                presentCount,
                attendanceBoost,
                lateCount,
                halfDayCount,
            });
            return {
                id: emp.id, employeeCode: emp.employee_code, fullName: emp.full_name || emp.employee_code, branch: emp.branch?.name || '—',
                roles: emp.roles.map((r) => r.role.name), score,
                breakdown: { tasksDone, tasksOverdue, reportsDone, belowTargetCount, targetExceededEvents, presentCount, lateCount, halfDayCount, uninformedAbsent, propertyBookingContributions },
                zone: score >= 86 ? 'EXCELLENT' : score >= 66 ? 'SAFE' : score >= 41 ? 'SATISFACTORY' : 'DANGER',
            };
        }));
        teamScores.sort((a, b) => b.score - a.score);
        return res.status(200).json({ team: teamScores, total: teamScores.length });
    }
    catch (error) {
        logger_1.logger.error('Team performance error:', error);
        return res.status(500).json({ error: 'Failed to fetch team performance' });
    }
});
router.get('/telecaller-metrics', auth_1.authenticateToken, async (req, res) => {
    try {
        const { telecallerId, startDate, endDate } = req.query;
        const start = startDate ? new Date(startDate) : new Date(new Date().setDate(1)); // Default to start of month
        const end = endDate ? new Date(endDate) : new Date();
        const tId = telecallerId ? parseInt(telecallerId, 10) : undefined;
        // In production, add authorization to verify they are allowed to check this user
        const { PerformanceTrackingService } = await Promise.resolve().then(() => __importStar(require('../services/performanceTracking.service')));
        const metrics = await PerformanceTrackingService.getTelecallerMetrics(req.user, start, end, tId);
        return res.status(200).json({ metrics });
    }
    catch (error) {
        logger_1.logger.error('Fetch telecaller metrics error:', error);
        return res.status(500).json({ error: 'Failed to fetch telecaller metrics' });
    }
});
router.get('/pm-metrics', auth_1.authenticateToken, async (req, res) => {
    try {
        const { pmId, startDate, endDate } = req.query;
        const start = startDate ? new Date(startDate) : new Date(new Date().setDate(1));
        const end = endDate ? new Date(endDate) : new Date();
        const pId = pmId ? parseInt(pmId, 10) : undefined;
        // In production, add authorization checks
        const { PerformanceTrackingService } = await Promise.resolve().then(() => __importStar(require('../services/performanceTracking.service')));
        const metrics = await PerformanceTrackingService.getPmMetrics(req.user, start, end, pId);
        return res.status(200).json({ metrics });
    }
    catch (error) {
        logger_1.logger.error('Fetch pm metrics error:', error);
        return res.status(500).json({ error: 'Failed to fetch pm metrics' });
    }
});
// --- Achievements Endpoint ---
router.get('/achievements', auth_1.authenticateToken, async (req, res) => {
    try {
        const isMDOrAdmin = req.user.roles.includes(shared_1.Roles.MD) ||
            req.user.roles.includes(shared_1.Roles.ADMIN) ||
            req.user.roles.includes(shared_1.Roles.MARKETING_DIRECTOR);
        const targetEmployeeId = (isMDOrAdmin && req.query.employeeId && req.query.employeeId !== 'ALL')
            ? Number(req.query.employeeId)
            : (req.query.employeeId === 'ALL' ? 'ALL' : req.user.employeeId);
        const getStatsForEmployee = async (empId) => {
            // 1. Leads Sourced
            const leadsSourced = await p.lead.count({ where: { created_by_id: empId } });
            // 2. Site Visits Scheduled (Telecaller)
            const siteVisitsScheduled = await p.siteVisitBooking.count({ where: { telecaller_id: empId } });
            // 3. Site Visits Executed (PM)
            const siteVisitsExecuted = await p.siteVisitBooking.count({ where: { project_manager_id: empId, status: 'COMPLETED' } });
            // 4. Deals Closed (Booking Assigned Employee)
            const dealsClosed = await p.booking.count({ where: { assigned_employee_id: empId, status: { not: 'CANCELLED' } } });
            // 5. Assisted Conversions
            const assistedBookings = await p.booking.findMany({
                where: {
                    assigned_employee_id: { not: empId },
                    status: { not: 'CANCELLED' },
                    customer: {
                        origin_lead: {
                            OR: [
                                { created_by_id: empId },
                                { assigned_to_id: empId },
                                {
                                    site_visits: {
                                        some: {
                                            OR: [
                                                { telecaller_id: empId },
                                                { project_manager_id: empId },
                                                { assigned_agent_id: empId }
                                            ]
                                        }
                                    }
                                }
                            ]
                        }
                    }
                },
                select: { id: true }
            });
            const assistedConversions = assistedBookings.length;
            return {
                employeeId: empId,
                leadsSourced,
                siteVisitsScheduled,
                siteVisitsExecuted,
                dealsClosed,
                assistedConversions
            };
        };
        if (targetEmployeeId === 'ALL') {
            if (!isMDOrAdmin)
                return res.status(403).json({ error: 'Forbidden' });
            const allEmployees = await p.employee.findMany({
                where: { status: 'ACTIVE' },
                select: { id: true, full_name: true, employee_code: true, roles: true, profile_image_url: true }
            });
            const leaderboard = await Promise.all(allEmployees.map(async (emp) => {
                const stats = await getStatsForEmployee(emp.id);
                return {
                    ...emp,
                    ...stats
                };
            }));
            leaderboard.sort((a, b) => b.dealsClosed - a.dealsClosed || b.assistedConversions - a.assistedConversions || b.siteVisitsExecuted - a.siteVisitsExecuted);
            return res.status(200).json({ leaderboard });
        }
        else {
            const stats = await getStatsForEmployee(targetEmployeeId);
            return res.status(200).json(stats);
        }
    }
    catch (error) {
        logger_1.logger.error('Achievements fetch error:', error);
        return res.status(500).json({ error: 'Failed to fetch achievements' });
    }
});
exports.default = router;
