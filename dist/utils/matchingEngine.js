"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchDroppedLeadsToProperty = exports.findMatchingPropertiesForLead = void 0;
const prisma_1 = require("../lib/prisma");
const messageTemplate_service_1 = require("../services/messageTemplate.service");
const p = prisma_1.prisma;
/**
 * A lead may now have multiple preferred locations (§ Phase 2). Prefers the
 * full list when present; falls back to the legacy single scalar for leads
 * created before this feature (or that never used the multi-location UI).
 */
function getLeadLocationCandidates(lead) {
    if (lead.preferred_locations && lead.preferred_locations.length > 0) {
        return lead.preferred_locations.map((l) => l.location);
    }
    return lead.preferred_location ? [lead.preferred_location] : [];
}
const findMatchingPropertiesForLead = async (leadId) => {
    const lead = await p.lead.findUnique({
        where: { id: leadId },
        include: { assigned_to: true, preferred_locations: true },
    });
    if (!lead)
        return [];
    // Fetch all LIVE properties for lead's company
    const liveProperties = await p.property.findMany({
        where: {
            company_id: lead.company_id,
            status: 'LIVE',
        },
    });
    const results = [];
    for (const prop of liveProperties) {
        let score = 0;
        let locationMatch = false;
        let budgetMatch = false;
        let categoryMatch = false;
        // 1. Location Match (Weight: 40 points) — best score across ALL of the
        // lead's preferred locations (§ Phase 2), not just the primary one, so a
        // lead interested in 3 areas matches a property in any of them.
        const locationCandidates = getLeadLocationCandidates(lead);
        if (locationCandidates.length > 0 && prop.location) {
            const propLoc = prop.location.toLowerCase();
            let bestLocationScore = 0;
            for (const candidate of locationCandidates) {
                const prefLoc = candidate.toLowerCase();
                if (prefLoc.includes(propLoc) || propLoc.includes(prefLoc)) {
                    bestLocationScore = Math.max(bestLocationScore, 40);
                }
                else {
                    const prefWords = prefLoc.split(/[\s,/]+/);
                    const hasWordMatch = prefWords.some((w) => w.length > 3 && propLoc.includes(w));
                    if (hasWordMatch) {
                        bestLocationScore = Math.max(bestLocationScore, 25);
                    }
                }
            }
            score += bestLocationScore;
            locationMatch = bestLocationScore > 0;
        }
        else {
            score += 20; // neutral fallback
        }
        // 2. Budget Fit (Weight: 40 points)
        if (lead.budget_max && lead.budget_max > 0) {
            if (prop.final_price <= lead.budget_max) {
                score += 40;
                budgetMatch = true;
            }
            else if (prop.final_price <= lead.budget_max * 1.15) {
                score += 20; // 15% budget flex match
                budgetMatch = true;
            }
        }
        else {
            score += 20; // fallback if no budget max set
        }
        // 3. Category & BHK Fit (Weight: 20 points)
        if (lead.property_type_preference) {
            const prefType = lead.property_type_preference.toLowerCase();
            const propCat = prop.category.toLowerCase();
            const propBrand = prop.brand_type.toLowerCase();
            if (prefType.includes(propCat) ||
                propCat.includes(prefType) ||
                prefType.includes(propBrand)) {
                score += 20;
                categoryMatch = true;
            }
        }
        else {
            score += 10;
        }
        // §5: Resolve WhatsApp body from MessageTemplate table via template_key,
        // never hardcoded strings. Falls back to a safe inline text when no active
        // template is configured (admin must populate LEAD_QUALIFIED_PROPERTIES).
        const whatsAppText = await resolveWhatsAppTextForProperty(lead, prop);
        const cleanPhone = lead.phone.replace(/[^0-9]/g, '');
        const whatsAppUrl = `https://wa.me/${cleanPhone.startsWith('91') ? cleanPhone : '91' + cleanPhone}?text=${encodeURIComponent(whatsAppText)}`;
        results.push({
            propertyId: prop.id,
            propertyCode: prop.property_code,
            title: prop.title,
            brandType: prop.brand_type,
            category: prop.category,
            price: prop.final_price,
            areaSqft: prop.area_sqft,
            location: prop.location,
            bedrooms: prop.bedrooms ?? undefined,
            facing: prop.facing ?? undefined,
            matchScore: Math.min(100, score),
            matchBreakdown: {
                locationMatch,
                budgetMatch,
                categoryMatch,
            },
            whatsAppText,
            whatsAppUrl,
        });
    }
    // Sort by match score descending
    return results.sort((a, b) => b.matchScore - a.matchScore);
};
exports.findMatchingPropertiesForLead = findMatchingPropertiesForLead;
/**
 * §5 — Resolve the WhatsApp body text for a property proposal from the
 * `MessageTemplate` table via `MessageTemplateService.resolve()`.
 *
 * Uses the canonical template_key `LEAD_QUALIFIED_PROPERTIES` (spec §5 table
 * row 1: "Lead qualified, properties matched — Share matched property list +
 * invite to discuss"). The template body supports the placeholders
 * {customer_name}, {property_name}, {pm_name}, {visit_date}.
 *
 * Returns a safe inline fallback text when no ACTIVE template is configured,
 * so the matching engine can never break because an admin hasn't populated the
 * template table yet. Admin screen (routes/messageTemplates.ts) is the single
 * place to edit templates.
 */
