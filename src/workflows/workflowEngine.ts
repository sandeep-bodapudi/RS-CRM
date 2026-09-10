import { WorkflowDomain, WorkflowTransitionRequest, WorkflowTransitionResult, DomainWorkflow } from './types';
import { LeadWorkflow } from './lead.workflow';
import { PropertyWorkflow } from './property.workflow';
import { SiteVisitWorkflow } from './siteVisit.workflow';
import { ProjectWorkflow } from './project.workflow';

/**
 * Phase 2.3: `canTransition()` below is genuinely generic — every domain
 * (Lead/Property/SiteVisit/Project) uses it to validate a transition. The
 * write-executing method is NOT generic: it only ever writes `Lead.status`
 * (via `tx.lead.update`), regardless of which service calls it — booking,
 * customer, and opportunity services all call it purely for its lead-side
 * effects (e.g. marking the associated lead DROPPED/BOOKED/NEGOTIATION), never
 * to transition a booking/customer/opportunity record itself. It was
 * previously named `transition()`, which read as domain-generic and did not
 * match this Lead-only implementation. Renamed to `transitionLead()` instead
 * of parameterizing it by domain + Prisma delegate — there is exactly one real
 * consumer (Lead), so a generic abstraction would be speculative.
 * Property and Site Visit manage their own writes and only ever call
 * `canTransition()` — this is a leftover from Lead being where this pattern
 * was implemented first, not a defect specific to them.
 */
export class WorkflowEngine {
  private static registry: Record<WorkflowDomain, DomainWorkflow> = {
    [WorkflowDomain.LEAD]: new LeadWorkflow(),
    [WorkflowDomain.PROPERTY]: new PropertyWorkflow(),
    [WorkflowDomain.SITE_VISIT]: new SiteVisitWorkflow(),
    [WorkflowDomain.PROJECT]: new ProjectWorkflow(),
  };

  /**
   * Central entrypoint for all workflow transitions.
   * Delegates to the appropriate domain workflow for validation.
   * Does NOT perform authorization (that remains in the service layer via can()).
   */
  static canTransition(req: WorkflowTransitionRequest): WorkflowTransitionResult {
    const workflow = this.registry[req.domain];

    if (!workflow) {
      return {
        allowed: false,
        reason: `No workflow registered for domain ${req.domain}`
      };
    }

    return workflow.canTransition(req);
  }

  /**
   * Executes a LEAD state transition by first validating via canTransition.
   * If valid, it writes the new state to the database using the provided transaction.
   * Throws an error (with status 409) if the transition is invalid.
   */
  static async transitionLead(
    tx: import('@prisma/client').Prisma.TransactionClient,
    leadId: number,
    toStatus: string,
    context: { actor: import('../utils/jwt').TokenPayload; entity: any },
    extraUpdateData: any = {}
  ) {
    const transitionRes = this.canTransition({
      domain: WorkflowDomain.LEAD,
      currentState: context.entity.status,
      action: toStatus,
      actor: context.actor,
      entity: context.entity,
    });

    if (!transitionRes.allowed) {
      const error = new Error(transitionRes.reason || 'Invalid state transition');
      (error as any).statusCode = 409;
      throw error;
    }

    return await tx.lead.update({
      where: { id: leadId },
      data: {
        status: transitionRes.nextState || toStatus,
        ...extraUpdateData,
      },
    });
  }
}
