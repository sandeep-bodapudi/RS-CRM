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
import { listVisits, bookVisit } from './siteVisit/booking';
import {
  acceptVisit,
  reassignVisit,
  escalateVisit,
  reconfirmCustomer,
  rescheduleVisit,
  pmReconfirm,
  confirmVisit,
  startVisit,
  completeVisit,
} from './siteVisit/lifecycle';
import {
  cancelVisit,
  holdVisit,
  initiateCancellation,
  rejectCancellation,
  confirmCancellation,
} from './siteVisit/cancellation';

export class SiteVisitService {
  static listVisits = listVisits;
  static bookVisit = bookVisit;

  static acceptVisit = acceptVisit;
  static reassignVisit = reassignVisit;
  static escalateVisit = escalateVisit;
  static reconfirmCustomer = reconfirmCustomer;
  static rescheduleVisit = rescheduleVisit;
  static pmReconfirm = pmReconfirm;
  static confirmVisit = confirmVisit;
  static startVisit = startVisit;
  static completeVisit = completeVisit;

  static cancelVisit = cancelVisit;
  static holdVisit = holdVisit;
  static initiateCancellation = initiateCancellation;
  static rejectCancellation = rejectCancellation;
  static confirmCancellation = confirmCancellation;
}
