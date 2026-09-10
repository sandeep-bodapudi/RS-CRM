import { prisma } from '../../lib/prisma';
import { TokenPayload } from '../../utils/jwt';
import { Roles, Permissions } from '../../shared';
import { can } from '../../authz/authorization';
import { buildLeadScope } from '../../authz/dataScope';
import { LeadPolicy } from '../../policies/lead.policy';
import { AppError } from './errors';

const p = prisma;

export async function getLeads(user: TokenPayload, take: number = 20, skip: number = 0) {
    const whereCondition = await buildLeadScope(user);

    const leads = await p.lead.findMany({
      where: whereCondition,
      take,
      skip,
      include: {
        assigned_to: { select: { id: true, employee_code: true, full_name: true, phone: true } },
        created_by: { select: { id: true, employee_code: true, full_name: true } },
        introduced_by: { select: { id: true, employee_code: true, full_name: true } },
        activities: {
          orderBy: { created_at: 'desc' },
          take: 5,
          include: { actor: { select: { id: true, employee_code: true, full_name: true } } },
        },
        preferred_locations: { orderBy: { sort_order: 'asc' } },
      },
      orderBy: { created_at: 'desc' },
    });

    return leads.map(lead => {
      const canView = LeadPolicy.canView(user, lead);
      return {
        ...lead,
        introduced_by: canView ? lead.introduced_by : null, // RBAC enforcement for introduced_by
        can_edit: LeadPolicy.canMutate(user, lead)
      };
    });
  }

  /**
   * Phase 2.12: previously queried with no scope at all (`where: { id: leadId }`)
   * — any authenticated user holding the base LEADS_READ/LEADS_UPDATE
   * permission could fetch (and, via the PATCH /:id route, mutate) any lead
   * in the entire system, including other companies', since this method's
   * only "authorization" was computing `canView`/`can_edit` as informational
   * response fields, never gating access on them. `getLeads` (the list
   * endpoint) already scopes correctly via `buildLeadScope` — this brings the
   * single-record fetch in line with that established, correct pattern.
   */
export async function getLeadById(user: TokenPayload, leadId: number) {
    const scope = await buildLeadScope(user);
    const lead = await p.lead.findFirst({
      where: { id: leadId, ...scope },
      include: {
        assigned_to: { select: { id: true, employee_code: true, full_name: true, phone: true } },
        created_by: { select: { id: true, employee_code: true, full_name: true } },
        introduced_by: { select: { id: true, employee_code: true, full_name: true } },
        activities: {
          orderBy: { created_at: 'desc' },
          include: { actor: { select: { id: true, employee_code: true, full_name: true } } },
        },
        preferred_locations: { orderBy: { sort_order: 'asc' } },
      }
    });
    if (!lead) {
      // AppError (not a plain Error) so routes/leads.ts's handleServiceError
      // maps this to 404, not a generic 500 — matters more now that an
      // out-of-scope lead (wrong company, not on your team) also lands here,
      // not just a genuinely nonexistent id.
      throw new AppError(404, 'Lead not found');
    }

    const canView = LeadPolicy.canView(user, lead);

    return {
      ...lead,
      introduced_by: canView ? lead.introduced_by : null,
      can_edit: LeadPolicy.canMutate(user, lead)
    };
  }

