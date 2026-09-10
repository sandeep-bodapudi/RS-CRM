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

export const AreaUnit = {
  SQFT: 'SQFT',
  SQYD: 'SQYD',
  SQM: 'SQM',
  ACRE: 'ACRE',
  GUNTA: 'GUNTA',
  CENT: 'CENT',
  ANKANAM: 'ANKANAM',
  HECTARE: 'HECTARE',
} as const;

export type AreaUnitType = (typeof AreaUnit)[keyof typeof AreaUnit];

/** Square feet per one unit. The single source of truth for every conversion. */
export const SQFT_PER_UNIT: Record<AreaUnitType, number> = {
  SQFT: 1,
  SQYD: 9,
  SQM: 10.763910416709722,
  ACRE: 43560,
  GUNTA: 1089, // 1 acre = 40 guntas
  CENT: 435.6, // 1 acre = 100 cents
  ANKANAM: 72, // 1 ankanam = 8 sq.yd (Andhra/Telangana)
  HECTARE: 107639.10416709722,
};

export const AREA_UNIT_LABELS: Record<AreaUnitType, string> = {
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
export const PriceBasis = {
  CARPET: 'CARPET',
  BUILT_UP: 'BUILT_UP',
  SUPER_BUILT_UP: 'SUPER_BUILT_UP',
  PLOT_AREA: 'PLOT_AREA',
  LUMPSUM: 'LUMPSUM',
} as const;

export type PriceBasisType = (typeof PriceBasis)[keyof typeof PriceBasis];

export const PRICE_BASIS_LABELS: Record<PriceBasisType, string> = {
  CARPET: 'Carpet Area',
  BUILT_UP: 'Built-up Area',
  SUPER_BUILT_UP: 'Super Built-up Area',
  PLOT_AREA: 'Plot Area',
  LUMPSUM: 'Lump Sum (not area-based)',
};

export function isAreaUnit(value: unknown): value is AreaUnitType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SQFT_PER_UNIT, value);
}

/** Rounds to `dp` decimal places, avoiding float dust like 1349.9999999998. */
export function round(value: number, dp = 2): number {
  const f = Math.pow(10, dp);
  return Math.round((value + Number.EPSILON) * f) / f;
}

/**
 * Conversions round at 8dp, not 2-4. One acre is 43,560 sq.ft and one hectare
 * 107,639 — rounding a hectare figure to 4dp discards ~1.7 sq.ft, so a
 * convert-and-convert-back loses real area. 8dp kills float dust while staying
 * lossless for any plot size anyone will ever enter. Round for storage and
 * display at the boundary (`normalizeArea`, `formatAreaDual`), not here.
 */
const CONVERSION_DP = 8;

export function toSqft(value: number, unit: AreaUnitType): number {
  if (!Number.isFinite(value)) return 0;
  return round(value * SQFT_PER_UNIT[unit], CONVERSION_DP);
}

export function fromSqft(sqft: number, unit: AreaUnitType): number {
  if (!Number.isFinite(sqft)) return 0;
  return round(sqft / SQFT_PER_UNIT[unit], CONVERSION_DP);
}

export function convertArea(value: number, from: AreaUnitType, to: AreaUnitType): number {
  if (from === to) return round(value, CONVERSION_DP);
  return fromSqft(toSqft(value, from), to);
}

/**
 * Normalises a user-entered area into everything we persist.
 * Every inventory row stores the unit as entered *plus* both canonical measures,
 * so we can filter/sort on sq.ft while still showing the plot in Sq.Yds.
 */
export function normalizeArea(
  value: number,
  unit: AreaUnitType,
): { area_value: number; area_unit: AreaUnitType; area_sqft: number; area_sqyd: number } {
  const sqft = toSqft(value, unit);
  return {
    area_value: round(value, 4),
    area_unit: unit,
    area_sqft: round(sqft, 2),
    area_sqyd: round(sqft / SQFT_PER_UNIT.SQYD, 2),
  };
}

/** Plot dimensions in feet -> area. Used to auto-fill area from length x width. */
export function areaFromDimensions(lengthFt: number, widthFt: number) {
  const sqft = round((lengthFt || 0) * (widthFt || 0), 2);
  return { area_sqft: sqft, area_sqyd: round(sqft / SQFT_PER_UNIT.SQYD, 2) };
}

/**
 * True when a directly-entered area disagrees with length x width by more than
 * `tolerance`. Plots are frequently irregular so this warns rather than blocks.
 */
export function dimensionsDisagree(
  enteredSqft: number,
  lengthFt: number,
  widthFt: number,
  tolerance = 0.02,
): boolean {
  if (!enteredSqft || !lengthFt || !widthFt) return false;
  const derived = lengthFt * widthFt;
  if (derived <= 0) return false;
  return Math.abs(derived - enteredSqft) / enteredSqft > tolerance;
}

/**
 * Loading factor = (super built-up - carpet) / carpet, the share of common area
 * loaded onto the buyer. Indian buyers and sales teams both quote this; a project
 * with a 40%+ loading is a real commercial signal, so we surface it rather than
 * leaving three area numbers to be compared by eye.
 */
export function loadingFactor(carpetSqft?: number | null, superBuiltUpSqft?: number | null): number | null {
  if (!carpetSqft || !superBuiltUpSqft || carpetSqft <= 0) return null;
  return round((superBuiltUpSqft - carpetSqft) / carpetSqft, 4);
}

export interface AreaValidationIssue {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

/** Carpet < built-up < super built-up is a physical fact, not a preference. */
export function validateFlatAreas(areas: {
  carpet_area_sqft?: number | null;
  built_up_area_sqft?: number | null;
  super_built_up_area_sqft?: number | null;
}): AreaValidationIssue[] {
  const issues: AreaValidationIssue[] = [];
  const { carpet_area_sqft: carpet, built_up_area_sqft: builtUp, super_built_up_area_sqft: sbua } = areas;

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

/**
 * Resolves the area a price rate should multiply, given the basis.
 * Returns null for LUMPSUM (the rate is the price; there is nothing to multiply)
 * and for a basis whose area has not been captured.
 */
export function resolveBasisAreaSqft(
  basis: PriceBasisType,
  areas: {
    carpet_area_sqft?: number | null;
    built_up_area_sqft?: number | null;
    super_built_up_area_sqft?: number | null;
    plot_area_sqyd?: number | null;
    area_sqft?: number | null;
  },
): number | null {
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

/** "150 Sq.Yds (1,350 Sq.Ft)" — always show both so nobody has to convert mentally. */
export function formatAreaDual(areaSqft?: number | null, preferredUnit: AreaUnitType = 'SQYD'): string {
  if (!areaSqft) return '—';
  const sqftStr = `${Math.round(areaSqft).toLocaleString('en-IN')} ${AREA_UNIT_LABELS.SQFT}`;
  if (preferredUnit === 'SQFT') return sqftStr;
  const converted = fromSqft(areaSqft, preferredUnit);
  const convertedStr = `${round(converted, 2).toLocaleString('en-IN')} ${AREA_UNIT_LABELS[preferredUnit]}`;
  return `${convertedStr} (${sqftStr})`;
}
