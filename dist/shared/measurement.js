"use strict";
/**
 * Canonical area/measurement logic for all inventory (project units + standalone
 * properties).
 *
 * This replaces two divergent, incompatible AREA_UNITS vocabularies that existed
 * before:
 *   - apps/web/src/components/properties/propertyWizardShared.tsx  (SQFT/SQYD/ACRE/GUNTA, switch-based)
 *   - apps/web/src/components/properties/AddPropertyWizard.tsx     (SQFT/SQMT/ACRES/GUNTHA/CENTS/PERCH, factor-based)
 * Two vocabularies meant the same plot could price differently depending on which
 * screen created it. There is now exactly one table of factors, here.
 *
 * Sq.ft is the canonical storage unit. Sq.yd is stored alongside it because plots
 * in Telangana/AP are bought and sold in Sq.Yds — dropping that loses the unit the
 * sales team actually negotiates in.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatAreaDual = exports.resolveBasisAreaSqft = exports.validateFlatAreas = exports.loadingFactor = exports.dimensionsDisagree = exports.areaFromDimensions = exports.normalizeArea = exports.convertArea = exports.fromSqft = exports.toSqft = exports.round = exports.isAreaUnit = exports.PRICE_BASIS_LABELS = exports.PriceBasis = exports.AREA_UNIT_LABELS = exports.SQFT_PER_UNIT = exports.AreaUnit = void 0;
exports.AreaUnit = {
    SQFT: 'SQFT',
    SQYD: 'SQYD',
    SQM: 'SQM',
    ACRE: 'ACRE',
    GUNTA: 'GUNTA',
    CENT: 'CENT',
    ANKANAM: 'ANKANAM',
    HECTARE: 'HECTARE',
};
/** Square feet per one unit. The single source of truth for every conversion. */
exports.SQFT_PER_UNIT = {
    SQFT: 1,
    SQYD: 9,
    SQM: 10.763910416709722,
    ACRE: 43560,
    GUNTA: 1089, // 1 acre = 40 guntas
    CENT: 435.6, // 1 acre = 100 cents
    ANKANAM: 72, // 1 ankanam = 8 sq.yd (Andhra/Telangana)
    HECTARE: 107639.10416709722,
};
exports.AREA_UNIT_LABELS = {
    SQFT: 'Sq.Ft',
    SQYD: 'Sq.Yds',
    SQM: 'Sq.M',
    ACRE: 'Acres',
    GUNTA: 'Guntas',
    CENT: 'Cents',
    ANKANAM: 'Ankanams',
    HECTARE: 'Hectares',
};
/** Which measured area a price rate is applied against. */
exports.PriceBasis = {
    CARPET: 'CARPET',
    BUILT_UP: 'BUILT_UP',
    SUPER_BUILT_UP: 'SUPER_BUILT_UP',
    PLOT_AREA: 'PLOT_AREA',
    LUMPSUM: 'LUMPSUM',
};
exports.PRICE_BASIS_LABELS = {
    CARPET: 'Carpet Area',
    BUILT_UP: 'Built-up Area',
    SUPER_BUILT_UP: 'Super Built-up Area',
    PLOT_AREA: 'Plot Area',
    LUMPSUM: 'Lump Sum (not area-based)',
};
function isAreaUnit(value) {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(exports.SQFT_PER_UNIT, value);
}
exports.isAreaUnit = isAreaUnit;
/** Rounds to `dp` decimal places, avoiding float dust like 1349.9999999998. */
function round(value, dp = 2) {
    const f = Math.pow(10, dp);
    return Math.round((value + Number.EPSILON) * f) / f;
}
exports.round = round;
/**
 * Conversions round at 8dp, not 2-4. One acre is 43,560 sq.ft and one hectare
 * 107,639 — rounding a hectare figure to 4dp discards ~1.7 sq.ft, so a
 * convert-and-convert-back loses real area. 8dp kills float dust while staying
 * lossless for any plot size anyone will ever enter. Round for storage and
 * display at the boundary (`normalizeArea`, `formatAreaDual`), not here.
 */
const CONVERSION_DP = 8;
function toSqft(value, unit) {
    if (!Number.isFinite(value))
        return 0;
    return round(value * exports.SQFT_PER_UNIT[unit], CONVERSION_DP);
}
exports.toSqft = toSqft;
function fromSqft(sqft, unit) {
    if (!Number.isFinite(sqft))
        return 0;
    return round(sqft / exports.SQFT_PER_UNIT[unit], CONVERSION_DP);
}
exports.fromSqft = fromSqft;
function convertArea(value, from, to) {
    if (from === to)
        return round(value, CONVERSION_DP);
    return fromSqft(toSqft(value, from), to);
}
exports.convertArea = convertArea;
/**
 * Normalises a user-entered area into everything we persist.
 * Every inventory row stores the unit as entered *plus* both canonical measures,
 * so we can filter/sort on sq.ft while still showing the plot in Sq.Yds.
 */
