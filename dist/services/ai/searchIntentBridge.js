"use strict";
/**
 * Phase 17-C — Deterministic bridge from an AI SearchIntent to the CRM property search.
 *
 * The AI extracts a `SearchIntent`; the CRM is the SOLE authority for what matches. This
 * module:
 *   1. Translates `SearchIntentSchema` fields into deterministic `Property` query filters.
 *   2. Enforces tenant isolation — `company_id` is ALWAYS the authenticated caller's, never
 *      taken from the SearchIntent or the client.
 *   3. Enforces publication (`PropertyPublication.is_published=true`) and availability
 *      (`status` LIVE, or LOCKED with an expired lock) — BOOKED / SOLD / PENDING_* are never
 *      eligible even when the AI intent "matches" them perfectly.
 *   4. Scores and ranks matches using the CRM matching weights (location 40 / budget 40 /
 *      category 20), mirroring the existing lead-based `matchingEngine`.
 *   5. Returns a safe, minimized projection — never internal CRM fields, PII, or provider data.
 *
 * `unsupportedCriteria` from the SearchIntent are INTENTIONALLY not mapped to fabricated database
 * fields; strict filtering safely ignores them (no CRM column is invented for an unsupported term).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchCrmMatches = exports.CRMSearchError = exports.scoreAndSortPropertyRows = exports.scoreProperty = exports.deriveSearchAvailability = exports.buildCrmSearchWhere = exports.buildLocationConditions = exports.translateToPropertyFilters = exports.SEARCH_MATCH_WEIGHTS = void 0;
const prisma_1 = require("../../lib/prisma");
/** Match weights — mirrored from the CRM matching engine (utils/matchingEngine.ts). */
exports.SEARCH_MATCH_WEIGHTS = {
    LOCATION: 40,
    BUDGET: 40,
    CATEGORY: 20,
};
/** Columns read for strict filtering, scoring, and the safe projection. */
const MATCH_PROPERTY_SELECT = {
    id: true,
    property_code: true,
    title: true,
    brand_type: true,
    category: true,
    // § Phase 3: Property.price removed — final_price is now authoritative.
    final_price: true,
    area_sqft: true,
    location: true,
    state: true,
    city: true,
    bedrooms: true,
    bathrooms: true,
    facing: true,
    status: true,
    locked_until: true,
};
/**
 * Translate a SearchIntent into deterministic `Property` filter fields.
 * Tenant isolation, publication, and availability are NOT applied here (see
 * buildCrmSearchWhere). Pure and unit-testable.
 */
function translateToPropertyFilters(intent) {
    const filter = {};
    if (intent.propertyType)
        filter.category = intent.propertyType;
    if (intent.brandType)
        filter.brand_type = intent.brandType;
    if (intent.budget) {
        const budget = {};
        if (intent.budget.min !== undefined)
            budget.gte = intent.budget.min;
        if (intent.budget.max !== undefined)
            budget.lte = intent.budget.max;
        if (Object.keys(budget).length)
            filter.final_price = budget;
    }
    if (intent.bhk && intent.bhk.min !== undefined)
        filter.bedrooms = { gte: intent.bhk.min };
    if (intent.bathrooms && intent.bathrooms.min !== undefined)
        filter.bathrooms = { gte: intent.bathrooms.min };
    if (intent.area) {
        const area = {};
        if (intent.area.min !== undefined)
            area.gte = intent.area.min;
        if (intent.area.max !== undefined)
            area.lte = intent.area.max;
        if (Object.keys(area).length)
            filter.area_sqft = area;
    }
    if (intent.facing)
        filter.facing = intent.facing;
    if (intent.listingType)
        filter.listing_type = intent.listingType;
    if (intent.possessionStatus)
        filter.possession_status = intent.possessionStatus;
    // unsupportedCriteria is deliberately not mapped to a database field here.
    return filter;
}
exports.translateToPropertyFilters = translateToPropertyFilters;
/**
 * Build structured-location match conditions. Uses the Property's structured
 * `state` / `city` / `pincode` columns plus the free-text `location` column for
 * backward compatibility. Returns an empty array when no location is supplied.
 */
function buildLocationConditions(loc) {
    if (!loc)
        return [];
    const conditions = [];
    if (loc.state)
        conditions.push({ state: { contains: loc.state } });
    if (loc.city) {
        conditions.push({ city: { contains: loc.city } });
        conditions.push({ location: { contains: loc.city } });
    }
    if (loc.locality) {
        conditions.push({ locality: { contains: loc.locality } });
        conditions.push({ location: { contains: loc.locality } });
    }
    if (loc.pincode)
        conditions.push({ pincode: { contains: loc.pincode } });
    return conditions;
}
exports.buildLocationConditions = buildLocationConditions;
/**
 * Build the full CRM `Property` search `where` clause.
 * Applies tenant isolation + publication + availability ON TOP of the SearchIntent filters.
 * It is structurally impossible for a strictly-matching-but-SOLD or unpublished property to
 * appear in results.
 */
