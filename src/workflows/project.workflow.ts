import { DomainWorkflow, WorkflowTransitionRequest, WorkflowTransitionResult } from './types';

/**
 * Phase 2.5: Project lifecycle state machine.
 *
 *   PLANNING → UNDER_CONSTRUCTION → COMPLETED (terminal)
 *   PLANNING → CANCELLED (terminal)
 *   UNDER_CONSTRUCTION → CANCELLED (terminal)
 *
 * Product decisions (2026-09-06): a COMPLETED project can never be cancelled
 * (by the time a project is done, units are LIVE/BOOKED/SOLD underneath it —
 * "cancelling" a finished project isn't a real business action). CANCELLED is
 * also terminal — there's no workflow action to revive a cancelled project;
 * that would be a deliberate manual data-fix, not a routine transition.
 *
 * Unlike Lead/SiteVisit, Project has no in-app UI that sends an abstract verb
 * ("VERIFY", "ACCEPT", etc.) — the existing edit form (`ProjectFormWizard.tsx`)
 * has always sent the desired target status directly via `PUT /projects/:id`.
 * So actions here are literally the target status names, keeping the existing
 * API contract unchanged while finally validating the transition is legal.
 */
export type ProjectAction = 'UNDER_CONSTRUCTION' | 'COMPLETED' | 'CANCELLED';

export class ProjectWorkflow implements DomainWorkflow {
  private static readonly validTransitions: Partial<Record<string, Partial<Record<ProjectAction, string>>>> = {
    PLANNING: {
      UNDER_CONSTRUCTION: 'UNDER_CONSTRUCTION',
      CANCELLED: 'CANCELLED',
    },
    UNDER_CONSTRUCTION: {
      COMPLETED: 'COMPLETED',
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