function normalizeArea(value, unit) {
    const sqft = toSqft(value, unit);
    return {
        area_value: round(value, 4),
        area_unit: unit,
        area_sqft: round(sqft, 2),
        area_sqyd: round(sqft / exports.SQFT_PER_UNIT.SQYD, 2),
    };
}
exports.normalizeArea = normalizeArea;
/** Plot dimensions in feet -> area. Used to auto-fill area from length x width. */
function areaFromDimensions(lengthFt, widthFt) {
    const sqft = round((lengthFt || 0) * (widthFt || 0), 2);
    return { area_sqft: sqft, area_sqyd: round(sqft / exports.SQFT_PER_UNIT.SQYD, 2) };
}
exports.areaFromDimensions = areaFromDimensions;
/**
 * True when a directly-entered area disagrees with length x width by more than
 * `tolerance`. Plots are frequently irregular so this warns rather than blocks.
 */
function dimensionsDisagree(enteredSqft, lengthFt, widthFt, tolerance = 0.02) {
    if (!enteredSqft || !lengthFt || !widthFt)
        return false;
    const derived = lengthFt * widthFt;
    if (derived <= 0)
        return false;
    return Math.abs(derived - enteredSqft) / enteredSqft > tolerance;
}
exports.dimensionsDisagree = dimensionsDisagree;
/**
 * Loading factor = (super built-up - carpet) / carpet, the share of common area
 * loaded onto the buyer. Indian buyers and sales teams both quote this; a project
 * with a 40%+ loading is a real commercial signal, so we surface it rather than
 * leaving three area numbers to be compared by eye.
 */
function loadingFactor(carpetSqft, superBuiltUpSqft) {
    if (!carpetSqft || !superBuiltUpSqft || carpetSqft <= 0)
        return null;
    return round((superBuiltUpSqft - carpetSqft) / carpetSqft, 4);
}
exports.loadingFactor = loadingFactor;
/** Carpet < built-up < super built-up is a physical fact, not a preference. */
function validateFlatAreas(areas) {
    const issues = [];
    const { carpet_area_sqft: carpet, built_up_area_sqft: builtUp, super_built_up_area_sqft: sbua, } = areas;
    if (carpet && builtUp && carpet >= builtUp) {
        issues.push({
            field: 'built_up_area_sqft',
            message: 'Built-up area must be greater than carpet area.',
            severity: 'error',
        });
    }
    if (builtUp && sbua && builtUp >= sbua) {
        issues.push({
            field: 'super_built_up_area_sqft',
            message: 'Super built-up area must be greater than built-up area.',
            severity: 'error',
        });
    }
    if (carpet && sbua && !builtUp && carpet >= sbua) {
        issues.push({
            field: 'super_built_up_area_sqft',
            message: 'Super built-up area must be greater than carpet area.',
            severity: 'error',
        });
    }
    const lf = loadingFactor(carpet, sbua);
    if (lf !== null && lf > 0.6) {
        issues.push({
            field: 'super_built_up_area_sqft',
            message: `Loading factor is ${(lf * 100).toFixed(0)}% — unusually high. Check the areas.`,
            severity: 'warning',
        });
    }
    return issues;
}
exports.validateFlatAreas = validateFlatAreas;
/**
 * Resolves the area a price rate should multiply, given the basis.
 * Returns null for LUMPSUM (the rate is the price; there is nothing to multiply)
 * and for a basis whose area has not been captured.
 */
function resolveBasisAreaSqft(basis, areas) {
    switch (basis) {
        case 'CARPET':
            return areas.carpet_area_sqft ?? null;
        case 'BUILT_UP':
            return areas.built_up_area_sqft ?? null;
        case 'SUPER_BUILT_UP':
            return areas.super_built_up_area_sqft ?? null;
        case 'PLOT_AREA':
            return areas.plot_area_sqyd != null
                ? toSqft(areas.plot_area_sqyd, 'SQYD')
                : (areas.area_sqft ?? null);
        case 'LUMPSUM':
            return null;
        default:
            return null;
    }
}
exports.resolveBasisAreaSqft = resolveBasisAreaSqft;
/** "150 Sq.Yds (1,350 Sq.Ft)" — always show both so nobody has to convert mentally. */
function formatAreaDual(areaSqft, preferredUnit = 'SQYD') {
    if (!areaSqft)
        return '—';
    const sqftStr = `${Math.round(areaSqft).toLocaleString('en-IN')} ${exports.AREA_UNIT_LABELS.SQFT}`;
    if (preferredUnit === 'SQFT')
        return sqftStr;
    const converted = fromSqft(areaSqft, preferredUnit);
    const convertedStr = `${round(converted, 2).toLocaleString('en-IN')} ${exports.AREA_UNIT_LABELS[preferredUnit]}`;
    return `${convertedStr} (${sqftStr})`;
}
exports.formatAreaDual = formatAreaDual;
