"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateLeadScore = exports.syncLeadPreferredLocations = exports.generateNextLeadCode = void 0;
const prisma_1 = require("../../lib/prisma");
const p = prisma_1.prisma;
/**
 * Helper to generate sequential static lead code: RRH-LD-YYYY-XXXX
 */
async function generateNextLeadCode() {
    const currentYear = new Date().getFullYear();
    const count = await p.lead.count();
    const sequentialNum = (count + 1).toString().padStart(4, '0');
    return `RRH-LD-${currentYear}-${sequentialNum}`;
}
exports.generateNextLeadCode = generateNextLeadCode;
/**
 * Replaces a lead's full preferred-location list (§ Phase 2). Case-insensitive
 * de-dupe before insert — MySQL's utf8mb4_unicode_ci collation already treats
 * case-variants as the same unique key, so an un-deduped array would throw.
 * Caller is responsible for also keeping `Lead.preferred_location` (the
 * primary/first entry) in sync — this only manages the full-list table.
 */
async function syncLeadPreferredLocations(tx, leadId, locations) {
    const seen = new Set();
    const deduped = [];
    for (const raw of locations) {
        const loc = raw.trim();
        if (!loc)
            continue;
        const key = loc.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            deduped.push(loc);
        }
    }
    await tx.leadPreferredLocation.deleteMany({ where: { lead_id: leadId } });
    if (deduped.length > 0) {
        await tx.leadPreferredLocation.createMany({
            data: deduped.map((location, idx) => ({ lead_id: leadId, location, sort_order: idx })),
        });
    }
}
exports.syncLeadPreferredLocations = syncLeadPreferredLocations;
function calculateLeadScore(leadData) {
    let score = 0;
    // Base score based on source
    if (leadData.source === 'WALK_IN' || leadData.source === 'REFERRAL')
        score += 20;
    else if (leadData.source === 'WEBSITE')
        score += 10;
    // Profile completeness
    if (leadData.email)
        score += 10;
    if (leadData.budget_min && leadData.budget_max)
        score += 15;
    if (leadData.preferred_location)
        score += 10;
    if (leadData.property_type_preference)
        score += 5;
    return score;
}
exports.calculateLeadScore = calculateLeadScore;
