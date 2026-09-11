"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.removePropertyInterest = exports.addPropertyInterest = exports.sendWhatsAppProposal = void 0;
const prisma_1 = require("../../lib/prisma");
const authorization_1 = require("../../authz/authorization");
const shared_1 = require("../../shared");
const messageTemplate_service_1 = require("../messageTemplate.service");
const errors_1 = require("./errors");
const p = prisma_1.prisma;
async function sendWhatsAppProposal(user, leadId, propertyId) {
    const lead = await p.lead.findFirst({
        where: { id: leadId },
        include: { assigned_to: true },
    });
    if (!lead)
        throw new errors_1.AppError(404, 'Lead not found');
    if (!(0, authorization_1.can)(user, shared_1.Permissions.LEADS_UPDATE, lead)) {
        throw new errors_1.AppError(403, 'Forbidden: You do not have permission to propose properties to this lead');
    }
    const property = await p.property.findFirst({ where: { id: propertyId } });
    if (!property)
        throw new errors_1.AppError(404, 'Property not found');
    const company = await p.company.findFirst({ where: { id: user.companyId } });
    // §5: resolve WhatsApp body from the MessageTemplate table (template_key
    // LEAD_PROPERTY_PROPOSAL), never from a hardcoded inline string. Falls back to
    // a safe situation-specific text containing the variables when no active template is configured.
    const templateKey = 'LEAD_PROPERTY_PROPOSAL';
    const formattedPrice = property.final_price
        ? `${(property.final_price / 100000).toFixed(1)} Lakhs`
        : 'On Request';
    const resolved = await messageTemplate_service_1.MessageTemplateService.resolveWithFallback(templateKey, {
        customer_name: lead.customer_name ?? '',
        customer_phone: lead.phone ?? '',
        property_name: property.title ?? '',
        property_location: property.location ?? '',
        property_price: formattedPrice,
        property_code: property.property_code ?? '',
        pm_name: property.assigned_pm_id
            ? ((await p.employee.findFirst({ where: { id: property.assigned_pm_id } }))?.full_name ??
                'Property Manager')
            : 'Property Manager',
        agent_name: lead.assigned_to?.full_name ?? lead.assigned_to?.employee_code ?? 'Advisory Desk',
        visit_date: new Date().toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
        }),
        lead_code: lead.lead_code ?? '',
        company_name: company?.name ?? 'Our Company',
    });
    const text = resolved.body_text;
    const cleanPhone = lead.phone.replace(/[^0-9]/g, '');
    const whatsAppUrl = `https://wa.me/${cleanPhone.startsWith('91') ? cleanPhone : '91' + cleanPhone}?text=${encodeURIComponent(text)}`;
    // §3: emit WHATSAPP_SENT with the template key embedded in notes
    // (the spec §3 registry item: "WHATSAPP_SENT (with which template key)").
    const activityNotes = `WhatsApp proposal sent using template ${templateKey} for Property ${property.property_code} (${property.title})`;
    await p.leadActivity.create({
        data: {
            lead_id: leadId,
            actor_id: user.employeeId || 1,
            activity_type: 'WHATSAPP_SENT',
            notes: activityNotes,
        },
    });
    return { whatsAppUrl, whatsAppText: text, templateKey };
}
exports.sendWhatsAppProposal = sendWhatsAppProposal;
async function addPropertyInterest(user, leadId, propertyId) {
    const lead = await p.lead.findFirst({ where: { id: leadId } });
    if (!lead)
        throw new errors_1.AppError(404, 'Lead not found');
    if (!(0, authorization_1.can)(user, shared_1.Permissions.LEADS_UPDATE, lead)) {
        throw new errors_1.AppError(403, 'Forbidden: You do not have permission to modify this lead');
    }
    const property = await p.property.findFirst({
        where: { id: propertyId, company_id: lead.company_id },
    });
    if (!property) {
        throw new Error('Property not found');
    }
    return await p.$transaction(async (tx) => {
        const interest = await tx.leadPropertyInterest.upsert({
            where: {
                lead_id_property_id: {
                    lead_id: leadId,
                    property_id: propertyId,
                },
            },
            update: { is_active: true },
            create: {
                lead_id: leadId,
                property_id: propertyId,
                created_by: user.employeeId || 1,
            },
        });
        await tx.leadActivity.create({
            data: {
                lead_id: leadId,
                actor_id: user.employeeId || 1,
                activity_type: 'PROPERTY_INTEREST_ADDED',
                notes: `Added interest in Property ${property.property_code} (${property.title})`,
            },
        });
        return interest;
    });
}
exports.addPropertyInterest = addPropertyInterest;
async function removePropertyInterest(user, leadId, propertyId) {
    const lead = await p.lead.findFirst({ where: { id: leadId } });
    if (!lead)
        throw new errors_1.AppError(404, 'Lead not found');
    if (!(0, authorization_1.can)(user, shared_1.Permissions.LEADS_UPDATE, lead)) {
        throw new errors_1.AppError(403, 'Forbidden: You do not have permission to modify this lead');
    }
    const interest = await p.leadPropertyInterest.findUnique({
        where: { lead_id_property_id: { lead_id: leadId, property_id: propertyId } },
        include: { property: true },
    });
    if (!interest) {
        throw new errors_1.AppError(404, 'Property interest not found');
    }
    return await p.$transaction(async (tx) => {
        await tx.leadPropertyInterest.update({
            where: { id: interest.id },
            data: { is_active: false },
        });
        await tx.leadActivity.create({
            data: {
                lead_id: leadId,
                actor_id: user.employeeId || 1,
                activity_type: 'PROPERTY_INTEREST_REMOVED',
                // An interest row points at either a standalone Property or a project
                // unit, so neither relation is guaranteed to be loaded.
                notes: interest.property
                    ? `Removed interest in Property ${interest.property.property_code} (${interest.property.title})`
                    : `Removed interest in unit #${interest.project_unit_id ?? 'unknown'}`,
            },
        });
        return { success: true, message: 'Property interest removed successfully' };
    });
}
exports.removePropertyInterest = removePropertyInterest;
