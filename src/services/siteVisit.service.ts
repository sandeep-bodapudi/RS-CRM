import { prisma } from '../lib/prisma';
import { PrismaClient, SiteVisitBooking, Lead } from '@prisma/client';
import { TokenPayload } from '../utils/jwt';
import { Roles } from '../shared';
import { can } from '../authz/authorization';
import { Permissions } from '../shared';
import { WorkflowEngine } from '../workflows/workflowEngine';
import { WorkflowDomain } from '../workflows/types';
import { SiteVisitAction } from '../workflows/siteVisit.workflow';
import { SiteVisitPolicy } from '../policies/siteVisit.policy';

const p = prisma;

export class SiteVisitService {
  private static async generateNextBookingCode(): Promise<string> {
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
  private static async resolveVisitProject(data: any, companyId: number): Promise<{ projectId: number; pmId: number | null }> {
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

  static async listVisits(user: TokenPayload, filters: { status?: string; leadId?: string; escalated?: boolean }) {
    const whereCondition: any = SiteVisitPolicy.canList(user);

    if (filters.escalated) {
      whereCondition.status = {
        in: ['PENDING_ACCEPTANCE', 'ESCALATED_TO_MARKETING_DIRECTOR']
      };
      whereCondition.OR = [
        { status: 'ESCALATED_TO_MARKETING_DIRECTOR' },
        { 
          escalation: {
            OR: [
              { marketing_director_notified_at: { not: null } },
              { managing_director_notified_at: { not: null } }
            ]
          }
        }
      ];
    } else if (filters.status) {
      whereCondition.status = filters.status;
    }

    if (filters.leadId) {
      whereCondition.lead_id = parseInt(filters.leadId, 10);
    }

    const visits = await p.siteVisitBooking.findMany({
      where: whereCondition,
      include: {
        lead: { select: { id: true, lead_code: true, customer_name: true, phone: true, preferred_location: true, company_id: true } },
        telecaller: { select: { id: true, employee_code: true, full_name: true, phone: true } },
        project_manager: { select: { id: true, employee_code: true, full_name: true, phone: true } },
        assigned_agent: { select: { id: true, employee_code: true, full_name: true, phone: true } },
        property: { select: { id: true, property_code: true, title: true, status: true } },
        site_visit_properties: {
          include: { property: { select: { id: true, property_code: true, title: true } } },
        },
        reassignments: {
          orderBy: { created_at: 'asc' },
          include: {
            from_employee: { select: { id: true, full_name: true } },
            to_employee: { select: { id: true, full_name: true } },
          },
        },
        escalation: true,
      },
      orderBy: { scheduled_date: 'asc' },
    });

    // §2: reassignment `reason` visibility is restricted to executive-department
    // roles (MD, Admin, HR Manager, Marketing Director, Project Manager per the
    // SiteVisitPolicy.isManagement set). Telecallers/Agents see only who was
    // involved, never the reason behind a reassignment hop.
    if (!SiteVisitPolicy.canViewReassignmentReason(user)) {
      for (const v of visits) {
        for (const r of v.reassignments) {
          delete (r as any).reason;
        }
        
        // Blind Approval: Omit PII for PENDING_ACCEPTANCE visits unless the user is the telecaller who booked it.
        // MDs/Admins bypass this via canViewReassignmentReason.
        if (v.status === 'PENDING_ACCEPTANCE' && v.telecaller?.id !== user.employeeId) {
          if (v.lead) {
            delete (v.lead as any).customer_name;
            delete (v.lead as any).phone;
            delete (v.lead as any).email;
          }
        }
      }
    }

    return visits;
  }

  /** bookVisit: create the booking (REQUESTED) + property links, auto-route to PENDING_ACCEPTANCE. */
  static async bookVisit(user: TokenPayload, data: any) {
    const lead = await p.lead.findFirst({ where: { id: data.lead_id, } });
    if (!lead) {
      throw { status: 404, message: 'Lead not found' };
    }

    if (!can(user, Permissions.SITE_VISITS_CREATE, lead)) {
      throw { status: 403, message: 'Forbidden: Missing site_visits.create permission or Lead is not in your company' };
    }

    if (data.opportunity_id) {
      const opportunity = await p.opportunity.findFirst({ where: { id: data.opportunity_id, } });
      if (!opportunity) {
        throw { status: 404, message: 'Opportunity not found' };
      }
      if (opportunity.company_id !== user.companyId) {
        throw { status: 403, message: 'Forbidden: Opportunity belongs to another company' };
      }
      if (opportunity.lead_id !== data.lead_id) {
        throw { status: 400, message: 'Opportunity does not belong to the specified Lead' };
      }
    }

    const propertyIds: number[] = Array.isArray(data.property_ids) 
      ? data.property_ids 
      : (data.property_id ? [data.property_id] : []);
    if (propertyIds.length > 0) {
      const props = await p.property.findMany({ where: { id: { in: propertyIds }, company_id: user.companyId } });
      if (props.length !== propertyIds.length) {
        throw { status: 404, message: 'One or more properties not found' };
      }
      // §2 constraint: same project.
      const projects = new Set(props.map((pr: any) => pr.project_id).filter(Boolean) as number[]);
      if (projects.size > 1) {
        throw { status: 400, message: '§2: All properties in a single site visit must belong to the same project.' };
      }
    }

    const { projectId, pmId } = await SiteVisitService.resolveVisitProject(data, user.companyId || 1);

    return await p.$transaction(async (tx: import('@prisma/client').Prisma.TransactionClient) => {
      const bookingCode = await this.generateNextBookingCode();
      const bookingData: any = {
        booking_code: bookingCode,
        lead: { connect: { id: data.lead_id } },
        telecaller: { connect: { id: user.employeeId } },
        scheduled_date: new Date(data.scheduled_date),
        status: 'REQUESTED',
        verification_call_notes: data.notes || 'Site visit booked by telecaller.',
      };

      if (data.opportunity_id) bookingData.opportunity = { connect: { id: data.opportunity_id } };

      if (propertyIds.length > 0) {
        // Single property column kept for backward compatibility (first property).
        bookingData.property = { connect: { id: propertyIds[0] } };
      }
      if (projectId) {
        bookingData.project = { connect: { id: projectId } };
      }

      const booking = await tx.siteVisitBooking.create({ data: bookingData });

      // §2 property links (multi-property outcome capture)
      if (propertyIds.length > 0) {
        await tx.siteVisitProperty.createMany({
          data: propertyIds.map((pid: number) => ({ visit_id: booking.id, property_id: pid })),
        });
      }

      // Auto-route REQUESTED → PENDING_ACCEPTANCE (to the project's assigned PM)
      const route = WorkflowEngine.canTransition({
        domain: WorkflowDomain.SITE_VISIT,
        currentState: 'REQUESTED',
        action: 'ROUTE',
        actor: user,
        entity: { id: booking.id },
      });
      if (!route.allowed) {
        throw { status: 409, message: route.reason || 'Invalid site visit transition' };
      }

      const updatedBooking = await tx.siteVisitBooking.update({
        where: { id: booking.id },
        data: { status: route.nextState as import('@prisma/client').SiteVisitStatus, project_manager_id: pmId ?? undefined },
        include: {
          lead: true,
          property: true,
          telecaller: true,
          project_manager: true,
          assigned_agent: true
        }
      });

      // Activity log
      await tx.leadActivity.create({
        data: {
          lead: { connect: { id: data.lead_id } },
          activity_type: 'SITE_VISIT_REQUESTED',
          notes: `Site visit scheduled. Auto-routed to project PM.`,
          actor: { connect: { id: user.employeeId } },
        },
      });

      // Notifications
      const notifyId = pmId ?? undefined;
      if (notifyId) {
        await tx.notification.create({
          data: {
            employee_id: notifyId,
            type: 'TARGET_ASSIGNED',
            title: 'New Site Visit to Accept',
            message: `Site visit ${updatedBooking.booking_code} requires your acceptance.`,
          },
        });
      } else {
        // Immediate Escalation Fallback for unmapped PM
        await tx.siteVisitEscalation.create({
          data: {
            site_visit_booking_id: booking.id,
            marketing_director_notified_at: new Date()
          }
        });
        
        const marketingDirectors = await tx.employee.findMany({
          where: { roles: { some: { role: { name: Roles.MARKETING_DIRECTOR } } }, status: 'ACTIVE' },
          select: { id: true }
        });
        
        if (marketingDirectors.length > 0) {
          await tx.notification.createMany({
            data: marketingDirectors.map((md: any) => ({
              employee_id: md.id,
              type: 'SYSTEM_ALERT',
              title: 'Unassigned Site Visit',
              message: `Site visit ${updatedBooking.booking_code} has no active project PM. Please reassign manually.`,
            }))
          });
        }
      }

      return updatedBooking;
    });
  }

  /** Helper: run an action through the workflow engine and persist the next status. */
  private static async applyTransition(
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

  /** accept: PM/Agent accepts the routed visit. */
  static async acceptVisit(user: TokenPayload, visitId: number, notes?: string) {
    const visit = await p.siteVisitBooking.findFirst({
      where: { id: visitId, lead: { } },
      include: { lead: true },
    });
    if (!visit) throw { status: 404, message: 'Site visit booking not found' };
    if (!can(user, Permissions.SITE_VISITS_ASSIGN_AGENT, visit)) {
      throw { status: 403, message: 'Forbidden: Missing permission to accept site visits' };
    }
    if (!SiteVisitPolicy.canAccept(user, visit)) {
      throw { status: 403, message: 'Forbidden: only the routed PM/Agent may accept this visit' };
    }

    return this.applyTransition(
      user, visitId, 'ACCEPT',
      { project_manager_id: user.employeeId },
      'SITE_VISIT_ACCEPTED',
      `Site visit ${visit.booking_code} accepted by ${user.employeeId}.${notes ? ` Notes: ${notes}` : ''}`,
    );
  }

  /** reassign: open chain during initial acceptance — logged to SiteVisitReassignment, resets to PENDING_ACCEPTANCE. */
  static async reassignVisit(user: TokenPayload, visitId: number, toEmployeeId: number, reason: string) {
    const visit = await p.siteVisitBooking.findFirst({
      where: { id: visitId, lead: { } },
      include: { lead: true },
    });
    if (!visit) throw { status: 404, message: 'Site visit booking not found' };

    const targetWithRoles = await p.employee.findFirst({
      where: { id: toEmployeeId, },
      include: { roles: { include: { role: true } } },
    });
    if (!targetWithRoles) throw { status: 404, message: 'Target employee not found' };
    const target = {
      ...targetWithRoles,
      roles: (targetWithRoles.roles || []).map((er: any) => er.role?.name).filter(Boolean),
    };
    if (!SiteVisitPolicy.canReassignTarget(user, target)) {
      throw { status: 403, message: 'Forbidden: only PROJECT_MANAGER or AGENT may be reassignment targets' };
    }

    // Ping-pong prevention: Cannot route to someone who has already routed it away.
    const previousReassignment = await p.siteVisitReassignment.findFirst({
      where: {
        visit_id: visitId,
        from_employee_id: toEmployeeId,
      },
    });
    if (previousReassignment) {
      throw { status: 409, message: 'Cannot route to this employee. They have already declined or routed this visit.' };
    }

    const transition = WorkflowEngine.canTransition({
      domain: WorkflowDomain.SITE_VISIT, currentState: visit.status, action: 'REASSIGN', actor: user, entity: visit,
    });
    if (!transition.allowed) {
      throw { status: 409, message: transition.reason || 'Invalid state transition' };
    }

    return await p.$transaction(async (tx: import('@prisma/client').Prisma.TransactionClient) => {
      // Log the reassignment hop (reason visibility restricted per §2).
      await tx.siteVisitReassignment.create({
        data: { visit_id: visitId, from_employee_id: visit.project_manager_id ?? user.employeeId, to_employee_id: toEmployeeId, reason },
      });

      const updated = await tx.siteVisitBooking.update({
        where: { id: visitId },
        data: { status: 'PENDING_ACCEPTANCE', project_manager_id: toEmployeeId },
      });

      await tx.leadActivity.create({
        data: {
          lead: { connect: { id: visit.lead_id } },
          actor: { connect: { id: user.employeeId } },
          activity_type: 'SITE_VISIT_REASSIGNED',
          notes: `Site visit ${visit.booking_code} reassigned to ${target.full_name || target.employee_code}. Reason: ${reason}`,
        },
      });

      await tx.notification.create({
        data: {
          employee_id: toEmployeeId,
          type: 'TARGET_ASSIGNED',
          title: 'Site Visit Reassigned to You',
          message: `Site visit ${visit.booking_code} has been reassigned to you for acceptance.`,
        },
      });

      return updated;
    });
  }

  /** escalate: no PM/Agent available → Marketing Director for manual resolution. */
  static async escalateVisit(user: TokenPayload, visitId: number, reason: string) {
    const visit = await p.siteVisitBooking.findFirst({
      where: { id: visitId, lead: { } },
      include: { lead: true },
    });
    if (!visit) throw { status: 404, message: 'Site visit booking not found' };

    const transition = WorkflowEngine.canTransition({
      domain: WorkflowDomain.SITE_VISIT, currentState: visit.status, action: 'ESCALATE', actor: user, entity: visit,
    });
    if (!transition.allowed) {
      throw { status: 409, message: transition.reason || 'Invalid state transition' };
    }

    return await p.$transaction(async (tx: import('@prisma/client').Prisma.TransactionClient) => {
      const md = await tx.employee.findFirst({
        where: { roles: { some: { role: { name: Roles.MARKETING_DIRECTOR } } }, },
      });

      const updated = await tx.siteVisitBooking.update({
        where: { id: visitId },
        data: { status: 'ESCALATED_TO_MARKETING_DIRECTOR' },
      });

      await tx.leadActivity.create({
        data: {
          lead: { connect: { id: visit.lead_id } },
          actor: { connect: { id: user.employeeId } },
          activity_type: 'SITE_VISIT_ESCALATED',
          notes: `Site visit ${visit.booking_code} escalated to Marketing Director. Reason: ${reason}`,
        },
      });

      if (md) {
        await tx.notification.create({
          data: {
            employee_id: md.id,
            type: 'SYSTEM_ALERT',
            title: 'Site Visit Escalated',
            message: `Site visit ${visit.booking_code} could not be assigned to a PM/Agent. Reason: ${reason}`,
          },
        });
      }

      return updated;
    });
  }

  /** Telecaller triggers day-before reconfirmation call. */
  static async reconfirmCustomer(user: TokenPayload, visitId: number) {
    const visit = await p.siteVisitBooking.findFirst({
      where: { id: visitId, lead: { } },
      include: { lead: true },
    });
    if (!visit) throw { status: 404, message: 'Site visit booking not found' };
    if (!can(user, Permissions.SITE_VISITS_VERIFY, visit)) {
      throw { status: 403, message: 'Forbidden: Missing site_visits.verify permission' };
    }
    return this.applyTransition(
      user, visitId, 'RECONFIRM_CUSTOMER', {},
      'SITE_VISIT_REQUESTED',
      `Day-before reconfirmation call initiated for ${visit.booking_code}.`,
    );
  }

  /** Customer requests reschedule (new date/property). */
  static async rescheduleVisit(user: TokenPayload, visitId: number, data: { scheduled_date?: string; property_ids?: number[] }) {
    const visit = await p.siteVisitBooking.findFirst({
      where: { id: visitId, lead: { } },
      include: { lead: true },
    });
    if (!visit) throw { status: 404, message: 'Site visit booking not found' };
    if (!can(user, Permissions.SITE_VISITS_VERIFY, visit)) {
      throw { status: 403, message: 'Forbidden: Missing site_visits.verify permission' };
    }
    
    // Phase D: If superseding a cancellation, notify the PM.
    if (visit.status === 'CANCELLATION_PENDING_PM_CONFIRMATION' && visit.project_manager_id) {
      await p.notification.create({
        data: {
          employee_id: visit.project_manager_id,
          type: 'SYSTEM_ALERT',
          title: 'Cancellation Superseded',
          message: `The cancellation for site visit ${visit.booking_code} was superseded by a reschedule request.`,
        }
      });
    }

    const extra: any = {};
    if (data.scheduled_date) extra.scheduled_date = new Date(data.scheduled_date);
    if (data.property_ids && data.property_ids.length > 0) {
      // Replace property links.
      await p.siteVisitProperty.deleteMany({ where: { visit_id: visitId } });
      await p.siteVisitProperty.createMany({
        data: data.property_ids.map((pid: number) => ({ visit_id: visitId, property_id: pid })),
      });
      if (data.property_ids[0]) extra.property_id = data.property_ids[0];
    }

    return this.applyTransition(
      user, visitId, 'RESCHEDULE', extra,
      'SITE_VISIT_RESCHEDULE_REQUESTED',
      `Reschedule requested for ${visit.booking_code}.`,
    );
  }

  /** PM confirms or releases after a reschedule (PENDING_PM_RECONFIRMATION). */
  static async pmReconfirm(user: TokenPayload, visitId: number, release: boolean) {
    const visit = await p.siteVisitBooking.findFirst({
      where: { id: visitId, lead: { } },
      include: { lead: true },
    });
    if (!visit) throw { status: 404, message: 'Site visit booking not found' };
    if (!SiteVisitPolicy.canAccept(user, visit)) {
      throw { status: 403, message: 'Forbidden: only the PM may reconfirm this visit' };
    }

    if (release) {
      // Reset to the authoritative project PM for the (possibly new) property.
      const props = await p.siteVisitProperty.findMany({ where: { visit_id: visitId }, include: { property: true } });
      const projectId = props[0]?.property?.project_id ?? visit.project_id;
      const project = projectId ? await p.project.findFirst({ where: { id: projectId } }) : null;
      const authoritativePm = project?.assigned_pm_id ?? null;

      const transition = WorkflowEngine.canTransition({
        domain: WorkflowDomain.SITE_VISIT, currentState: visit.status, action: 'PM_RELEASE', actor: user, entity: visit,
      });
      if (!transition.allowed) throw { status: 409, message: transition.reason || 'Invalid state transition' };

      return await p.$transaction(async (tx: import('@prisma/client').Prisma.TransactionClient) => {
        const updated = await tx.siteVisitBooking.update({
          where: { id: visitId },
          data: { status: 'PENDING_ACCEPTANCE', project_manager_id: authoritativePm ?? undefined },
        });
        await tx.leadActivity.create({
          data: {
            lead: { connect: { id: visit.lead_id } }, actor: { connect: { id: user.employeeId } },
            activity_type: 'SITE_VISIT_RESCHEDULE_REQUESTED',
            notes: `PM released reschedule for ${visit.booking_code}; reset to project PM for acceptance.`,
          },
        });
        return updated;
      });
    }

    return this.applyTransition(
      user, visitId, 'PM_CONFIRM', {},
      'SITE_VISIT_ACCEPTED',
      `PM confirmed reschedule for ${visit.booking_code}.`,
    );
  }

  /** confirm: PENDING_CUSTOMER_RECONFIRMATION / RESCHEDULE_REQUESTED → CONFIRMED. */
  static async confirmVisit(user: TokenPayload, visitId: number) {
    const visit = await p.siteVisitBooking.findFirst({
      where: { id: visitId, lead: { } },
      include: { lead: true },
    });
    if (!visit) throw { status: 404, message: 'Site visit booking not found' };
    if (!can(user, Permissions.SITE_VISITS_VERIFY, visit)) {
      throw { status: 403, message: 'Forbidden: Missing site_visits.verify permission' };
    }
    return this.applyTransition(
      user, visitId, 'CONFIRM', {},
      'SITE_VISIT_ACCEPTED',
      `Site visit ${visit.booking_code} confirmed (schedule locked).`,
    );
  }

  /** start: CONFIRMED → ACTIVE (day-of). */
  static async startVisit(user: TokenPayload, visitId: number) {
    const visit = await p.siteVisitBooking.findFirst({
      where: { id: visitId, lead: { } },
      include: { lead: true },
    });
    if (!visit) throw { status: 404, message: 'Site visit booking not found' };
    if (!can(user, Permissions.SITE_VISITS_COMPLETE, visit)) {
      throw { status: 403, message: 'Forbidden: Missing site_visits.complete permission' };
    }
    return this.applyTransition(
      user, visitId, 'START', {},
      'SITE_VISIT_COMPLETED',
      `Site visit ${visit.booking_code} is now ACTIVE (in progress).`,
    );
  }

  /** complete: ACTIVE → COMPLETED, capturing per-property outcomes (multi-property §2). */
  static async completeVisit(user: TokenPayload, visitId: number, outcomes: any[], feedback_notes?: string, proof_photo_url?: string) {
    const visit = await p.siteVisitBooking.findFirst({
      where: { id: visitId, lead: { } },
      include: { lead: true, site_visit_properties: true },
    });
    if (!visit) throw { status: 404, message: 'Site visit booking not found' };
    if (!can(user, Permissions.SITE_VISITS_COMPLETE, visit)) {
      throw { status: 403, message: 'Forbidden: Missing site_visits.complete permission' };
    }

    // Validate outcomes: every linked property must have an outcome, with reason if NOT_INTERESTED.
    const linked = visit.site_visit_properties.map((sp: any) => sp.property_id);
    const provided = new Set(outcomes.map((o: any) => o.property_id));
    for (const pid of linked) {
      if (!provided.has(pid)) {
        throw { status: 400, message: `Outcome required for every linked property. Missing property ${pid}.` };
      }
    }
    for (const o of outcomes) {
      if (o.outcome === 'NOT_INTERESTED' && (!o.outcome_reason || o.outcome_reason.trim() === '')) {
        throw { status: 400, message: 'outcome_reason is required when outcome is NOT_INTERESTED.' };
      }
    }

    const transition = WorkflowEngine.canTransition({
      domain: WorkflowDomain.SITE_VISIT, currentState: visit.status, action: 'COMPLETE', actor: user, entity: visit,
    });
    if (!transition.allowed) {
      throw { status: 409, message: transition.reason || 'Invalid state transition' };
    }

    const anyInterested = outcomes.some((o: any) => o.outcome === 'INTERESTED');
    const allNotInterested = outcomes.every((o: any) => o.outcome === 'NOT_INTERESTED');

    return await p.$transaction(async (tx: import('@prisma/client').Prisma.TransactionClient) => {
      // Persist outcomes.
      for (const o of outcomes) {
        await tx.siteVisitProperty.upsert({
          where: { visit_id_property_id: { visit_id: visitId, property_id: o.property_id } },
          update: { outcome: o.outcome, outcome_reason: o.outcome_reason ?? null },
          create: { visit_id: visitId, property_id: o.property_id, outcome: o.outcome, outcome_reason: o.outcome_reason ?? null },
        });
      }

      const updated = await tx.siteVisitBooking.update({
        where: { id: visitId },
        data: { status: 'COMPLETED', feedback_notes, proof_photo_url: proof_photo_url || null, completed_at: new Date() },
      });

      await tx.leadActivity.create({
        data: {
          lead: { connect: { id: visit.lead_id } },
          actor: { connect: { id: user.employeeId } },
          activity_type: 'SITE_VISIT_COMPLETED',
          notes: `Site Visit Completed! ${outcomes.length} property outcome(s) recorded.`,
        },
      });

      // §1: SITE_VISIT_COMPLETED → NEGOTIATION (any INTERESTED) or DROPPED (all NOT_INTERESTED).
      // The Lead status move is driven by the lead workflow; the service that
      // owns the lead transition will enforce it. Here we record the outcome
      // branch so the caller (route) can advance the Lead accordingly.
      (updated as any)._outcomeBranch = allNotInterested ? 'DROP' : (anyInterested ? 'NEGOTIATE' : 'NEGOTIATE');

      return updated;
    });
  }

  /** cancel: any active state → CANCELLED. */
  static async cancelVisit(user: TokenPayload, visitId: number, reason?: string) {
    const visit = await p.siteVisitBooking.findFirst({
      where: { id: visitId, lead: { } },
      include: { lead: true },
    });
    if (!visit) throw { status: 404, message: 'Site visit booking not found' };
    if (!can(user, Permissions.SITE_VISITS_COMPLETE, visit)) {
      throw { status: 403, message: 'Forbidden: Missing permission to cancel site visits' };
    }
    return this.applyTransition(
      user, visitId, 'CANCEL', {},
      'SITE_VISIT_COMPLETED',
      `Site visit ${visit.booking_code} cancelled.${reason ? ` Reason: ${reason}` : ''}`,
    );
  }

  // ==========================================
  // Phase D: Site Visit Hold/Cancel Flow
  // ==========================================

  /** HOLD: Reconfirmation fails -> ON_HOLD. */
  static async holdVisit(user: TokenPayload, visitId: number) {
    const visit = await p.siteVisitBooking.findFirst({
      where: { id: visitId, lead: { } },
      include: { lead: true },
    });
    if (!visit) throw { status: 404, message: 'Site visit booking not found' };
    if (!SiteVisitPolicy.canHoldOrInitiateCancel(user, visit)) {
      throw { status: 403, message: 'Forbidden: Only the assigned telecaller can hold this visit.' };
    }

    const result = await this.applyTransition(
      user, visitId, 'HOLD', {}, 'SITE_VISIT_REQUESTED',
      `Site visit ${visit.booking_code} placed ON_HOLD (Customer unresponsive).`
    );

    if (visit.project_manager_id) {
      await p.notification.create({
        data: {
          employee_id: visit.project_manager_id,
          type: 'SYSTEM_ALERT',
          title: 'Site Visit On Hold',
          message: `Site visit ${visit.booking_code} is on hold. The telecaller could not reach the customer for reconfirmation.`,
        }
      });
    }
    return result;
  }

  /** INITIATE_CANCEL: 1 hour before visit, Telecaller requests PM cross-check. */
  static async initiateCancellation(user: TokenPayload, visitId: number) {
    const visit = await p.siteVisitBooking.findFirst({
      where: { id: visitId, lead: { } },
      include: { lead: true },
    });
    if (!visit) throw { status: 404, message: 'Site visit booking not found' };
    if (!SiteVisitPolicy.canHoldOrInitiateCancel(user, visit)) {
      throw { status: 403, message: 'Forbidden: Only the assigned telecaller can initiate cancellation cross-check.' };
    }

    // 1-hour-before-visit retry check
    const now = new Date();
    const oneHourBefore = new Date(visit.scheduled_date.getTime() - 60 * 60 * 1000);
    if (now < oneHourBefore) {
      throw { status: 400, message: 'Cannot initiate cancellation cross-check until 1 hour before the scheduled visit.' };
    }

    const result = await this.applyTransition(
      user, visitId, 'INITIATE_CANCEL', {}, 'SITE_VISIT_REQUESTED',
      `Site visit ${visit.booking_code} cancellation initiated (PM cross-check pending).`
    );

    if (visit.project_manager_id) {
      await p.notification.create({
        data: {
          employee_id: visit.project_manager_id,
          type: 'ACTION_REQUIRED',
          title: 'Cross-Check: Cancellation Pending',
          message: `Telecaller cannot reach customer for ${visit.booking_code}. Have they responded to you? Please confirm or reject cancellation.`,
        }
      });
    }
    return result;
  }

  /** PM_CANCEL_REJECT: PM indicates customer has responded, reverting to PENDING_CUSTOMER_RECONFIRMATION. */
  static async rejectCancellation(user: TokenPayload, visitId: number) {
    const visit = await p.siteVisitBooking.findFirst({
      where: { id: visitId, lead: { } },
      include: { lead: true },
    });
    if (!visit) throw { status: 404, message: 'Site visit booking not found' };
    if (!SiteVisitPolicy.canConfirmCancel(user, visit)) {
      throw { status: 403, message: 'Forbidden: Only the assigned PM can reject this cancellation.' };
    }

    const result = await this.applyTransition(
      user, visitId, 'PM_CANCEL_REJECT', {}, 'SITE_VISIT_REQUESTED',
      `PM confirmed customer responded for ${visit.booking_code}. Reverted to active reconfirmation.`
    );

    if (visit.telecaller_id) {
      await p.notification.create({
        data: {
          employee_id: visit.telecaller_id,
          type: 'SYSTEM_ALERT',
          title: 'Cancellation Rejected by PM',
          message: `PM indicates the customer for ${visit.booking_code} has responded. Visit is active again.`,
        }
      });
    }
    return result;
  }

  /** CONFIRM_CANCEL: PM explicitly confirms cancellation, providing a reason. */
  static async confirmCancellation(user: TokenPayload, visitId: number, reason: string) {
    const visit = await p.siteVisitBooking.findFirst({
      where: { id: visitId, lead: { } },
      include: { lead: true },
    });
    if (!visit) throw { status: 404, message: 'Site visit booking not found' };
    if (!SiteVisitPolicy.canConfirmCancel(user, visit)) {
      throw { status: 403, message: 'Forbidden: Only the assigned PM can confirm this cancellation.' };
    }
    if (!reason || reason.trim() === '') {
      throw { status: 400, message: 'A cancellation reason must be provided.' };
    }

    // Pass cancellation details in the extra update payload
    const result = await this.applyTransition(
      user, visitId, 'CONFIRM_CANCEL',
      {
        cancellation_reason: reason,
        cancellation_confirmed_by_pm_id: user.employeeId
      },
      'SITE_VISIT_COMPLETED',
      `Site visit ${visit.booking_code} cancellation confirmed by PM. Reason: ${reason}`
    );

    // No-Show Flagging (2 No-shows)
    const normalizedReason = reason.toLowerCase().replace(/[\s-]/g, '');
    if (normalizedReason.includes('noshow') && visit.lead.assigned_to_id) {
      // Find telecaller's reporting manager
      const telecaller = await p.employee.findUnique({
        where: { id: visit.lead.assigned_to_id },
        select: { reporting_manager_id: true }
      });
      
      if (telecaller && telecaller.reporting_manager_id) {
        // Count previous no-shows
        const previousNoShows = await p.siteVisitBooking.count({
          where: {
            lead_id: visit.lead_id,
            status: 'CANCELLED',
            cancellation_reason: { contains: 'show' }
          }
        });
        
        // This count includes the current one since applyTransition just updated it
        if (previousNoShows >= 2) {
          await p.notification.create({
            data: {
              employee_id: telecaller.reporting_manager_id,
              type: 'SYSTEM_ALERT',
              title: 'Customer No-Show Cap Exceeded',
              message: `Customer ${visit.lead.customer_name} has hit the 2 No-Show cap. Please review this lead with the assigned telecaller.`,
            }
          });
        }
      }
    }

    return result;
  }
}