export async function getDistributionMonitor(companyId: number) {
    const telecallers = await p.employee.findMany({
      where: {
        company_id: companyId,
        status: 'ACTIVE',
        roles: {
          some: { role: { name: Roles.TELECALLER } },
        },
      },
      select: { id: true, employee_code: true, full_name: true, department: true },
    });

    // Instead of N+1 queries, use grouping
    const activeLeadCounts = await p.lead.groupBy({
      by: ['assigned_to_id'],
      where: {
        assigned_to_id: { in: telecallers.map((t: any) => t.id) },
        status: { in: ['NEW', 'ASSIGNED', 'CONTACTED', 'QUALIFIED', 'DEMO_SCHEDULED', 'DEMO_COMPLETED', 'SITE_VISIT_SCHEDULED', 'SITE_VISIT_COMPLETED', 'NEGOTIATION', 'BOOKING_INITIATED'] },
      },
      _count: { _all: true },
    });

    const totalAssignedCounts = await p.lead.groupBy({
      by: ['assigned_to_id'],
      where: { assigned_to_id: { in: telecallers.map((t: any) => t.id) } },
      _count: { _all: true },
    });

    const totalWonCounts = await p.lead.groupBy({
      by: ['assigned_to_id'],
      where: { status: 'BOOKED', assigned_to_id: { in: telecallers.map((t: any) => t.id) } },
      _count: { _all: true },
    });

    const activeMap = new Map(activeLeadCounts.map((x: any) => [x.assigned_to_id, x._count._all]));
    const assignedMap = new Map(totalAssignedCounts.map((x: any) => [x.assigned_to_id, x._count._all]));
    const wonMap = new Map(totalWonCounts.map((x: any) => [x.assigned_to_id, x._count._all]));

    const monitorData = telecallers.map((emp: any) => {
      const activeLeadCount = Number(activeMap.get(emp.id) || 0);
      const totalAssigned = Number(assignedMap.get(emp.id) || 0);
      const totalWon = Number(wonMap.get(emp.id) || 0);

      return {
        id: emp.id,
        employeeCode: emp.employee_code,
        fullName: emp.full_name || emp.employee_code,
        activeLeadCount,
        totalAssigned,
        totalWon,
        closureRate: totalAssigned > 0 ? ((totalWon / totalAssigned) * 100).toFixed(1) + '%' : '0.0%',
      };
    });

    const totalLeadsCount = await p.lead.count({ where: { company_id: companyId } });
    const unassignedCount = await p.lead.count({
      where: { company_id: companyId, assigned_to_id: null },
    });

    return { totalLeadsCount, unassignedCount, telecallers: monitorData };
  }

export async function getMatches(user: TokenPayload, leadId: number) {
    const lead = await p.lead.findFirst({ where: { id: leadId, } });
    if (!lead) throw new AppError(404, 'Lead not found');

    if (!can(user, Permissions.LEADS_READ, lead)) {
      throw new AppError(403, 'Forbidden: You do not have permission to view matches for this lead');
    }

    // Call the matching engine (defined in matchingEngine.ts)
    // Note: To avoid circular imports or redefining the engine here, we imported it at the top.
    // However, findMatchingPropertiesForLead requires leadId.
    const { findMatchingPropertiesForLead } = require('../../utils/matchingEngine');
    const matches = await findMatchingPropertiesForLead(leadId);
    return matches;
  }

export async function getLeadTasks(user: TokenPayload, leadId: number) {
    const lead = await p.lead.findFirst({ where: { id: leadId, } });
    if (!lead) throw new AppError(404, 'Lead not found');

    if (!can(user, Permissions.LEADS_READ, lead)) {
      throw new AppError(403, 'Forbidden: You do not have permission to read this lead');
    }

    const tasks = await p.task.findMany({
      where: { lead_id: leadId },
      include: { assignee: { select: { id: true, full_name: true, employee_code: true } } },
      orderBy: [{ target_date: 'asc' }],
    });

    return tasks;
  }

export async function getPropertyInterests(user: TokenPayload, leadId: number) {
    const lead = await p.lead.findFirst({ where: { id: leadId, } });
    if (!lead) throw new AppError(404, 'Lead not found');

    if (!can(user, Permissions.LEADS_READ, lead)) {
      throw new AppError(403, 'Forbidden: You do not have permission to read this lead');
    }

    const interests = await p.leadPropertyInterest.findMany({
      where: { lead_id: leadId, is_active: true },
      include: {
        property: {
          select: {
            id: true,
            property_code: true,
            title: true,
            location: true,
            final_price: true,
            status: true,
            assigned_pm: { select: { id: true, full_name: true } }
          }
        },
        creator: { select: { id: true, full_name: true } }
      },
      orderBy: { created_at: 'desc' }
    });

    return interests;
  }
