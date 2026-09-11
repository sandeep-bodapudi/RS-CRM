"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("../utils/logger");
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
const auth_1 = require("../middleware/auth");
const authz_1 = require("../middleware/authz");
const shared_1 = require("../shared");
const analytics_service_1 = require("../services/analytics.service");
const router = (0, express_1.Router)();
const p = prisma_1.prisma;
// GET /api/v1/md/employees - List employees for MD Control (Admin filtered out)
router.get('/employees', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.EMPLOYEES_READ), async (req, res, next) => {
    try {
        const employees = await p.employee.findMany({
            where: {
                // Packet D (15-16): company-scoped to req.user.companyId
                company_id: req.user.companyId,
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
        const formatted = employees.map((emp) => ({
            id: emp.id,
            employeeCode: emp.employee_code,
            fullName: emp.full_name || emp.employee_code,
            company: emp.company.name,
            branch: emp.branch?.name || 'All Branches',
            roles: emp.roles.map((r) => r.role.name),
            status: emp.status,
            attendanceRequired: emp.attendance_required,
            firstLoginDone: emp.first_login_done,
        }));
        return res.status(200).json({ employees: formatted });
    }
    catch (error) {
        logger_1.logger.error('MD employees fetch error:', error);
        return res.status(500).json({ error: 'Failed to fetch employee list' });
    }
});
// PATCH /api/v1/md/employees/:id/attendance-requirement - Toggle attendance requirement
router.patch('/employees/:id/attendance-requirement', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.EMPLOYEES_UPDATE), async (req, res, next) => {
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
        if (existing.roles.some((r) => r.role.is_invisible)) {
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
    }
    catch (error) {
        next(error);
    }
});
// GET /api/v1/md/executive-metrics - Real DB Metrics Aggregator for MD Executive Dashboard
// Delegates to the centralized AnalyticsService (Phase 16 Packet B extraction) so the
// KPI calculations are shared with /api/v1/analytics/kpis. The flat response contract
// below is preserved EXACTLY (same field names) - this is behavior-preserving.
router.get('/executive-metrics', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.ADMIN_SYSTEM_METRICS), async (req, res, next) => {
    try {
        const companyId = req.user?.companyId || 1;
        const metrics = await analytics_service_1.AnalyticsService.getExecutiveMetrics(companyId);
        return res.status(200).json(metrics);
    }
    catch (error) {
        logger_1.logger.error('Fetch executive metrics error:', error);
        return res.status(500).json({ error: 'Failed to fetch executive metrics' });
    }
});
// GET /api/v1/md/recent-activity - Portal-wide activity feed for the MD dashboard
router.get('/recent-activity', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.ADMIN_SYSTEM_METRICS), async (req, res, next) => {
    try {
        const companyId = req.user?.companyId || 1;
        const activity = await analytics_service_1.AnalyticsService.getRecentActivity(companyId);
        return res.status(200).json({ activity });
    }
    catch (error) {
        logger_1.logger.error('Fetch recent activity error:', error);
        return res.status(500).json({ error: 'Failed to fetch recent activity' });
    }
});
exports.default = router;
