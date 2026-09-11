"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRecommendations = void 0;
const engine_1 = require("./engine");
/**
 * A single "You may also like" group, built from a broader candidate pool
 * with the same query loosened to preferences instead of hard gates — so a
 * villa search that returns 0 exact matches can still surface nearby villas
 * or ones just outside budget, rather than a dead end.
 *
 * This deliberately simplifies the original BFF pipeline's multi-group,
 * behaviorally-personalized recommendation engine (which read a much richer
 * cross-session interaction history) down to one well-reasoned group. The
 * "recently viewed" exclusion is preserved since it's cheap and meaningful;
 * a fuller personalization pass can build on this later if it's needed.
 */
function buildRecommendations(pool, query, excludeIds, recentlyViewedIds = [], limit = 8) {
    const excluded = new Set(excludeIds);
    const candidates = pool.filter((p) => !excluded.has(p.id));
    if (candidates.length === 0)
        return [];
    const loosened = { requirements: [] };
    if (query.propertyType) {
        loosened.requirements.push({
            field: 'propertyType',
            operator: 'EQUALS',
            value: query.propertyType,
            importance: 'STRONG_PREFERENCE',
            priority: 'HIGH',
        });
    }
    if (query.location) {
        loosened.requirements.push({
            field: 'location',
            operator: 'EQUALS',
            value: query.location,
            importance: 'SOFT_PREFERENCE',
            priority: 'MEDIUM',
        });
    }
    if (query.minBudget != null || query.maxBudget != null) {
        loosened.requirements.push({
            field: 'price',
            operator: 'BETWEEN',
            value: [query.minBudget ?? 0, query.maxBudget ?? Infinity],
            importance: 'SOFT_PREFERENCE',
            priority: 'MEDIUM',
            tolerance: 0.3,
        });
    }
    const ranked = (0, engine_1.rankByRequirementModel)(candidates, loosened)
        .filter((r) => r.tier !== 'NO_MATCH')
        .sort((a, b) => {
        const aViewed = recentlyViewedIds.includes(a.property.id) ? 1 : 0;
        const bViewed = recentlyViewedIds.includes(b.property.id) ? 1 : 0;
        if (aViewed !== bViewed)
            return bViewed - aViewed; // recently-viewed similar items surface first
        return b.score - a.score;
    })
        .slice(0, limit)
        .map((r) => r.property);
    if (ranked.length === 0)
        return [];
    return [{ title: 'You may also like', properties: ranked }];
}
exports.buildRecommendations = buildRecommendations;
