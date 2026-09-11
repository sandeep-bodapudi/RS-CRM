"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("../utils/logger");
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const shared_1 = require("../shared");
const notifyEmployee_1 = require("../utils/notifyEmployee");
const authz_1 = require("../middleware/authz");
const authorization_1 = require("../authz/authorization");
const hierarchy_1 = require("../utils/hierarchy");
const task_sla_status_1 = require("../services/task-sla.status");
const router = (0, express_1.Router)();
const p = prisma_1.prisma;
// GET /api/v1/tasks/all-team-tasks - MD & Management View of All Employee Tasks
router.get('/all-team-tasks', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.REPORTS_READ_TEAM), async (req, res, next) => {
    try {
        const now = new Date();
        const companyId = req.user.companyId;
        // Auto-flip past target date tasks to OVERDUE & send alerts to MD & Dept Head
        const newlyOverdue = await p.task.findMany({
            where: {
                status: { in: ['PENDING', 'IN_PROGRESS'] },
                target_date: { lt: now },
                assignee: { company_id: companyId },
            },
            include: { assignee: { select: { id: true, employee_code: true, full_name: true, company_id: true } } },
        });
        for (const t of newlyOverdue) {
            await p.task.update({
                where: { id: t.id },
                data: { status: 'OVERDUE' },
            });
            // Send alert to MD / System Admin & Assignee (same company as the task)
            const mdEmp = await p.employee.findFirst({
                where: {
                    company_id: companyId,
                    roles: { some: { role: { name: shared_1.Roles.MD } } },
                },
            });
            if (mdEmp) {
                await p.notification.create({
                    data: {
                        employee_id: mdEmp.id,
                        title: '🚨 OVERDUE TASK ALERT',
                        message: `Task "${t.title}" assigned to ${t.assignee?.employee_code || 'staff'} is past deadline! Please contact employee to clarify.`,
                        type: 'TASK_OVERDUE',
                    },
                });
            }
        }
        const allTasks = await p.task.findMany({
            where: { assignee: { company_id: companyId } },
            include: { assignee: { select: { id: true, employee_code: true, full_name: true } } },
            orderBy: [{ target_date: 'asc' }],
        });
        return res.status(200).json({ tasks: allTasks });
    }
    catch (error) {
        logger_1.logger.error('Fetch all team tasks error:', error);
        return res.status(500).json({ error: 'Failed to fetch team tasks' });
    }
});
// GET /api/v1/tasks/my-tasks - List assigned tasks with auto-overdue check
router.get('/my-tasks', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const employeeId = req.user.employeeId;
        const now = new Date();
        // Auto-flip tasks to OVERDUE if past target_date
        await p.task.updateMany({
            where: {
                assignee_id: employeeId,
                status: { in: ['PENDING', 'IN_PROGRESS'] },
                target_date: { lt: now },
            },
            data: { status: 'OVERDUE' },
        });
        const tasks = await p.task.findMany({
            where: { assignee_id: employeeId },
            orderBy: [{ target_date: 'asc' }],
        });
        return res.status(200).json({ tasks });
    }
    catch (error) {
        logger_1.logger.error('Fetch tasks error:', error);
        return res.status(500).json({ error: 'Failed to fetch tasks' });
    }
});
// POST /api/v1/tasks - Create new task
router.post('/', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.TASKS_CREATE), (0, validate_1.validateRequestBody)(shared_1.TaskCreateSchema), async (req, res, next) => {
    try {
        const { title, description, assignee_id, priority, deadline, lead_id, opportunity_id } = req.body;
        const creatorId = req.user.employeeId;
        // Validate Assignee Company Isolation
        const assignee = await p.employee.findFirst({ where: { id: assignee_id, company_id: req.user.companyId } });
        if (!assignee) {
            return res.status(400).json({ error: 'Assignee not found or outside your company.' });
        }
        // Validate Lead Access if lead_id is provided
        if (lead_id) {
            const existingLead = await p.lead.findFirst({ where: { id: lead_id, } });
            if (!existingLead) {
                return res.status(404).json({ error: 'Lead not found.' });
            }
            if (!(0, authorization_1.can)(req.user, shared_1.Permissions.LEADS_UPDATE, existingLead)) {
                return res.status(403).json({ error: 'Forbidden: You do not have permission to attach tasks to this lead.' });
            }
        }
        // Validate Opportunity Access if opportunity_id is provided
        if (opportunity_id) {
            const existingOpp = await p.opportunity.findFirst({ where: { id: opportunity_id, company_id: req.user.companyId } });
            if (!existingOpp) {
                return res.status(404).json({ error: 'Opportunity not found.' });
            }
            if (lead_id && existingOpp.lead_id !== lead_id) {
                return res.status(400).json({ error: 'Opportunity does not belong to the specified Lead.' });
            }
        }
        const task = await p.task.create({
            data: {
                title,
                description,
                assignee_id,
                created_by: creatorId,
                status: 'PENDING',
                target_date: deadline ? new Date(deadline) : new Date(Date.now() + 86400000),
                lead_id: lead_id || null,
                opportunity_id: opportunity_id || null,
            },
        });
        // Notify assignee via universal notifier (in-app + push)
        await (0, notifyEmployee_1.notifyEmployee)(assignee_id, {
            type: 'TASK_ASSIGNED',
            title: '📋 New Task Assigned to You',
            message: `Task "${title}" has been assigned to you. Deadline: ${new Date(task.target_date).toLocaleDateString('en-IN')}.`,
            link: '/tasks',
        });
        return res.status(201).json({ message: 'Task created successfully', task });
    }
    catch (error) {
        logger_1.logger.error('Create task error:', error);
        return res.status(500).json({ error: 'Failed to create task' });
    }
});
// GET /api/v1/tasks/:id/sla - Read SLA status for a Task (Phase 15 V1)
router.get('/:id/sla', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const taskId = parseInt(req.params.id, 10);
        if (isNaN(taskId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        if (isNaN(taskId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        if (isNaN(taskId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        if (isNaN(taskId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        // Locate the Task within the user's company scope
        const task = await p.task.findFirst({
            where: { id: taskId, assignee: { company_id: req.user.companyId } },
        });
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }
        // Call deriveTaskSlaStatus using existing helper
        const slaStatus = (0, task_sla_status_1.deriveTaskSlaStatus)({
            status: task.status,
            target_date: task.target_date,
            completed_at: task.completed_at,
        }, new Date());
        return res.status(200).json({
            task_id: task.id,
            target_date: task.target_date,
            completed_at: task.completed_at,
            status: task.status,
            sla_status: slaStatus,
        });
    }
    catch (error) {
        logger_1.logger.error('Read task SLA error:', error);
        return res.status(500).json({ error: 'Failed to read task SLA status' });
    }
});
// PATCH /api/v1/tasks/:id/status - Update Task Status & Cheer-up Event
router.patch('/:id/status', auth_1.authenticateToken, (0, authz_1.requireAuthz)(shared_1.Permissions.TASKS_UPDATE), (0, validate_1.validateRequestBody)(shared_1.TaskUpdateStatusSchema), async (req, res, next) => {
    try {
        const taskId = parseInt(req.params.id, 10);
        if (isNaN(taskId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        if (isNaN(taskId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        if (isNaN(taskId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        if (isNaN(taskId))
            return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
        const { status } = req.body;
        const employeeId = req.user.employeeId;
        const existingTask = await p.task.findFirst({
            where: { id: taskId, },
            include: { assignee: { select: { company_id: true } } }
        });
        if (!existingTask) {
            return res.status(404).json({ error: 'Task not found' });
        }
        // Embed context for authorization.ts
        const downstreamIds = await (0, hierarchy_1.getDownstreamEmployeeIds)(req.user.companyId, employeeId);
        const taskContext = {
            ...existingTask,
            assignee: {
                ...existingTask.assignee,
                company_id: existingTask.assignee?.company_id,
            },
            _isSubordinate: downstreamIds.includes(existingTask.assignee_id),
        };
        if (!(0, authorization_1.can)(req.user, shared_1.Permissions.TASKS_UPDATE, taskContext)) {
            return res.status(403).json({ error: 'Forbidden: Cannot update this task' });
        }
        const isCompleting = status === 'COMPLETED' && existingTask.status !== 'COMPLETED';
        const updatedTask = await p.task.update({
            where: { id: taskId },
            data: {
                status,
                completed_at: isCompleting ? new Date() : existingTask.completed_at,
            },
        });
        if (isCompleting) {
            await p.auditEvent.create({
                data: {
                    actor_id: employeeId,
                    action: 'TASK_COMPLETED',
                    entity_type: 'TASK',
                    entity_id: taskId,
                    new_value: JSON.stringify({ points: 1.0, taskTitle: updatedTask.title }),
                },
            });
            await p.notification.create({
                data: {
                    employee_id: employeeId,
                    title: '🎉 Task Completed!',
                    message: `Great job! You completed "${updatedTask.title}" and earned +1.0 performance points!`,
                    type: 'SYSTEM_ALERT',
                },
            });
        }
        return res.status(200).json({
            message: `Task status updated to ${status}`,
            task: updatedTask,
            cheerUp: isCompleting,
        });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to update task status' });
    }
});
exports.default = router;
