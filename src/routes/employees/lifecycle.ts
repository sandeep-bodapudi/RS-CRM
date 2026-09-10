import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticateToken, AuthenticatedRequest } from '../../middleware/auth';
import { requireAuthz } from '../../middleware/authz';
import {
  Permissions,
  EmployeeResignSchema,
  EmployeePromoteSchema,
  EmployeeConvertEmploymentTypeSchema,
} from '../../shared';
import { can } from '../../authz/authorization';
import { notifyEmployee } from '../../utils/notifyEmployee';
import { validateRequestBody } from '../../middleware/validate';

const router = Router();

// POST /api/v1/employees/:id/resign - Mark an employee as resigned
router.post(
  '/:id/resign',
  authenticateToken,
  requireAuthz(Permissions.EMPLOYEES_UPDATE),
  validateRequestBody(EmployeeResignSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const employeeId = parseInt(req.params.id, 10);
      const targetEmployee = await prisma.employee.findUnique({ where: { id: employeeId } });
      if (!targetEmployee) {
        return res.status(404).json({ error: 'Employee not found' });
      }

      if (!can(req.user!, Permissions.EMPLOYEES_UPDATE, targetEmployee)) {
        return res
          .status(403)
          .json({ error: 'Forbidden: Cannot update an employee outside your company' });
      }

      const { resignation_date, last_working_day, reason } = req.body;
      const resignedAt = resignation_date ? new Date(resignation_date) : new Date();
      const lastDay = last_working_day ? new Date(last_working_day) : null;

      const updatedEmp = await prisma.$transaction(async (tx) => {
        const emp = await tx.employee.update({
          where: { id: employeeId },
          data: {
            status: 'RESIGNED',
            resignation_date: resignedAt,
            last_working_day: lastDay,
            token_version: { increment: 1 },
          },
        });

        await tx.authSession.updateMany({
          where: { employee_id: employeeId, revoked: false },
          data: { revoked: true, revocation_reason: 'AUTHORIZATION_CHANGED' },
        });

        await tx.auditEvent.create({
          data: {
            actor_id: req.user!.employeeId || 1,
            action: 'EMPLOYEE_RESIGNED',
            entity_type: 'EMPLOYEE',
            entity_id: employeeId,
            old_value: JSON.stringify({ status: targetEmployee.status }),
            new_value: JSON.stringify({ status: 'RESIGNED', resignation_date: resignedAt, last_working_day: lastDay }),
            reason: reason || null,
          },
        });

        return emp;
      });

      await notifyEmployee(employeeId, {
        type: 'STATUS_CHANGED',
        title: '📋 Resignation Recorded',
        message: lastDay
          ? `Your resignation has been recorded. Last working day: ${lastDay.toLocaleDateString('en-IN')}.`
          : 'Your resignation has been recorded. Contact HR for your last working day.',
      });

      return res.status(200).json({ message: 'Employee marked as resigned', employee: updatedEmp });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to record resignation' });
    }
  },
);

