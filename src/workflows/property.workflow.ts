import { PropertyStatus } from '../shared';
import { DomainWorkflow, WorkflowTransitionRequest, WorkflowTransitionResult } from './types';

export type PropertyAction = 'VERIFY' | 'DM_POLISH' | 'DM_VERIFY_AS_IS' | 'MD_APPROVE' | 'RESUBMIT';

/**
 * Phase 2.8 (2026-09-06): this workflow covers only the LISTING APPROVAL
 * pipeline (PENDING_VERIFICATION → ... → LIVE/REJECTED). The commercial sale
 * lifecycle that follows — LIVE → LOCKED → BOOKED (and, once wired up, SOLD)
 * — deliberately lives entirely in `booking.service.ts`, not here. This is an
 * intentional separation, not an oversight: those transitions are triggered
 * by and transactionally coupled to Booking/Customer/Opportunity/Lead state
 * (KYC checks, MD-only confirmation authority, portal handoff events,
 * Opportunity/Lead updates) in ways a single-entity `canTransition()` check
 * has no way to express — folding them in here would either strip that
 * context or force this engine to know about unrelated domains.
 * `booking.service.ts` carries the matching half of this comment.
 */
export class PropertyWorkflow implements DomainWorkflow {
  private static validTransitions: Record<string, PropertyAction[]> = {
    [PropertyStatus.PENDING_VERIFICATION]: ['VERIFY'],
    // DMH can either send to a DM Executive for polish, or verify as-is and skip straight to MD approval
    [PropertyStatus.PENDING_DM_POLISH]: ['DM_POLISH', 'DM_VERIFY_AS_IS'],
    [PropertyStatus.PENDING_MD_APPROVAL]: ['MD_APPROVE'],
    // Phase 2.6: a PM can fix whatever caused the rejection (at either the PM
    // verification step or the MD approval step — both land here) and resubmit
    // from the start of the pipeline, rather than REJECTED being a dead end.
    [PropertyStatus.REJECTED]: ['RESUBMIT'],
  };

  canTransition(req: WorkflowTransitionRequest): WorkflowTransitionResult {
    const { currentState, action } = req;
    const allowedActions = PropertyWorkflow.validTransitions[currentState] || [];

    if (!allowedActions.includes(action as PropertyAction)) {
      return {
        allowed: false,
        reason: `Invalid workflow transition: Cannot perform ${action} from state ${currentState}`
      };
    }

    // Determine next state
    let nextState;
    if (action === 'VERIFY') nextState = PropertyStatus.PENDING_DM_POLISH;
    else if (action === 'DM_POLISH') nextState = PropertyStatus.PENDING_MD_APPROVAL;
    else if (action === 'DM_VERIFY_AS_IS') nextState = PropertyStatus.PENDING_MD_APPROVAL;
    else if (action === 'MD_APPROVE') nextState = PropertyStatus.LIVE; // Or REJECTED, handled dynamically by service based on 'approved' flag
    else if (action === 'RESUBMIT') nextState = PropertyStatus.PENDING_VERIFICATION;

    return { allowed: true, nextState };
  }

  /**
   * Validates if a transition is allowed.
   * Throws an error (handled as 409 in service) if the transition is invalid.
   */
  static validateTransition(currentStatus: string, action: PropertyAction): void {
    const allowedActions = this.validTransitions[currentStatus] || [];
    
    if (!allowedActions.includes(action)) {
      throw new Error(`Invalid workflow transition: Cannot perform ${action} from state ${currentStatus}`);
    }
  }
}
