import { z } from 'zod';

// ─────────────────────────────────────────────────────────────
// Message Template Schema (§5)
// ─────────────────────────────────────────────────────────────
export const MessageTemplateSchema = z.object({
  template_key: z.string().min(2).max(191),
  name: z.string().min(1).max(191),
  body_text: z.string().min(1),
  is_active: z.boolean().optional().default(true),
});
export type MessageTemplateInput = z.infer<typeof MessageTemplateSchema>;

// §5 — stable template_key values for the WhatsApp deep-link touchpoints.
// These are the canonical lookup keys used by resolveTemplate() and by the
// admin template editor. The body_text of each supports the placeholders
// {customer_name}, {property_name}, {pm_name}, {visit_date}.
export const MessageTemplateKey = {
  LEAD_QUALIFIED_PROPERTIES: 'LEAD_QUALIFIED_PROPERTIES', // legacy/alias
  LEAD_PROPERTY_PROPOSAL: 'LEAD_PROPERTY_PROPOSAL', // matched property list + invite to discuss
  DEMO_SCHEDULED: 'DEMO_SCHEDULED', // confirm demo date/time
  SITE_VISIT_SCHEDULED: 'SITE_VISIT_SCHEDULED', // schedule confirmation
  SITE_VISIT_ACCEPTED: 'SITE_VISIT_ACCEPTED', // attending PM/Agent name, phone, property, date/time
  DAY_BEFORE_RECONFIRMATION: 'DAY_BEFORE_RECONFIRMATION', // "confirming your visit tomorrow at X"
  RESCHEDULE_CONFIRMED: 'RESCHEDULE_CONFIRMED', // new date/time confirmation
  POST_VISIT_INTERESTED: 'POST_VISIT_INTERESTED', // thank-you + next steps toward booking
  BOOKING_CONFIRMED: 'BOOKING_CONFIRMED', // welcome + portal credentials
} as const;
export type MessageTemplateKeyType = typeof MessageTemplateKey[keyof typeof MessageTemplateKey];
