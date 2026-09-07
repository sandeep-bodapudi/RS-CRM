import { logger } from '../utils/logger';
import { Router, Response , NextFunction} from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { validateRequestBody } from '../middleware/validate';
import { TaskCreateSchema, TaskUpdateStatusSchema, Roles, Permissions } from '../shared';
import { notifyEmployee } from '../utils/notifyEmployee';
import { requireAuthz } from '../middleware/authz';
import { can } from '../authz/authorization';
import { getDownstreamEmployeeIds } from '../utils/hierarchy';
import { deriveTaskSlaStatus } from '../services/task-sla.status';

const router = Router();

const p = prisma;

// GET /api/v1/tasks/all-team-tasks - MD & Management View of All Employee Tasks
router.get('/all-team-tasks', authenticateToken, requireAuthz(Permissions.REPORTS_READ_TEAM), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {

    const now = new Date();

    // Auto-flip past target date tasks to OVERDUE & send alerts to MD & Dept Head
    const newlyOverdue = await p.task.findMany({
      where: {
        status: { in: ['PENDING', 'IN_PROGRESS'] },
        target_date: { lt: now },
        
      },
      include: { assignee: true },
    });

    for (const t of newlyOverdue) {
      await p.task.update({
        where: { id: t.id },
        data: { status: 'OVERDUE' },
      });

      // Send alert to MD / System Admin & Assignee
      const mdEmp = await p.employee.findFirst({
        where: { 
          roles: { some: { role: { name: Roles.MD } } },
          
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
      where: { },
      include: { assignee: true },
      orderBy: [{ target_date: 'asc' }],
    });

    return res.status(200).json({ tasks: allTasks });
  } catch (error) {
    logger.error('Fetch all team tasks error:', error);
    return res.status(500).json({ error: 'Failed to fetch team tasks' });
  }
});

// GET /api/v1/tasks/my-tasks - List assigned tasks with auto-overdue check
router.get('/my-tasks', authenticateToken, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const employeeId = req.user!.employeeId;
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
  } catch (error) {
    logger.error('Fetch tasks error:', error);
    return res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// POST /api/v1/tasks - Create new task
router.post('/', authenticateToken, requireAuthz(Permissions.TASKS_CREATE), validateRequestBody(TaskCreateSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { title, description, assignee_id, priority, deadline, lead_id, opportunity_id } = req.body;
    const creatorId = req.user!.employeeId;

    // Validate Assignee Company Isolation
    const assignee = await p.employee.findFirst({ where: { id: assignee_id, company_id: req.user!.companyId } });
    if (!assignee) {
      return res.status(400).json({ error: 'Assignee not found or outside your company.' });
    }

    // Validate Lead Access if lead_id is provided
    if (lead_id) {
      const existingLead = await p.lead.findFirst({ where: { id: lead_id, } });
      if (!existingLead) {
        return res.status(404).json({ error: 'Lead not found.' });
      }
      if (!can(req.user!, Permissions.LEADS_UPDATE, existingLead)) {
        return res.status(403).json({ error: 'Forbidden: You do not have permission to attach tasks to this lead.' });
      }
    }

    // Validate Opportunity Access if opportunity_id is provided
    if (opportunity_id) {
      const existingOpp = await p.opportunity.findFirst({ where: { id: opportunity_id, company_id: req.user!.companyId } });
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
    await notifyEmployee(assignee_id, {
      type: 'TASK_ASSIGNED',
      title: '📋 New Task Assigned to You',
      message: `Task "${title}" has been assigned to you. Deadline: ${new Date(task.target_date).toLocaleDateString('en-IN')}.`,
      link: '/tasks',
    });

    return res.status(201).json({ message: 'Task created successfully', task });
  } catch (error) {
    logger.error('Create task error:', error);
    return res.status(500).json({ error: 'Failed to create task' });
  }
});

// GET /api/v1/tasks/:id/sla - Read SLA status for a Task (Phase 15 V1)
router.get('/:id/sla', authenticateToken, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const taskId = parseInt(req.params.id, 10);
      if (isNaN(taskId)) return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
      if (isNaN(taskId)) return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
      if (isNaN(taskId)) return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
      if (isNaN(taskId)) return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });

    // Locate the Task within the user's company scope
    const task = await p.task.findFirst({
      where: { id: taskId, assignee: { company_id: req.user!.companyId } },
    });

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Call deriveTaskSlaStatus using existing helper
    const slaStatus = deriveTaskSlaStatus({
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
  } catch (error) {
    logger.error('Read task SLA error:', error);
    return res.status(500).json({ error: 'Failed to read task SLA status' });
  }
})

// PATCH /api/v1/tasks/:id/status - Update Task Status & Cheer-up Event
router.patch('/:id/status', authenticateToken, requireAuthz(Permissions.TASKS_UPDATE), validateRequestBody(TaskUpdateStatusSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const taskId = parseInt(req.params.id, 10);
      if (isNaN(taskId)) return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
      if (isNaN(taskId)) return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
      if (isNaN(taskId)) return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
      if (isNaN(taskId)) return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
    const { status } = req.body;
    const employeeId = req.user!.employeeId;

    const existingTask = await p.task.findFirst({
      where: { id: taskId, assignee: { company_id: req.user!.companyId } },
      include: { assignee: { select: { company_id: true } } }
    });

    if (!existingTask) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Embed context for authorization.ts
    const downstreamIds = await getDownstreamEmployeeIds(req.user!.companyId, employeeId);
    const taskContext = {
      ...existingTask,
      assignee: {
        ...existingTask.assignee,
        company_id: existingTask.assignee?.company_id,
      },
      _isSubordinate: downstreamIds.includes(existingTask.assignee_id),
    };

    if (!can(req.user!, Permissions.TASKS_UPDATE, taskContext)) {
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
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update task status' });
  }
});

export default router;
