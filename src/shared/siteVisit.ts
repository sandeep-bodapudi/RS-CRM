import { z } from 'zod';

// ─────────────────────────────────────────────────────────────
// Site Visit Schemas (§2 Site Visit Sub-Workflow)
// ─────────────────────────────────────────────────────────────

// Full §2 SiteVisitBooking.status state list
export const SiteVisitStatus = {
  REQUESTED: 'REQUESTED',
  PENDING_ACCEPTANCE: 'PENDING_ACCEPTANCE',
  REASSIGNED: 'REASSIGNED',
  ESCALATED_TO_MARKETING_DIRECTOR: 'ESCALATED_TO_MARKETING_DIRECTOR',
  ACCEPTED: 'ACCEPTED',
  PENDING_CUSTOMER_RECONFIRMATION: 'PENDING_CUSTOMER_RECONFIRMATION',
  RESCHEDULE_REQUESTED: 'RESCHEDULE_REQUESTED',
  PENDING_PM_RECONFIRMATION: 'PENDING_PM_RECONFIRMATION',
  CONFIRMED: 'CONFIRMED',
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type SiteVisitStatusType = typeof SiteVisitStatus[keyof typeof SiteVisitStatus];

export const SiteVisitOutcome = {
  INTERESTED: 'INTERESTED',
  NOT_INTERESTED: 'NOT_INTERESTED',
} as const;
export type SiteVisitOutcomeType = typeof SiteVisitOutcome[keyof typeof SiteVisitOutcome];

export const SiteVisitCreateSchema = z.object({
  lead_id: z.number().int().positive(),
  // §2: all properties in a single booking must belong to the same project.
  property_ids: z.array(z.number().int().positive()).min(1).optional(),
  project_id: z.number().int().positive().optional(),
  scheduled_date: z.string().datetime(),
  opportunity_id: z.number().int().positive().optional(),
  pick_up_requested: z.boolean().optional().default(false),
  pick_up_address: z.string().optional(),
});
export type SiteVisitCreateInput = z.infer<typeof SiteVisitCreateSchema>;

// Accept (PM/Agent accepts the routed visit)
export const SiteVisitAcceptSchema = z.object({
  notes: z.string().optional(),
});
export type SiteVisitAcceptInput = z.infer<typeof SiteVisitAcceptSchema>;

// Reassign (open chain during initial acceptance) — reason required
export const SiteVisitReassignSchema = z.object({
  to_employee_id: z.number().int().positive(),
  reason: z.string().min(3, 'Reassignment reason is required'),
});
export type SiteVisitReassignInput = z.infer<typeof SiteVisitReassignSchema>;

// Escalate to Marketing Director (no PM/Agent left to try)
export const SiteVisitEscalateSchema = z.object({
  reason: z.string().min(3, 'Escalation reason is required'),
});
export type SiteVisitEscalateInput = z.infer<typeof SiteVisitEscalateSchema>;

// Reschedule (customer requested a date/property change) or release
export const SiteVisitRescheduleSchema = z.object({
  scheduled_date: z.string().datetime().optional(),
  property_ids: z.array(z.number().int().positive()).min(1).optional(),
});
export type SiteVisitRescheduleInput = z.infer<typeof SiteVisitRescheduleSchema>;

// Confirm PM reconfirmation after a reschedule (or release back to open chain)
export const SiteVisitReconfirmSchema = z.object({
  release: z.boolean().optional().default(false),
});
export type SiteVisitReconfirmInput = z.infer<typeof SiteVisitReconfirmSchema>;

// Complete — one outcome row per linked property (outcome_reason required if NOT_INTERESTED)
export const SiteVisitOutcomeSchema = z.object({
  property_id: z.number().int().positive(),
  outcome: z.enum(['INTERESTED', 'NOT_INTERESTED']),
  outcome_reason: z.string().optional(),
});
export type SiteVisitOutcomeInput = z.infer<typeof SiteVisitOutcomeSchema>;

export const SiteVisitCompleteSchema = z.object({
  // No .min(1): a visit with no property attached (a valid, real booking
  // state — see SiteVisitCreateSchema's optional property_id) has nothing to
  // record an outcome for, and requiring at least one made every such visit's
  // completion permanently reject with "outcomes: Required" from the real UI,
  // which never collected/sent this field at all until it was wired up.
  outcomes: z.array(SiteVisitOutcomeSchema).default([]),
  feedback_notes: z.string().optional(),
  proof_photo_url: z.string().optional(),
});
export type SiteVisitCompleteInput = z.infer<typeof SiteVisitCompleteSchema>;

export const SiteVisitCancelConfirmSchema = z.object({
  reason: z.string().min(1, "A cancellation reason is required"),
});
export type SiteVisitCancelConfirmInput = z.infer<typeof SiteVisitCancelConfirmSchema>;

// Generic update (used by older/aux endpoints; status is free-form here but
// routed through the §2 workflow engine in the service layer).
export const SiteVisitUpdateSchema = z.object({
  scheduled_date: z.string().datetime().optional(),
  status: z.string().optional(),
  notes: z.string().optional(),
  confirmed: z.boolean().optional(),
  verification_notes: z.string().optional(),
  agent_id: z.number().int().positive().optional(),
  rating: z.string().optional(),
  feedback_notes: z.string().optional(),
  proof_photo_url: z.string().optional(),
});
export type SiteVisitUpdateInput = z.infer<typeof SiteVisitUpdateSchema>;