function buildCrmSearchWhere(intent, companyId) {
    const where = {
        ...translateToPropertyFilters(intent),
        company_id: companyId,
        OR: [
            { status: 'LIVE' },
            // An expired lock frees the property back to the available pool (matches deriveAvailability).
            { status: 'LOCKED', locked_until: { lt: new Date() } },
        ],
        // MUST be published to THIS company's feed — unpublished properties are excluded.
        publications: {
            some: { company_id: companyId, is_published: true },
        },
    };
    const locationConditions = buildLocationConditions(intent.location);
    if (locationConditions.length === 1) {
        Object.assign(where, locationConditions[0]);
    }
    else if (locationConditions.length > 1) {
        // Nested as an AND-of-OR so it does not clash with the availability OR at the top level.
        where.AND = [{ OR: locationConditions }];
    }
    return where;
}
exports.buildCrmSearchWhere = buildCrmSearchWhere;
/** Derived availability, mirroring property.service deriveAvailability (LIVE / expired-lock = AVAILABLE). */
function deriveSearchAvailability(status, lockedUntil) {
    if (status === 'LIVE')
        return 'AVAILABLE';
    if (status === 'LOCKED') {
        return lockedUntil && lockedUntil < new Date() ? 'AVAILABLE' : 'RESERVED';
    }
    if (status === 'BOOKED' || status === 'SOLD')
        return 'SOLD';
    return 'UNAVAILABLE';
}
exports.deriveSearchAvailability = deriveSearchAvailability;
/** Score a raw property row against the SearchIntent using the CRM weights. */
function scoreProperty(prop, intent) {
    let score = 0;
    const breakdown = { locationMatch: false, budgetMatch: false, categoryMatch: false };
    const cityPref = intent.location?.city?.toLowerCase().trim();
    const propText = `${prop.city || ''} ${prop.location || ''}`.toLowerCase().trim();
    if (cityPref) {
        const propLoc = propText || '';
        if (cityPref.includes(propLoc) || propLoc.includes(cityPref)) {
            score += exports.SEARCH_MATCH_WEIGHTS.LOCATION;
            breakdown.locationMatch = true;
        }
        else {
            const words = cityPref.split(/[\s,/]+/);
            if (words.some((w) => w.length > 3 && propLoc.includes(w))) {
                score += 25;
                breakdown.locationMatch = true;
            }
        }
    }
    else if (intent.location) {
        score += 20;
    }
    const max = intent.budget?.max;
    const min = intent.budget?.min;
    const price = Number(prop.final_price || 0);
    if (max && price <= max) {
        score += exports.SEARCH_MATCH_WEIGHTS.BUDGET;
        breakdown.budgetMatch = true;
    }
    else if (max && price <= max * 1.15) {
        score += 20;
        breakdown.budgetMatch = true;
    }
    else if (min && price >= min) {
        score += exports.SEARCH_MATCH_WEIGHTS.BUDGET;
        breakdown.budgetMatch = true;
    }
    else {
        score += 20;
    }
    const propCat = String(prop.category || '').toLowerCase();
    const propBrand = String(prop.brand_type || '').toLowerCase();
    const prefCat = String(intent.propertyType || '').toLowerCase();
    const prefBrand = String(intent.brandType || '').toLowerCase();
    const catHit = Boolean((prefCat && (prefCat === propCat || propCat.includes(prefCat))) ||
        (prefBrand && propBrand === prefBrand));
    score += catHit ? exports.SEARCH_MATCH_WEIGHTS.CATEGORY : 10;
    return { score: Math.min(100, score), breakdown: { ...breakdown, categoryMatch: catHit } };
}
exports.scoreProperty = scoreProperty;
/** Shape + score + sort rows (highest matchScore first). */
function scoreAndSortPropertyRows(rows, intent) {
    return rows
        .map((prop) => {
        const { score, breakdown } = scoreProperty(prop, intent);
        return {
            propertyId: prop.id,
            propertyCode: prop.property_code,
            title: prop.title,
            brandType: prop.brand_type,
            category: prop.category,
            price: Number(prop.final_price),
            areaSqft: Number(prop.area_sqft),
            location: prop.location,
            state: prop.state,
            city: prop.city,
            bedrooms: prop.bedrooms,
            bathrooms: prop.bathrooms,
            facing: prop.facing,
            availability: deriveSearchAvailability(prop.status, prop.locked_until ?? null),
            matchScore: score,
            matchBreakdown: breakdown,
        };
    })
        .sort((a, b) => b.matchScore - a.matchScore);
}
exports.scoreAndSortPropertyRows = scoreAndSortPropertyRows;
/** Marker for a controlled CRM-search failure (e.g. database unavailable). */
class CRMSearchError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CRMSearchError';
    }
}
exports.CRMSearchError = CRMSearchError;
/**
 * Run the deterministic CRM property search for a SearchIntent.
 * `companyId` must be the authenticated caller's companyId (server-derived), never client input.
 * The query enforces tenant isolation + publication + availability. Returns [] for a legitimate
 * zero-result match. `<db>` is injectable only for tests.
 */
async function searchCrmMatches(intent, companyId, db) {
    const client = db ?? prisma_1.prisma;
    const c = client;
    const where = buildCrmSearchWhere(intent, companyId);
    try {
        const rows = await c.property.findMany({
            where,
            select: MATCH_PROPERTY_SELECT,
            orderBy: { created_at: 'desc' },
            take: 50,
        });
        return scoreAndSortPropertyRows(rows ?? [], intent);
    }
    catch (err) {
        throw new CRMSearchError(err instanceof Error ? err.message : 'CRM property search failed');
    }
}
exports.searchCrmMatches = searchCrmMatches;
