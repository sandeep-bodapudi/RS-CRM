import { prisma } from '../../lib/prisma';
import { TokenPayload } from '../../utils/jwt';
import { Roles, Permissions } from '../../shared';
import { can } from '../../authz/authorization';
import { WorkflowEngine } from '../../workflows/workflowEngine';
import { WorkflowDomain } from '../../workflows/types';
import { SiteVisitPolicy } from '../../policies/siteVisit.policy';
import { applyTransition } from './shared';
import { createFeedbackRequest, dispatchFeedbackRequestNotification } from '../feedback.service';
import { notifyEmployee } from '../../utils/notifyEmployee';

const p = prisma;

  /** accept: PM/Agent accepts the routed visit. */
export async function acceptVisit(user: TokenPayload, visitId: number, notes?: string) {
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

    return applyTransition(
      user, visitId, 'ACCEPT',
      { project_manager_id: user.employeeId },
      'SITE_VISIT_ACCEPTED',
      `Site visit ${visit.booking_code} accepted by ${user.employeeId}.${notes ? ` Notes: ${notes}` : ''}`,
    );
  }

  /** reassign: open chain during initial acceptance — logged to SiteVisitReassignment, resets to PENDING_ACCEPTANCE. */
export async function reassignVisit(user: TokenPayload, visitId: number, toEmployeeId: number, reason: string) {
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
      // Web push to reassigned employee (outside transaction)
      notifyEmployee(toEmployeeId, {
        type: 'TARGET_ASSIGNED',
        title: 'Site Visit Reassigned to You',
        message: `Site visit ${visit.booking_code} has been reassigned to you for acceptance.`,
      }, { skipDbNotification: true }).catch(err => logger.error('[WebPush] Site visit reassign:', err));

      return updated;
    });
  }

  /** escalate: no PM/Agent available → Marketing Director for manual resolution. */
export async function escalateVisit(user: TokenPayload, visitId: number, reason: string) {
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
        // Web push to Marketing Director (outside transaction)
        notifyEmployee(md.id, {
          type: 'SYSTEM_ALERT',
          title: 'Site Visit Escalated',
          message: `Site visit ${visit.booking_code} escalated — no PM/Agent available.`,
        }, { skipDbNotification: true }).catch(err => logger.error('[WebPush] Site visit escalate:', err));
      }

      return updated;
    });
  }

  /** Telecaller triggers day-before reconfirmation call. */
export async function reconfirmCustomer(user: TokenPayload, visitId: number) {
    const visit = await p.siteVisitBooking.findFirst({
      where: { id: visitId, lead: { } },
      include: { lead: true },
    });
    if (!visit) throw { status: 404, message: 'Site visit booking not found' };
    if (!can(user, Permissions.SITE_VISITS_VERIFY, visit)) {
      throw { status: 403, message: 'Forbidden: Missing site_visits.verify permission' };
    }
    return applyTransition(
      user, visitId, 'RECONFIRM_CUSTOMER', {},
      'SITE_VISIT_REQUESTED',
      `Day-before reconfirmation call initiated for ${visit.booking_code}.`,
    );
  }

  /** Customer requests reschedule (new date/property). */
export async function rescheduleVisit(user: TokenPayload, visitId: number, data: { scheduled_date?: string; property_ids?: number[] }) {
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

    return applyTransition(
      user, visitId, 'RESCHEDULE', extra,
      'SITE_VISIT_RESCHEDULE_REQUESTED',
      `Reschedule requested for ${visit.booking_code}.`,
    );
  }

  /** PM confirms or releases after a reschedule (PENDING_PM_RECONFIRMATION). */
export async function pmReconfirm(user: TokenPayload, visitId: number, release: boolean) {
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

    return applyTransition(
      user, visitId, 'PM_CONFIRM', {},
      'SITE_VISIT_ACCEPTED',
      `PM confirmed reschedule for ${visit.booking_code}.`,
    );
  }

  /** confirm: PENDING_CUSTOMER_RECONFIRMATION / RESCHEDULE_REQUESTED → CONFIRMED. */
export async function confirmVisit(user: TokenPayload, visitId: number) {
    const visit = await p.siteVisitBooking.findFirst({
      where: { id: visitId, lead: { } },
      include: { lead: true },
    });
    if (!visit) throw { status: 404, message: 'Site visit booking not found' };
    if (!can(user, Permissions.SITE_VISITS_VERIFY, visit)) {
      throw { status: 403, message: 'Forbidden: Missing site_visits.verify permission' };
    }
    return applyTransition(
      user, visitId, 'CONFIRM', {},
      'SITE_VISIT_ACCEPTED',
      `Site visit ${visit.booking_code} confirmed (schedule locked).`,
    );
  }

  /** start: CONFIRMED → ACTIVE (day-of). */
export async function startVisit(user: TokenPayload, visitId: number) {
    const visit = await p.siteVisitBooking.findFirst({
      where: { id: visitId, lead: { } },
      include: { lead: true },
    });
    if (!visit) throw { status: 404, message: 'Site visit booking not found' };
    if (!can(user, Permissions.SITE_VISITS_COMPLETE, visit)) {
      throw { status: 403, message: 'Forbidden: Missing site_visits.complete permission' };
    }
    return applyTransition(
      user, visitId, 'START', {},
      'SITE_VISIT_COMPLETED',
      `Site visit ${visit.booking_code} is now ACTIVE (in progress).`,
    );
  }

  /** complete: ACTIVE → COMPLETED, capturing per-property outcomes (multi-property §2). */
export async function completeVisit(user: TokenPayload, visitId: number, outcomes: any[], feedback_notes?: string, proof_photo_url?: string) {
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
    // Array.prototype.every() is vacuously true on an empty array — guard
    // against that so a visit with no linked properties (outcomes: []) isn't
    // misreported as "all not interested".
    const allNotInterested = outcomes.length > 0 && outcomes.every((o: any) => o.outcome === 'NOT_INTERESTED');

    const result = await p.$transaction(async (tx: import('@prisma/client').Prisma.TransactionClient) => {
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

      // § Phase 7 — a completed visit always has someone who actually ran it
      // (agent takes priority over PM when both are set, matching how the
      // notification below picks a name); only request feedback when there
      // is genuinely someone to rate.
      const ratedEmployeeId = visit.assigned_agent_id || visit.project_manager_id;
      if (ratedEmployeeId) {
        (updated as any)._feedbackToken = await createFeedbackRequest(tx, visitId, ratedEmployeeId);
      }

      return updated;
    });

    // Outside the transaction (this I/O must never roll back the visit
    // completion itself), but still awaited: dispatchFeedbackRequestNotification
    // catches its own errors internally, so awaiting it costs a little
    // latency without risking the request path — and avoids an unhandled,
    // untracked background promise outliving the request.
    if ((result as any)._feedbackToken) {
      await dispatchFeedbackRequestNotification(visitId, (result as any)._feedbackToken);
    }

    return result;
  }
