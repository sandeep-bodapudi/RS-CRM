"use strict";
/**
 * Reusable WhatsApp utility for generating pre-filled wa.me links based on standardized templates.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateWhatsAppLink = exports.sanitizePhoneForWhatsApp = void 0;
const WHATSAPP_TEMPLATES = {
    PM_CONTACT_RELAY: 'Hi {{customer_name}}, this is regarding your upcoming site visit for {{project_name}}. Your Project Manager is {{pm_name}} ({{pm_phone}}). Please coordinate with them for any immediate questions.',
    RESCHEDULE_REQUEST: 'Hi {{customer_name}}, we noticed you requested a reschedule for your site visit at {{project_name}}. Could you let us know your preferred new date and time?',
    CREDENTIAL_DELIVERY: 'Hi {{customer_name}}, welcome to RRH! You can track your site visits and properties on our customer portal. Your login is: {{phone}} and your temporary password is: {{password}}.',
    PROPERTY_SHARE: 'Hi {{customer_name}}, here are the details for the property we discussed: {{property_link}}',
    SITE_VISIT_FEEDBACK: 'Hi {{customer_name}}, thank you for visiting with {{pm_name}}! We would love a minute of your feedback: {{feedback_link}}',
};
/**
 * Sanitizes a phone number for WhatsApp links (removes non-digits).
 */
function sanitizePhoneForWhatsApp(phone) {
    // Remove any character that is not a digit
    const cleaned = phone.replace(/\D/g, '');
    // Default to 91 if no country code provided and length is 10
    if (cleaned.length === 10) {
        return `91${cleaned}`;
    }
    return cleaned;
}
exports.sanitizePhoneForWhatsApp = sanitizePhoneForWhatsApp;
/**
 * Generates a wa.me URL with pre-filled text based on a template.
 *
 * @param phone The recipient's phone number
 * @param templateId The ID of the template to use
 * @param params Key-value pairs to replace in the template (e.g., { customer_name: 'John' })
 * @returns The formatted https://wa.me/... URL
 */
function generateWhatsAppLink(phone, templateId, params) {
    const sanitizedPhone = sanitizePhoneForWhatsApp(phone);
    let text = WHATSAPP_TEMPLATES[templateId] || '';
    // Replace all {{key}} with values from params
    for (const [key, value] of Object.entries(params)) {
        const placeholder = `{{${key}}}`;
        // Split and join is a robust way to replace all occurrences without worrying about regex escaping
        text = text.split(placeholder).join(value);
    }
    const encodedText = encodeURIComponent(text);
    return `https://wa.me/${sanitizedPhone}?text=${encodedText}`;
}
exports.generateWhatsAppLink = generateWhatsAppLink;
