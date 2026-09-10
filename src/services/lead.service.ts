// Phase 4.4 (2026-09-07): split from a single 1260-line file into
// single-responsibility modules under ./lead/ — the highest-risk file of the
// six (19 static methods on the class that owns every Lead workflow guard
// hardened throughout Phase 2). Same pattern as siteVisit.service.ts: every
// method became a standalone exported function, and every internal
// `this.generateNextLeadCode()` / `this.calculateLeadScore(...)` /
// `LeadService.updateLeadStatus(...)` call site was rewritten to a direct
// function call during extraction (verified via grep afterward — zero
// `this.`/`LeadService.` references remain in any of the split files).
// `AppError` (used in ~30 places across every method, and imported by many
// OTHER files directly from `./lead.service`) was pulled into its own
// `./lead/errors.ts` rather than left inline, specifically to avoid a
// circular import between this facade and the new method files that all
// need to throw it.
// `LeadService` below is a thin facade assigning each imported function as a
// static property — `LeadService.methodName(...)` still works identically
// for every external caller, with zero call-site changes required anywhere.
export { AppError } from './lead/errors';

import {
  getLeads,
  getLeadById,
  getDistributionMonitor,
  getMatches,
  getLeadTasks,
  getPropertyInterests,
} from './lead/query';
import { calculateLeadScore } from './lead/shared';
import { createLead } from './lead/create';
import { reassignLead, updateLeadStatus, bulkUploadLeads } from './lead/status';
import { sendWhatsAppProposal, addPropertyInterest, removePropertyInterest } from './lead/interest';
import {
  distributeUnassignedPoolLeads,
  triggerLeadRecoveryForProperty,
  recoverManualLead,
  recoverFreshLead,
} from './lead/recovery';

export class LeadService {
  static getLeads = getLeads;
  static getLeadById = getLeadById;
  static getDistributionMonitor = getDistributionMonitor;
  static calculateLeadScore = calculateLeadScore;
  static createLead = createLead;
  static bulkUploadLeads = bulkUploadLeads;
  static reassignLead = reassignLead;
  static updateLeadStatus = updateLeadStatus;
  static getMatches = getMatches;
  static sendWhatsAppProposal = sendWhatsAppProposal;
  static addPropertyInterest = addPropertyInterest;
  static removePropertyInterest = removePropertyInterest;
  static getPropertyInterests = getPropertyInterests;
  static distributeUnassignedPoolLeads = distributeUnassignedPoolLeads;
  static getLeadTasks = getLeadTasks;
  static triggerLeadRecoveryForProperty = triggerLeadRecoveryForProperty;
  static recoverManualLead = recoverManualLead;
  static recoverFreshLead = recoverFreshLead;
}
