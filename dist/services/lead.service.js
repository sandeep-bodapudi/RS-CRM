"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LeadService = exports.AppError = void 0;
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
var errors_1 = require("./lead/errors");
Object.defineProperty(exports, "AppError", { enumerable: true, get: function () { return errors_1.AppError; } });
const query_1 = require("./lead/query");
const shared_1 = require("./lead/shared");
const create_1 = require("./lead/create");
const status_1 = require("./lead/status");
const interest_1 = require("./lead/interest");
const recovery_1 = require("./lead/recovery");
class LeadService {
}
exports.LeadService = LeadService;
LeadService.getLeads = query_1.getLeads;
LeadService.getLeadById = query_1.getLeadById;
LeadService.getDistributionMonitor = query_1.getDistributionMonitor;
LeadService.calculateLeadScore = shared_1.calculateLeadScore;
LeadService.createLead = create_1.createLead;
LeadService.bulkUploadLeads = status_1.bulkUploadLeads;
LeadService.reassignLead = status_1.reassignLead;
LeadService.updateLeadStatus = status_1.updateLeadStatus;
LeadService.getMatches = query_1.getMatches;
LeadService.sendWhatsAppProposal = interest_1.sendWhatsAppProposal;
LeadService.addPropertyInterest = interest_1.addPropertyInterest;
LeadService.removePropertyInterest = interest_1.removePropertyInterest;
LeadService.getPropertyInterests = query_1.getPropertyInterests;
LeadService.distributeUnassignedPoolLeads = recovery_1.distributeUnassignedPoolLeads;
LeadService.getLeadTasks = query_1.getLeadTasks;
LeadService.triggerLeadRecoveryForProperty = recovery_1.triggerLeadRecoveryForProperty;
LeadService.recoverManualLead = recovery_1.recoverManualLead;
LeadService.recoverFreshLead = recovery_1.recoverFreshLead;
