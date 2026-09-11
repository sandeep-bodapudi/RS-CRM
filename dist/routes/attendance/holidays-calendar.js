"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("../../utils/logger");
const express_1 = require("express");
const prisma_1 = require("../../lib/prisma");
const auth_1 = require("../../middleware/auth");
const time_1 = require("../../utils/time");
const shared_1 = require("../../shared");
const validate_1 = require("../../middleware/validate");
const router = (0, express_1.Router)();
const p = prisma_1.prisma;
router.get('/holidays', auth_1.authenticateToken, async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const year = Number(req.query.year) || new Date().getFullYear();
        const holidays = await p.companyHoliday.findMany({
            where: {
                company_id: companyId,
                date: {
                    gte: new Date(`${year}-01-01T00:00:00Z`),
                    lte: new Date(`${year}-12-31T23:59:59Z`),
                },
            },
            orderBy: { date: 'asc' },
        });
        return res.status(200).json({ holidays });
    }
    catch (err) {
        return res.status(500).json({ error: 'Failed to fetch holidays' });
    }
});
// POST /api/v1/attendance/holidays
router.post('/holidays', auth_1.authenticateToken, (0, auth_1.requireRole)([shared_1.Roles.MD, shared_1.Roles.ADMIN, shared_1.Roles.HR_MANAGER]), (0, validate_1.validateRequestBody)(shared_1.AttendanceHolidaySchema), async (req, res) => {
    try {
        const { name, date } = req.body;
        if (!name || !date)
            return res.status(400).json({ error: 'Name and date are required' });
        const companyId = req.user.companyId;
        const istDate = new Date(`${date}T00:00:00Z`); // Stored as db.Date
        const h = await p.companyHoliday.create({
            data: {
                company_id: companyId,
                name,
                date: istDate,
            },
        });
        return res.status(201).json({ holiday: h });
    }
    catch (err) {
        return res.status(500).json({ error: 'Failed to create holiday' });
    }
});
// DELETE /api/v1/attendance/holidays/:id
router.delete('/holidays/:id', auth_1.authenticateToken, (0, auth_1.requireRole)([shared_1.Roles.MD, shared_1.Roles.ADMIN, shared_1.Roles.HR_MANAGER]), (0, validate_1.validateRequestBody)(shared_1.EmptyBodySchema), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const companyId = req.user.companyId;
        const h = await p.companyHoliday.findFirst({ where: { id, company_id: companyId } });
        if (!h)
            return res.status(404).json({ error: 'Holiday not found' });
        await p.companyHoliday.delete({ where: { id } });
        return res.status(200).json({ message: 'Deleted successfully' });
    }
    catch (err) {
        return res.status(500).json({ error: 'Failed to delete holiday' });
    }
});
router.get('/calendar', auth_1.authenticateToken, async (req, res) => {
    try {
        const year = Number(req.query.year);
        const month = Number(req.query.month);
        let targetEmployeeId = req.user.employeeId;
        if (req.query.employeeId) {
            const hrRoles = [shared_1.Roles.MD, shared_1.Roles.ADMIN, shared_1.Roles.HR_MANAGER];
            const isHR = req.user.roles?.some((r) => hrRoles.includes(r));
            if (!isHR)
                return res.status(403).json({ error: 'Not authorized to view other calendars' });
            targetEmployeeId = Number(req.query.employeeId);
        }
        if (!year || !month)
            return res.status(400).json({ error: 'year and month are required' });
        const startDate = new Date(`${year}-${month.toString().padStart(2, '0')}-01T00:00:00+05:30`);
        const endDate = new Date(startDate);
        endDate.setMonth(endDate.getMonth() + 1);
        const employee = await p.employee.findUnique({
            where: { id: targetEmployeeId },
            select: { created_at: true },
        });
        if (!employee)
            return res.status(404).json({ error: 'Employee not found' });
        const logs = await p.attendanceLog.findMany({
            where: {
                employee_id: targetEmployeeId,
                check_in_at: { gte: startDate, lt: endDate },
            },
            orderBy: { check_in_at: 'asc' },
        });
        const holidays = await p.companyHoliday.findMany({
            where: {
                company_id: req.user.companyId,
                date: { gte: startDate, lt: endDate },
            },
        });
        const proposals = await p.attendanceProposal.findMany({
            where: {
                employee_id: targetEmployeeId,
                type: { in: ['LATE_CHECKIN', 'LEAVE'] },
                status: 'APPROVED',
                target_date: { gte: startDate, lt: endDate },
            },
        });
        const calendarMap = {};
        const d = new Date(startDate);
        let totalLates = 0;
        let totalHalfDays = 0;
        const now = new Date();
        const { dateString: todayStr, hours: currentHour } = (0, time_1.getISTComponents)(now);
        while (d < endDate) {
            // Read the calendar day via getISTComponents, not local Date accessors
            // (.getFullYear()/.getMonth()/.getDate()) — those read the server
            // PROCESS's own local timezone, not IST, and on a non-IST server (e.g.
            // UTC-hosted production) silently shift every day-key by one. The
            // increment below (.setDate(d.getDate()+1)) is unaffected since it just
            // advances the instant by a fixed 24h step, whatever timezone reads it.
            const dayStr = (0, time_1.getISTComponents)(d).dateString;
            let defaultStatus = 'ABSENT';
            if (dayStr > todayStr) {
                defaultStatus = 'PENDING'; // Future dates
            }
            else if (dayStr === todayStr && currentHour < 18) {
                defaultStatus = 'PENDING'; // Today before 6 PM
            }
            calendarMap[dayStr] = { status: defaultStatus, log: null };
            if ((0, time_1.getISTDayOfWeek)(dayStr) === 0) {
                calendarMap[dayStr].status = 'HOLIDAY';
                calendarMap[dayStr].holidayName = 'Sunday';
            }
            d.setDate(d.getDate() + 1);
        }
        for (const h of holidays) {
            const dayStr = (0, time_1.getISTComponents)(new Date(h.date)).dateString;
            if (calendarMap[dayStr]) {
                calendarMap[dayStr].status = 'HOLIDAY';
                calendarMap[dayStr].holidayName = h.name;
            }
        }
        for (const p of proposals) {
            const dayStr = (0, time_1.getISTComponents)(new Date(p.target_date)).dateString;
            if (calendarMap[dayStr]) {
                if (p.type === 'LEAVE') {
                    calendarMap[dayStr].status = 'LEAVE';
                    calendarMap[dayStr].isLeave = true;
                }
                else if (p.type === 'LATE_CHECKIN') {
                    calendarMap[dayStr].hasApprovedLateProposal = true;
                }
            }
        }
        for (const l of logs) {
            const ld = new Date(l.check_in_at);
            const { dateString } = (0, time_1.getISTComponents)(ld);
            if (calendarMap[dateString]) {
                // If it was already marked as LEAVE from a proposal, we might still want to attach the log
                calendarMap[dateString].log = l;
                let adjustedStatus = l.status;
                if (calendarMap[dateString].hasApprovedLateProposal) {
                    adjustedStatus = 'PRESENT';
                }
                // If there's an actual punch, and they were on leave, maybe keep it as LEAVE or let the punch override?
                // Usually if they punch in, the punch status overrides. But let's check if it's LEAVE.
                if (calendarMap[dateString].isLeave) {
                    adjustedStatus = 'LEAVE';
                }
                calendarMap[dateString].status = adjustedStatus;
                if (adjustedStatus === 'LATE')
                    totalLates++;
                if (adjustedStatus === 'HALF_DAY')
                    totalHalfDays++;
            }
        }
        const penaltyAbsents = Math.floor(totalLates / 3) + Math.floor(totalHalfDays / 2);
        return res
            .status(200)
            .json({ calendar: calendarMap, penaltyAbsents, employeeCreatedAt: employee.created_at });
    }
    catch (err) {
        logger_1.logger.error('Failed to generate calendar:', err);
        return res.status(500).json({ error: 'Failed to generate calendar' });
    }
});
exports.default = router;
