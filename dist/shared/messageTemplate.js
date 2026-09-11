"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageTemplateKey = exports.MessageTemplateSchema = void 0;
const zod_1 = require("zod");
// ─────────────────────────────────────────────────────────────
// Message Template Schema (§5)
// ─────────────────────────────────────────────────────────────
exports.MessageTemplateSchema = zod_1.z.object({
    template_key: zod_1.z.string().min(2).max(191),
    name: zod_1.z.string().min(1).max(191),
    body_text: zod_1.z.string().min(1),
    is_active: zod_1.z.boolean().optional().default(true),
});
// §5 — stable template_key values for the WhatsApp deep-link touchpoints.
// These are the canonical lookup keys used by resolveTemplate() and by the
// admin template editor. The body_text of each supports the placeholders
// {customer_name}, {property_name}, {pm_name}, {visit_date}.
exports.MessageTemplateKey = {
    LEAD_QUALIFIED_PROPERTIES: 'LEAD_QUALIFIED_PROPERTIES', // legacy/alias
    LEAD_PROPERTY_PROPOSAL: 'LEAD_PROPERTY_PROPOSAL', // matched property list + invite to discuss
    DEMO_SCHEDULED: 'DEMO_SCHEDULED', // confirm demo date/time
    SITE_VISIT_SCHEDULED: 'SITE_VISIT_SCHEDULED', // schedule confirmation
    SITE_VISIT_ACCEPTED: 'SITE_VISIT_ACCEPTED', // attending PM/Agent name, phone, property, date/time
    DAY_BEFORE_RECONFIRMATION: 'DAY_BEFORE_RECONFIRMATION', // "confirming your visit tomorrow at X"
    RESCHEDULE_CONFIRMED: 'RESCHEDULE_CONFIRMED', // new date/time confirmation
    POST_VISIT_INTERESTED: 'POST_VISIT_INTERESTED', // thank-you + next steps toward booking
    BOOKING_CONFIRMED: 'BOOKING_CONFIRMED', // welcome + portal credentials
};
