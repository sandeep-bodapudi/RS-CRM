"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("../../utils/logger");
const express_1 = require("express");
const prisma_1 = require("../../lib/prisma");
const auth_1 = require("../../middleware/auth");
const time_1 = require("../../utils/time");
const shared_1 = require("../../shared");
const router = (0, express_1.Router)();
const p = prisma_1.prisma;
// GET /api/v1/attendance/live - HR Live Attendance Feed (Today only)
router.get('/live', auth_1.authenticateToken, (0, auth_1.requireRole)([shared_1.Roles.HR_MANAGER, shared_1.Roles.MD, shared_1.Roles.ADMIN]), async (req, res) => {
    try {
        const { dateString } = (0, time_1.getISTComponents)(new Date());
        // Fetch all attendance logs that occurred today
        const allLogs = await p.attendanceLog.findMany({
            where: { employee: { company_id: req.user.companyId } },
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
        const todayLogs = allLogs.filter((l) => {
            if (!l.check_in_at)
                return false;
            return (0, time_1.getISTComponents)(new Date(l.check_in_at)).dateString === dateString;
        });
        return res.status(200).json({ logs: todayLogs });
    }
    catch (error) {
        logger_1.logger.error('Live attendance error:', error);
        return res.status(500).json({ error: 'Failed to load live attendance' });
    }
});
// GET /api/v1/attendance/history - HR Paginated Historical Attendance
router.get('/history', auth_1.authenticateToken, (0, auth_1.requireRole)([shared_1.Roles.HR_MANAGER, shared_1.Roles.MD, shared_1.Roles.ADMIN]), async (req, res) => {
    try {
        const { search, status, startDate, endDate, page = '1', limit = '50' } = req.query;
        const skip = (Number(page) - 1) * Number(limit);
        const whereClause = {
            employee: {
                company_id: req.user.companyId,
                ...(search && {
                    OR: [
                        { full_name: { contains: search } },
                        { employee_code: { contains: search } },
                    ],
                }),
            },
        };
        if (status) {
            whereClause.status = status;
        }
        if (startDate || endDate) {
            whereClause.check_in_at = {};
            if (startDate)
                whereClause.check_in_at.gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
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
    }
    catch (error) {
        logger_1.logger.error('History attendance error:', error);
        return res.status(500).json({ error: 'Failed to load attendance history' });
    }
});
exports.default = router;
