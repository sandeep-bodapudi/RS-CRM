import { logger } from '../../utils/logger';
import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticateToken, AuthenticatedRequest } from '../../middleware/auth';
import { requireAuthz } from '../../middleware/authz';
import { Roles, Permissions } from '../../shared';
import { can } from '../../authz/authorization';
import { decryptData } from '../../utils/crypto';
import { buildEmployeeScope } from '../../authz/dataScope';

const router = Router();

// GET /api/v1/employees - List all active/inactive employees (Admin invisible filtered)
router.get(
  '/',
  authenticateToken,
  requireAuthz(Permissions.EMPLOYEES_READ),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Default was 20 with a 100 max and no `total` in the response — and
      // at least a dozen call sites across the frontend (dropdowns, role
      // assignment, complaint routing, demo/site-visit handler pickers,
      // the employee directory itself) call this with no `limit` at all and
      // never paginate, so any company with more than 20 employees had most
      // of its roster silently invisible in every one of them: not
      // searchable, not selectable, not editable. EmployeeManagement.tsx's
      // "Total Staff"/"Active Roster"/"QR Exempted" stat cards (all derived
      // from `employees.length`/`.filter().length` on that same truncated
      // array) under-reported too. Found via the Phase 10 manual QA pass:
      // logged in as HR for a 214-employee company and the directory showed
      // "Total Staff: 20". Raising the default (not just the max) fixes the
      // whole class of caller at once, rather than patching each one to pass
      // an explicit `limit` — well past realistic company sizes for this app,
      // and cheaper than building full pagination UI into an admin-only list.
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 500, 1), 1000);
      const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

      const whereClause: any = await buildEmployeeScope(req.user!);

      const roleQuery = req.query.role as string;
      if (roleQuery) {
        // Callers may send either the enum KEY (e.g. "PROJECT_MANAGER", as
        // PropertyAssignmentsWidget.tsx does) or the actual Roles.* VALUE
        // stored as Role.name in the DB (e.g. "project managers" — these are
        // not the same string for most roles). Resolve the key to its value
        // when possible, so a caller using the more natural enum key isn't
        // silently matched against nothing.
        const resolvedRoleName = (Roles as Record<string, string>)[roleQuery] || roleQuery;
        const roleCondition = {
          roles: {
            some: {
              role: {
                name: {
                  equals: resolvedRoleName,
                },
              },
            },
          },
        };

        if (whereClause.AND) {
          whereClause.AND.push(roleCondition);
        } else {
          whereClause.AND = [roleCondition];
        }
      }

      const [employees, total] = await Promise.all([
        prisma.employee.findMany({
          take: limit,
          skip: offset,
          where: whereClause,
          include: {
            branch: true,
            roles: { include: { role: true } },
          },
          orderBy: { created_at: 'desc' },
        }),
        prisma.employee.count({ where: whereClause }),
      ]);

      const formatted = employees.map((emp) => ({
        id: emp.id,
        employeeCode: emp.employee_code,
        fullName: emp.full_name || emp.employee_code,
        branchId: emp.branch_id,
        branch: emp.branch?.name || 'All Branches',
        status: emp.status,
        attendanceRequired: emp.attendance_required,
        firstLoginDone: emp.first_login_done,
        roles: emp.roles.map((r) => r.role.name),
        createdAt: emp.created_at,

        phone: emp.phone || '',
        secondaryPhone: emp.secondary_phone || '',
        whatsappNumber: emp.whatsapp_number || '',
        email: emp.email || '',
        bloodGroup: emp.blood_group || '',
        socialLinks: emp.social_links || '',
        currentAddress: emp.current_address || '',
        permanentAddress: emp.permanent_address || '',
        emergencyContactName: emp.emergency_contact_name || '',
        emergencyContactRelation: emp.emergency_contact_relation || '',
        emergencyContactPhone: emp.emergency_contact_phone || '',
        // Decrypted here; the canViewSensitive check below still strips these
        // for unauthorized viewers before the response is sent.
        panNumber: decryptData(emp.pan_number) || '',
        aadhaarNumber: decryptData(emp.aadhaar_number) || '',
        bankName: decryptData(emp.bank_name) || '',
        bankAccountNumber: decryptData(emp.bank_account_number) || '',
        bankIfsc: decryptData(emp.bank_ifsc) || '',
        bankBranch: decryptData(emp.bank_branch) || '',
        jobTitle: emp.job_title || '',
        department: emp.department || '',
        employmentType: emp.employment_type || 'FULL_TIME',
        reportRequired: emp.report_required !== false,
        reportingManagerId: emp.reporting_manager_id,
        dateOfJoining: emp.date_of_joining ? emp.date_of_joining.toISOString().split('T')[0] : '',
        backgroundEducation: emp.background_education || '',
      }));

      // SENSITIVE DATA FILTERING (Stage 2)
      const canViewSensitive = can(req.user!, Permissions.EMPLOYEES_VIEW_SENSITIVE, {
        company_id: req.user!.companyId,
      });
      if (!canViewSensitive) {
        formatted.forEach((emp: any) => {
          delete emp.panNumber;
          delete emp.aadhaarNumber;
          delete emp.bankName;
          delete emp.bankAccountNumber;
          delete emp.bankIfsc;
          delete emp.bankBranch;
          delete emp.salaryCtc;
        });
      }

      return res.status(200).json({ employees: formatted, pagination: { limit, offset, total } });
    } catch (error) {
      logger.error('Fetch employees error:', error);
      return res.status(500).json({ error: 'Failed to fetch employees list' });
    }
  },
);

