import { TokenPayload } from '../utils/jwt';

export enum WorkflowDomain {
  LEAD = 'LEAD',
  PROPERTY = 'PROPERTY',
  SITE_VISIT = 'SITE_VISIT',
  PROJECT = 'PROJECT',
}

export interface WorkflowTransitionRequest {
  domain: WorkflowDomain;
  currentState: string;
  action: string;
  actor: TokenPayload;
  entity: any;
}

export interface WorkflowTransitionResult {
  allowed: boolean;
  nextState?: string;
  reason?: string;
}

export interface DomainWorkflow {
  canTransition(req: WorkflowTransitionRequest): WorkflowTransitionResult;
}