async function resolveWhatsAppTextForProperty(lead, prop) {
    const templateKey = 'LEAD_QUALIFIED_PROPERTIES';
    const resolved = await messageTemplate_service_1.MessageTemplateService.resolve(templateKey, {
        customer_name: lead.customer_name ?? '',
        property_name: prop.title ?? '',
        pm_name: lead.assigned_to?.full_name ??
            lead.assigned_to?.employee_code ??
            'Radha Real Homes Advisory Desk',
        visit_date: new Date().toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
        }),
    });
    if (resolved && resolved.body_text) {
        return resolved.body_text;
    }
    // Safe fallback when admin hasn't populated the template yet.
    // Do NOT hardcode the production template here — this is only a
    // no-broken-experience stopgap. The real content lives in the
    // MessageTemplate table row for LEAD_QUALIFIED_PROPERTIES.
    const brandName = prop.brand_type === 'SONTHILLU' ? 'SONTHILLU RESIDENTIAL' : 'RADHA REAL HOMES';
    return `🏡 *EXCLUSIVE PROPERTY PROPOSAL FROM ${brandName}*

Dear *${lead.customer_name}*,

We found a premium property matching your exact requirements!

📌 *Title*: ${prop.title}
📍 *Location*: ${prop.location}
📐 *Area*: ${prop.area_sqft} sq.ft (${prop.bedrooms ? prop.bedrooms + ' BHK' : prop.category})
🧭 *Facing*: ${prop.facing || 'East'}
💰 *Asking Price*: ₹${(prop.final_price / 100000).toFixed(1)} Lakhs

📝 *Highlights*: ${prop.description || 'Prime location with high growth potential and immediate registration.'}

📞 *Your Dedicated Relationship Manager*:
${lead.assigned_to?.full_name || lead.assigned_to?.employee_code || 'Radha Real Homes Advisory Desk'} (${lead.assigned_to?.phone || '+91 99000 11222'})

Reply to this message or call us directly to schedule an exclusive site visit!`;
}
/**
 * § Phase E: Mechanism 1 - Automatic Inventory Matching
 * Finds all dropped leads (due to NO_MATCHING_INVENTORY) that match a given property.
 * Criteria: Strict Location match AND Budget range overlap.
 */
const matchDroppedLeadsToProperty = async (propertyId) => {
    const prop = await p.property.findUnique({
        where: { id: propertyId },
    });
    if (!prop || prop.status !== 'LIVE')
        return [];
    // Fetch candidate leads
    const candidateLeads = await p.lead.findMany({
        where: {
            company_id: prop.company_id,
            status: 'DROPPED',
            exit_reason: 'NO_MATCHING_INVENTORY',
        },
        include: { preferred_locations: true },
    });
    const matchedLeadIds = [];
    for (const lead of candidateLeads) {
        let locationMatch = false;
        let budgetMatch = false;
        // 1. Location Match — any of the lead's preferred locations (§ Phase 2)
        const dropLocationCandidates = getLeadLocationCandidates(lead);
        if (dropLocationCandidates.length > 0 && prop.location) {
            const propLoc = prop.location.toLowerCase();
            locationMatch = dropLocationCandidates.some((candidate) => {
                const prefLoc = candidate.toLowerCase();
                if (prefLoc.includes(propLoc) || propLoc.includes(prefLoc))
                    return true;
                const prefWords = prefLoc.split(/[\s,/]+/);
                return prefWords.some((w) => w.length > 3 && propLoc.includes(w));
            });
        }
        // 2. Budget Overlap (allow 15% flex)
        if (lead.budget_max && lead.budget_max > 0) {
            if (prop.final_price <= lead.budget_max * 1.15) {
                budgetMatch = true;
            }
        }
        // Require both
        if (locationMatch && budgetMatch) {
            matchedLeadIds.push(lead.id);
        }
    }
    return matchedLeadIds;
};
exports.matchDroppedLeadsToProperty = matchDroppedLeadsToProperty;
