import { DomainWorkflow, WorkflowTransitionRequest, WorkflowTransitionResult } from './types';

/**
 * Phase 2.5: Project lifecycle state machine.
 *
 *   PLANNING → UNDER_CONSTRUCTION → COMPLETED (terminal)
 *   PLANNING → CANCELLED (terminal)
 *   UNDER_CONSTRUCTION → CANCELLED (terminal)
 *   PLANNING | UNDER_CONSTRUCTION → ON_HOLD → UNDER_CONSTRUCTION (Activate) | CANCELLED
 *
 * Product decisions (2026-09-06): a COMPLETED project can never be cancelled
 * (by the time a project is done, units are LIVE/BOOKED/SOLD underneath it —
 * "cancelling" a finished project isn't a real business action). CANCELLED is
 * also terminal — there's no workflow action to revive a cancelled project;
 * that would be a deliberate manual data-fix, not a routine transition.
 *
 * ON_HOLD (2026-09-12, spec item #15): a pause distinct from CANCELLED — the
 * project isn't dead, just temporarily off (funding gap, legal hold, etc).
 * "Activate" resumes into UNDER_CONSTRUCTION regardless of which state the
 * project was held from, since resuming always means active work is ongoing
 * again. Units under a held project are NOT touched by this transition —
 * ProjectUnitService blocks new bookings against an ON_HOLD project (see its
 * createLock/bookUnit checks) but existing locks/bookings are unaffected, so
 * a hold never strands a customer mid-purchase.
 *
 * Unlike Lead/SiteVisit, Project has no in-app UI that sends an abstract verb
 * ("VERIFY", "ACCEPT", etc.) — the existing edit form (`ProjectFormWizard.tsx`)
 * has always sent the desired target status directly via `PUT /projects/:id`.
 * So actions here are literally the target status names, keeping the existing
 * API contract unchanged while finally validating the transition is legal.
 */
export type ProjectAction = 'UNDER_CONSTRUCTION' | 'COMPLETED' | 'CANCELLED' | 'ON_HOLD';

export class ProjectWorkflow implements DomainWorkflow {
  private static readonly validTransitions: Partial<
    Record<string, Partial<Record<ProjectAction, string>>>
  > = {
    PLANNING: {
      UNDER_CONSTRUCTION: 'UNDER_CONSTRUCTION',
      CANCELLED: 'CANCELLED',
      ON_HOLD: 'ON_HOLD',
    },
    UNDER_CONSTRUCTION: {
      COMPLETED: 'COMPLETED',
      CANCELLED: 'CANCELLED',
      ON_HOLD: 'ON_HOLD',
    },
    ON_HOLD: {
      UNDER_CONSTRUCTION: 'UNDER_CONSTRUCTION',
      CANCELLED: 'CANCELLED',
    },
    COMPLETED: {},
    CANCELLED: {},
  };

  canTransition(req: WorkflowTransitionRequest): WorkflowTransitionResult {
    const { currentState, action } = req;
    const allowedMap = ProjectWorkflow.validTransitions[currentState];

    if (!allowedMap) {
      return {
        allowed: false,
        reason: `Unknown project state: ${currentState}`,
      };
    }

    const nextState = allowedMap[action as ProjectAction];
    if (!nextState) {
      return {
        allowed: false,
        reason: `Invalid project transition: cannot move from ${currentState} to ${action}`,
      };
    }

    return { allowed: true, nextState };
  }
}