// GET /api/v1/employees/branches - Get all branches for dropdown
// GET /api/v1/employees/branches - Get all branches for dropdown
router.get('/branches', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const branches = await prisma.branch.findMany({
      where: {},
    });
    return res.status(200).json({ branches });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch branches' });
  }
});

// GET /api/v1/employees/managers - Get list of reporting managers
// GET /api/v1/employees/managers - Get list of reporting managers
router.get('/managers', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const managers = await prisma.employee.findMany({
      where: {
        company_id: req.user!.companyId,
        roles: {
          some: {
            role: {
              name: {
                in: [
                  Roles.MD,
                  Roles.HR_MANAGER,
                  Roles.PROJECT_MANAGER,
                  Roles.MARKETING_DIRECTOR,
                  Roles.DIGITAL_MARKETING_HEAD,
                ],
              },
            },
          },
        },
      },
      select: {
        id: true,
        employee_code: true,
        full_name: true,
        job_title: true,
      },
    });

    const formatted = managers.map((m) => ({
      id: m.id,
      label: `${m.full_name || m.employee_code} (${m.job_title || 'Manager'}) - ${m.employee_code}`,
    }));

    return res.status(200).json({ managers: formatted });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch managers' });
  }
});

// GET /api/v1/employees/demo-assignees - Eligible employees for manual demo-handler
// assignment (§ Phase 2/6): PM, Agent, Sales Manager, Channel Partner Manager, and
// the Managing Director (self-assign) — explicitly excludes Telecaller.
router.get(
  '/demo-assignees',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const assignees = await prisma.employee.findMany({
        where: {
          company_id: req.user!.companyId,
          status: 'ACTIVE',
          roles: {
            some: {
              role: {
                name: {
                  in: [
                    Roles.PROJECT_MANAGER,
                    Roles.AGENT,
                    Roles.SALES_MANAGER,
                    Roles.CHANNEL_PARTNER_MANAGER,
                    Roles.MD,
                  ],
                },
              },
            },
          },
        },
        select: {
          id: true,
          employee_code: true,
          full_name: true,
          job_title: true,
          roles: { include: { role: true } },
        },
      });

      const formatted = assignees.map((e) => ({
        id: e.id,
        label: `${e.full_name || e.employee_code} (${e.job_title || e.roles.map((r) => r.role.name).join(', ')})`,
      }));

      return res.status(200).json({ assignees: formatted });
    } catch (error) {
      logger.error('Fetch demo assignees error:', error);
      return res.status(500).json({ error: 'Failed to fetch eligible demo assignees' });
    }
  },
);

export default router;