// POST /api/v1/employees/:id/promote - Promote an employee (title/salary/role, with an audit trail)
router.post(
  '/:id/promote',
  authenticateToken,
  requireAuthz(Permissions.EMPLOYEES_UPDATE),
  validateRequestBody(EmployeePromoteSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const employeeId = parseInt(req.params.id, 10);
      const targetEmployee = await prisma.employee.findUnique({ where: { id: employeeId } });
      if (!targetEmployee) {
        return res.status(404).json({ error: 'Employee not found' });
      }

      if (!can(req.user!, Permissions.EMPLOYEES_UPDATE, targetEmployee)) {
        return res
          .status(403)
          .json({ error: 'Forbidden: Cannot update an employee outside your company' });
      }

      const canViewSensitive = can(req.user!, Permissions.EMPLOYEES_VIEW_SENSITIVE, targetEmployee);
      if (req.body.salary_ctc !== undefined && !canViewSensitive) {
        return res.status(403).json({ error: 'Cannot modify salary' });
      }

      const { job_title, salary_ctc, role_name, reason } = req.body;

      const oldValue = {
        job_title: targetEmployee.job_title,
        salary_ctc: targetEmployee.salary_ctc,
      };
      const updateData: any = {};
      if (job_title !== undefined) updateData.job_title = job_title;
      if (salary_ctc !== undefined) updateData.salary_ctc = parseFloat(salary_ctc as any);

      const updatedEmp = await prisma.$transaction(async (tx) => {
        let roleChanged = false;
        if (role_name) {
          const targetRole = await tx.role.findUnique({ where: { name: role_name } });
          if (targetRole) {
            const currentRoles = await tx.employeeRole.findMany({
              where: { employee_id: employeeId },
              include: { role: true },
            });
            roleChanged = !currentRoles.some((r: any) => r.role.name === role_name);
            if (roleChanged) {
              await tx.employeeRole.deleteMany({ where: { employee_id: employeeId } });
              await tx.employeeRole.create({ data: { employee_id: employeeId, role_id: targetRole.id } });
            }
          }
        }

        if (roleChanged) {
          updateData.token_version = { increment: 1 };
        }

        const emp = await tx.employee.update({
          where: { id: employeeId },
          data: updateData,
          include: { roles: { include: { role: true } } },
        });

        if (roleChanged) {
          await tx.authSession.updateMany({
            where: { employee_id: employeeId, revoked: false },
            data: { revoked: true, revocation_reason: 'AUTHORIZATION_CHANGED' },
          });
        }

        await tx.auditEvent.create({
          data: {
            actor_id: req.user!.employeeId || 1,
            action: 'EMPLOYEE_PROMOTED',
            entity_type: 'EMPLOYEE',
            entity_id: employeeId,
            old_value: JSON.stringify(oldValue),
            new_value: JSON.stringify({ job_title, salary_ctc, role_name }),
            reason: reason || null,
          },
        });

        return emp;
      });

      await notifyEmployee(employeeId, {
        type: 'ROLE_CHANGED',
        title: '🎉 You Have Been Promoted',
        message: `Congratulations! ${job_title ? `New title: ${job_title}. ` : ''}${role_name ? `New role: ${role_name}. ` : ''}Please check with HR for details.`,
      });

      return res.status(200).json({ message: 'Employee promoted', employee: updatedEmp });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to promote employee' });
    }
  },
);

// POST /api/v1/employees/:id/convert-employment-type - Convert between full-time/part-time/contract/intern
router.post(
  '/:id/convert-employment-type',
  authenticateToken,
  requireAuthz(Permissions.EMPLOYEES_UPDATE),
  validateRequestBody(EmployeeConvertEmploymentTypeSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const employeeId = parseInt(req.params.id, 10);
      const targetEmployee = await prisma.employee.findUnique({ where: { id: employeeId } });
      if (!targetEmployee) {
        return res.status(404).json({ error: 'Employee not found' });
      }

      if (!can(req.user!, Permissions.EMPLOYEES_UPDATE, targetEmployee)) {
        return res
          .status(403)
          .json({ error: 'Forbidden: Cannot update an employee outside your company' });
      }

      const { employment_type } = req.body;
      const oldType = targetEmployee.employment_type;

      const updatedEmp = await prisma.$transaction(async (tx) => {
        const emp = await tx.employee.update({
          where: { id: employeeId },
          data: { employment_type },
        });

        await tx.auditEvent.create({
          data: {
            actor_id: req.user!.employeeId || 1,
            action: 'EMPLOYEE_EMPLOYMENT_TYPE_CONVERTED',
            entity_type: 'EMPLOYEE',
            entity_id: employeeId,
            old_value: JSON.stringify({ employment_type: oldType }),
            new_value: JSON.stringify({ employment_type }),
          },
        });

        return emp;
      });

      await notifyEmployee(employeeId, {
        type: 'STATUS_CHANGED',
        title: '📄 Employment Type Updated',
        message: `Your employment type has been changed to ${employment_type.replace('_', ' ')}.`,
      });

      return res.status(200).json({ message: 'Employment type updated', employee: updatedEmp });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to convert employment type' });
    }
  },
);

export default router;
