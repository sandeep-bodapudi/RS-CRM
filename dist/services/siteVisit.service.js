"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SiteVisitService = void 0;
// Phase 4.4 (2026-09-07): split from a single 855-line file into
// single-responsibility modules under ./siteVisit/. Unlike the pure
// declaration files (shared/index.ts) or route files (properties.ts,
// employees.ts, attendance.ts), this was a static-method CLASS with one
// heavily-shared private helper (`applyTransition`, used by 11 of the 19
// methods) — so the split extracts every method into a standalone exported
// function (in ./siteVisit/{shared,booking,lifecycle,cancellation}.ts,
// `applyTransition`/`generateNextBookingCode`/`resolveVisitProject` living in
// `shared.ts`), and every `this.applyTransition(...)` /
// `this.generateNextBookingCode()` / `SiteVisitService.resolveVisitProject(...)`
// call site was rewritten to a direct function call during the extraction.
// `SiteVisitService` below is now a thin facade assigning each imported
// function as a static property — `SiteVisitService.acceptVisit(...)` etc.
// still works identically for every one of this class's external callers,
// with zero call-site changes required anywhere in the codebase.
const booking_1 = require("./siteVisit/booking");
const lifecycle_1 = require("./siteVisit/lifecycle");
const cancellation_1 = require("./siteVisit/cancellation");
class SiteVisitService {
}
exports.SiteVisitService = SiteVisitService;
SiteVisitService.listVisits = booking_1.listVisits;
SiteVisitService.bookVisit = booking_1.bookVisit;
SiteVisitService.acceptVisit = lifecycle_1.acceptVisit;
SiteVisitService.reassignVisit = lifecycle_1.reassignVisit;
SiteVisitService.escalateVisit = lifecycle_1.escalateVisit;
SiteVisitService.reconfirmCustomer = lifecycle_1.reconfirmCustomer;
SiteVisitService.rescheduleVisit = lifecycle_1.rescheduleVisit;
SiteVisitService.pmReconfirm = lifecycle_1.pmReconfirm;
SiteVisitService.confirmVisit = lifecycle_1.confirmVisit;
SiteVisitService.startVisit = lifecycle_1.startVisit;
SiteVisitService.completeVisit = lifecycle_1.completeVisit;
SiteVisitService.cancelVisit = cancellation_1.cancelVisit;
SiteVisitService.holdVisit = cancellation_1.holdVisit;
SiteVisitService.initiateCancellation = cancellation_1.initiateCancellation;
SiteVisitService.rejectCancellation = cancellation_1.rejectCancellation;
SiteVisitService.confirmCancellation = cancellation_1.confirmCancellation;
