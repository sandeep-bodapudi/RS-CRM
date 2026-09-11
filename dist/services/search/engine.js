"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rankProperties = exports.rankByRequirementModel = exports.evaluatePropertyMatch = exports.checkCandidateEligibility = exports.evaluateField = exports.normalizeQueryToRequirements = void 0;
const PRIORITY_FACTOR = {
    LOW: 1,
    MEDIUM: 1.5,
    HIGH: 2,
};
const UNKNOWN_SATISFACTION = 0.5;
const MISSING_SATISFACTION = 0.35;
const NOT_APPLICABLE_SATISFACTION = 0.5;
function createEmptyExplanation() {
    return {
        score: 1,
        band: 'EXCELLENT',
        matched: [],
        partial: [],
        deviations: [],
        unknown: [],
        missing: [],
        notApplicable: [],
    };
}
function normalizeQueryToRequirements(query) {
    const requirements = [];
    if (query.location) {
        requirements.push({
            field: 'location',
            operator: 'EQUALS',
            value: query.location.trim(),
            importance: 'STRONG_PREFERENCE',
            flexibility: 'MEDIUM',
        });
    }
    if (query.propertyType) {
        requirements.push({
            field: 'propertyType',
            operator: 'EQUALS',
            value: query.propertyType,
            importance: 'HARD',
            flexibility: 'LOW',
        });
    }
    if (query.listingType && query.listingType !== 'ANY') {
        requirements.push({
            field: 'listingType',
            operator: 'EQUALS',
            value: query.listingType,
            importance: 'STRONG_PREFERENCE',
            flexibility: 'LOW',
        });
    }
    if (query.minBudget != null || query.maxBudget != null) {
        requirements.push({
            field: 'price',
            operator: 'BETWEEN',
            value: [query.minBudget ?? 0, query.maxBudget ?? Infinity],
            importance: 'HARD',
            flexibility: 'HIGH',
            tolerance: 0.15,
        });
    }
    if (query.possessionStatus && query.possessionStatus !== 'ANY') {
        requirements.push({
            field: 'possessionStatus',
            operator: 'EQUALS',
            value: query.possessionStatus,
            importance: 'STRONG_PREFERENCE',
            flexibility: 'LOW',
        });
    }
    return { requirements };
}
exports.normalizeQueryToRequirements = normalizeQueryToRequirements;
function match(reason, requestedValue, matchedValue) {
    return { satisfaction: 1, status: 'MATCH', reason, requestedValue, matchedValue };
}
function mismatch(reason, requestedValue, actualValue) {
    return { satisfaction: 0, status: 'MISMATCH', reason, requestedValue, deviation: actualValue };
}
function partial(reason, satisfaction, requestedValue, actualValue) {
    return { satisfaction, status: 'PARTIAL', reason, requestedValue, deviation: actualValue };
}
function missing(reason, requestedValue) {
    return { satisfaction: MISSING_SATISFACTION, status: 'MISSING', reason, requestedValue };
}
function unknown(reason, requestedValue) {
    return { satisfaction: UNKNOWN_SATISFACTION, status: 'UNKNOWN', reason, requestedValue };
}
function notApplicable(reason, requestedValue) {
    return {
        satisfaction: NOT_APPLICABLE_SATISFACTION,
        status: 'NOT_APPLICABLE',
        reason,
        requestedValue,
    };
}
function getFieldValue(property, field) {
    return property[field];
}
function sentinelEvaluation(field, raw, requestedValue) {
    if (raw === undefined || raw === null) {
        return missing(`No ${field} data provided`, requestedValue);
    }
    if (raw === 'UNKNOWN') {
        return unknown(`${field} is unknown`, requestedValue);
    }
    if (raw === 'NOT_APPLICABLE') {
        return notApplicable(`${field} does not apply to this property`, requestedValue);
    }
    return null;
}
function evaluatePropertyType(property, req) {
    const actual = property.propertyType;
    if (actual === req.value) {
        return match(`${formatPropertyType(actual)} matches`, req.value, actual);
    }
    return mismatch(`Property type is ${formatPropertyType(actual)}`, req.value, actual);
}
function evaluateListingType(property, req) {
    const actual = property.listingType;
    if (actual === req.value) {
        return match(`${actual} listing matches`, req.value, actual);
    }
    return mismatch(`Listing type is ${actual}`, req.value, actual);
}
function evaluatePossession(property, req) {
    const actual = property.possessionStatus;
    if (actual === null || actual === undefined) {
        return missing('Possession status not provided', req.value);
    }
    if (actual === req.value) {
        return match(`Possession status matches (${actual})`, req.value, actual);
    }
    return mismatch(`Possession status is ${actual}`, req.value, actual);
}
function evaluateFacing(property, req) {
    const raw = property.facing;
    const sentinel = sentinelEvaluation('Facing', raw, req.value);
    if (sentinel)
        return sentinel;
    if (raw === req.value) {
        return match(`Facing matches (${raw})`, req.value, raw);
    }
    return mismatch(`Facing is ${raw}`, req.value, raw);
}
function evaluateLocation(property, req) {
    const target = String(req.value).toLowerCase().trim();
    const structured = [property.state, property.city, property.locality]
        .filter((v) => typeof v === 'string' && v.length > 0)
        .map((v) => v.toLowerCase());
    if (structured.length > 0) {
        if (structured.some((v) => v === target)) {
            return match(`Location matches (${target})`, req.value, property.location);
        }
        return mismatch(`Located at ${property.location}`, req.value, property.location);
    }
    const propLoc = property.location?.toLowerCase().trim() ?? '';
    if (!propLoc) {
        return missing('Location not provided', req.value);
    }
    if (propLoc.includes(target) || target.includes(propLoc)) {
        return match(`Location matches (${property.location})`, req.value, property.location);
    }
    return mismatch(`Located at ${property.location}`, req.value, property.location);
}
function evaluatePrice(property, req) {
    const range = req.value;
    const min = range[0] ?? 0;
    const max = range[1] ?? Infinity;
    const tolerance = req.tolerance ?? 0.15;
    const pMin = property.priceMin ?? property.price;
    const pMax = property.priceMax ?? property.price;
    const hasRange = pMin !== pMax;
    const label = property.priceFormatted || `${formatINR(pMin)}${hasRange ? `–${formatINR(pMax)}` : ''}`;
    if (pMin === undefined || pMin === null || Number.isNaN(Number(pMin))) {
        return missing('Price not provided', req.value);
    }
    if (min > 0 && max !== Infinity && pMax < min) {
        return mismatch(`Price ${label} is below the minimum budget (min ${formatINR(min)})`, req.value, property.price);
    }
    if (pMin >= min && pMax <= max) {
        return match(`Price ${label} is within budget`, req.value, property.price);
    }
    if (max !== Infinity && pMin <= max && pMin >= min && pMax > max) {
        const width = Math.max(1, pMax - pMin);
        const overlap = max - pMin;
        const ratio = Math.min(1, overlap / width);
        const satisfaction = Math.max(0.4, 0.4 + 0.6 * ratio);
        return partial(`Price range ${label} partially overlaps budget (max ${formatINR(max)})`, Math.round(satisfaction * 100) / 100, req.value, property.price);
    }
    if (max !== Infinity) {
        const excessPercent = (pMin - max) / max;
        const stretchLimit = max * (1 + tolerance);
        if (pMin <= stretchLimit) {
            const satisfaction = Math.max(0.3, 1 - excessPercent * 3);
            return partial(`Price ${label} is slightly above budget (max ${formatINR(max)})`, Math.round(satisfaction * 100) / 100, req.value, property.price);
        }
        return mismatch(`Price ${label} exceeds budget (max ${formatINR(max)})`, req.value, property.price);
    }
    return match(`Price ${label} is within budget`, req.value, property.price);
}
function evaluateParking(property, req) {
    const raw = getFieldValue(property, 'parking');
    const sentinel = sentinelEvaluation('Parking', raw, req.value);
    if (sentinel)
        return sentinel;
    const hasParking = raw === true ||
        (Array.isArray(property.amenities) &&
            property.amenities.some((a) => a.toLowerCase() === 'parking'));
    const requested = req.value;
    if (requested === true) {
        return hasParking
            ? match('Parking is available', true, true)
            : mismatch('Parking is not available', true, false);
    }
    if (requested === false) {
        return hasParking
            ? mismatch('Parking is available', false, true)
            : match('Parking is not available (matches)', false, false);
    }
    return unknown('Parking requirement is not understood', req.value);
}
function evaluateNumeric(property, req) {
    const raw = getFieldValue(property, req.field);
    const sentinel = sentinelEvaluation(req.field, raw, req.value);
    if (sentinel)
        return sentinel;
    const actual = Number(raw);
    if (Number.isNaN(actual)) {
        return unknown(`${req.field} value is not numeric`, req.value);
    }
    const requested = req.value;
    const apply = (predicate, verb) => predicate
        ? match(`${formatField(req.field)} ${verb} (${actual})`, requested, actual)
        : mismatch(`${formatField(req.field)} is ${actual}`, requested, actual);
    switch (req.operator) {
        case 'GREATER_THAN':
            return apply(actual >= Number(requested), 'matches');
        case 'LESS_THAN':
            return apply(actual <= Number(requested), 'matches');
        case 'BETWEEN': {
            const [a, b] = requested;
            return apply(actual >= a && actual <= b, 'is within range');
        }
        case 'EQUALS':
            return apply(actual === Number(requested), 'matches');
        default:
            return apply(actual === Number(requested), 'matches');
    }
}
function evaluateAmenities(property, req) {
    const raw = property.amenities;
    if (raw === undefined || raw === null || !Array.isArray(raw)) {
        return missing('No amenities data provided', req.value);
    }
    if (raw.length === 0) {
        return mismatch('None of the required amenities are available', req.value, []);
    }
    const needed = Array.isArray(req.value)
        ? req.value.map(String)
        : [String(req.value)];
    const have = raw.map((a) => a.toLowerCase());
    const found = needed.filter((n) => have.includes(n.toLowerCase()));
    if (found.length === needed.length) {
        return match(`Amenities include ${needed.join(', ')}`, req.value, found);
    }
    if (found.length > 0) {
        const satisfaction = Math.max(0.3, found.length / needed.length);
        return partial(`Only some amenities available: ${found.join(', ')}`, Math.round(satisfaction * 100) / 100, req.value, found);
    }
    return mismatch(`Amenities missing: ${needed.join(', ')}`, req.value, []);
}
const FIELD_EVALUATORS = {
    propertyType: evaluatePropertyType,
    listingType: evaluateListingType,
    possessionStatus: evaluatePossession,
    facing: evaluateFacing,
    location: evaluateLocation,
    price: evaluatePrice,
    parking: evaluateParking,
    bedrooms: evaluateNumeric,
    bathrooms: evaluateNumeric,
    areaSqft: evaluateNumeric,
    floor: evaluateNumeric,
    amenities: evaluateAmenities,
};
function evaluateField(property, req) {
    const evaluator = FIELD_EVALUATORS[req.field];
    if (!evaluator) {
        return unknown(`Field "${req.field}" is not supported by the engine`, req.value);
    }
    return evaluator(property, req);
}
exports.evaluateField = evaluateField;
function checkCandidateEligibility(property, requirements) {
    for (const req of requirements) {
        if (req.importance === 'EXCLUDED') {
            const evalResult = evaluateField(property, req);
            if (evalResult.status === 'MATCH' || evalResult.status === 'PARTIAL') {
                return false;
            }
            continue;
        }
        if (req.importance !== 'HARD')
            continue;
        const evalResult = evaluateField(property, req);
        if (evalResult.status === 'MISMATCH')
            return false;
        if (evalResult.status === 'UNKNOWN' ||
            evalResult.status === 'MISSING' ||
            evalResult.status === 'NOT_APPLICABLE') {
            return false;
        }
    }
    return true;
}
exports.checkCandidateEligibility = checkCandidateEligibility;
function categorize(evalResult, explanation) {
    switch (evalResult.status) {
        case 'MATCH':
            explanation.matched.push(evalResult.reason);
            break;
        case 'PARTIAL':
            explanation.partial.push(evalResult.reason);
            break;
        case 'MISMATCH':
            explanation.deviations.push(evalResult.reason);
            break;
        case 'UNKNOWN':
            explanation.unknown.push(evalResult.reason);
            break;
        case 'MISSING':
            explanation.missing.push(evalResult.reason);
            break;
        case 'NOT_APPLICABLE':
            explanation.notApplicable.push(evalResult.reason);
            break;
    }
}
function evaluatePropertyMatch(property, requirementModel) {
    const requirements = requirementModel.requirements;
    if (requirements.length === 0) {
        return {
            property,
            score: 1,
            tier: 'PRIMARY',
            explanation: {
                ...createEmptyExplanation(),
                matched: ['No requirements specified — every candidate matches'],
            },
        };
    }
    const explanation = createEmptyExplanation();
    let weightedScore = 0;
    let totalFactor = 0;
    for (const req of requirements) {
        const evalResult = evaluateField(property, req);
        const factor = PRIORITY_FACTOR[req.priority ?? 'LOW'];
        weightedScore += evalResult.satisfaction * factor;
        totalFactor += factor;
        categorize(evalResult, explanation);
    }
    const rawScore = totalFactor > 0 ? weightedScore / totalFactor : 1;
    const score = Math.round(rawScore * 100) / 100;
    const band = getMatchBand(score);
    const tier = getMatchTier(band);
    explanation.score = score;
    explanation.band = band;
    return { property, score, tier, explanation };
}
exports.evaluatePropertyMatch = evaluatePropertyMatch;
function rankByRequirementModel(properties, requirementModel) {
    const eligible = properties.filter((p) => checkCandidateEligibility(p, requirementModel.requirements));
    const ranked = eligible.map((p) => evaluatePropertyMatch(p, requirementModel));
    ranked.sort((a, b) => {
        if (b.score !== a.score)
            return b.score - a.score;
        return a.property.price - b.property.price;
    });
    return ranked;
}
exports.rankByRequirementModel = rankByRequirementModel;
function rankProperties(properties, query) {
    const requirementModel = normalizeQueryToRequirements(query);
    return rankByRequirementModel(properties, requirementModel);
}
exports.rankProperties = rankProperties;
function getMatchBand(score) {
    if (score >= 0.9)
        return 'EXCELLENT';
    if (score >= 0.75)
        return 'VERY_GOOD';
    if (score >= 0.6)
        return 'GOOD';
    if (score >= 0.4)
        return 'RELATED';
    return 'NO_MATCH';
}
function getMatchTier(band) {
    switch (band) {
        case 'EXCELLENT':
        case 'VERY_GOOD':
            return 'PRIMARY';
        case 'GOOD':
            return 'CLOSE';
        case 'RELATED':
            return 'RELATED';
        default:
            return 'NO_MATCH';
    }
}
function formatPropertyType(type) {
    switch (type) {
        case 'APARTMENT':
            return 'Apartment';
        case 'VILLA':
            return 'Villa';
        case 'INDEPENDENT_HOUSE':
            return 'Independent House';
        default:
            return type;
    }
}
function formatField(field) {
    switch (field) {
        case 'bedrooms':
            return 'Bedrooms';
        case 'bathrooms':
            return 'Bathrooms';
        case 'areaSqft':
            return 'Area';
        case 'floor':
            return 'Floor';
        default:
            return field;
    }
}
function formatINR(value) {
    if (!Number.isFinite(value))
        return '₹∞';
    if (value >= 10000000)
        return `₹${value / 10000000} Cr`;
    if (value >= 100000)
        return `₹${value / 100000} L`;
    return `₹${value}`;
}
