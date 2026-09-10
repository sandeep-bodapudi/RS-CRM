import { prisma } from '../../lib/prisma';
import { TokenPayload } from '../../utils/jwt';
import { WorkflowEngine } from '../../workflows/workflowEngine';
import { WorkflowDomain } from '../../workflows/types';
import { SiteVisitAction } from '../../workflows/siteVisit.workflow';

const p = prisma;

  export async function generateNextBookingCode(): Promise<string> {
    const currentYear = new Date().getFullYear();
    const prefix = `RRH-SV-${currentYear}-`;
    const count = await p.siteVisitBooking.count();
    let seq = count + 1;
    for (;;) {
      const candidate = `${prefix}${String(seq).padStart(4, '0')}`;
      const existing = await p.siteVisitBooking.findUnique({ where: { booking_code: candidate } });
      if (!existing) {
        return candidate;
      }
      seq++;
    }
  }

  /**
   * Resolve the authoritative project PM for the given property list.
   * §2 constraint: all properties in a single booking must belong to the SAME
   * project, so we validate that and take that project's assigned_pm_id.
   */
  export async function resolveVisitProject(data: any, companyId: number): Promise<{ projectId: number; pmId: number | null }> {
    // Determine project from an explicit project_id or from the properties.
    let projectId: number | null = data.project_id ?? null;
    const propertyIds: number[] = data.property_ids && Array.isArray(data.property_ids) 
      ? data.property_ids 
      : (data.property_id ? [data.property_id] : []);

    if (propertyIds.length > 0) {
      const properties = await p.property.findMany({
        where: { id: { in: propertyIds }, company_id: companyId },
      });
      const projects = new Set(properties.map((pr: any) => pr.project_id).filter(Boolean) as number[]);
      if (projects.size > 1) {
        throw { status: 400, message: '§2: All properties in a single site visit must belong to the same project.' };
      }
      if (projects.size === 1) {
        projectId = [...projects][0];
      }
    }

    if (!projectId) {
      return { projectId: 0, pmId: null };
    }

    const project = await p.project.findFirst({ where: { id: projectId } });
    return { projectId, pmId: project?.assigned_pm_id ?? null };
  }

  /** Helper: run an action through the workflow engine and persist the next status. */
  export async function applyTransition(
    user: TokenPayload,
    visitId: number,
    action: SiteVisitAction,
    extraData: any = {},
    activityType: string,
    activityNotes: string,
  ) {
    const visit = await p.siteVisitBooking.findFirst({
      where: { id: visitId, lead: { } },
      include: { lead: true },
    });
    if (!visit) {
      throw { status: 404, message: 'Site visit booking not found' };
    }

    const transition = WorkflowEngine.canTransition({
      domain: WorkflowDomain.SITE_VISIT,
      currentState: visit.status,
      action,
      actor: user,
      entity: visit,
    });
    if (!transition.allowed) {
      throw { status: 409, message: transition.reason || 'Invalid state transition' };
    }

    return await p.$transaction(async (tx: import('@prisma/client').Prisma.TransactionClient) => {
      const updated = await tx.siteVisitBooking.update({
        where: { id: visitId },
        data: { status: transition.nextState, ...extraData },
      });

      await tx.leadActivity.create({
        data: {
          lead: { connect: { id: visit.lead_id } },
          actor: { connect: { id: user.employeeId } },
          activity_type: activityType,
          notes: activityNotes,
        },
      });

      return updated;
    });
  }
