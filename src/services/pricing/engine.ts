/**
 * The pricing engine. Single authority for what any unit or property costs.
 *
 * Why this exists: previously the browser computed prices (BulkUnitWizard /
 * AddPropertyWizard both did the arithmetic client-side) and the API persisted
 * whatever number arrived — `bulkCreateUnitsForProject` performed no
 * recalculation at all. Two different screens, two different formulas, and no
 * server-side truth. Everything here runs on the server; the UI renders what
 * this returns and never computes an authoritative figure.
 *
 * The output models a real builder cost sheet:
 *
 *   Base Price (BSP)   = base_rate x area(price_basis)
 * + Premiums (PLC)     facing / floor / corner / road / park / view / BHK
 * + Charges            EDC-IDC infra, club, parking, IFMS, legal, documentation
 * - Discount
 * = Calculated Price   <- the spec's "FINAL PRICE"
 * + Taxes              GST, registration - tracked separately, never folded in
 * = All-inclusive Price
 *
 * Taxes are deliberately outside `calculated_price`: Indian cost sheets quote
 * total consideration and statutory charges separately, and the spec's own
 * worked examples treat the builder total as final.
 */

import {
  AreaUnitType,
  PriceBasisType,
  SQFT_PER_UNIT,
  resolveBasisAreaSqft,
  round,
  toSqft,
} from '../../shared/measurement';

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const RuleKind = {
  BASE_RATE: 'BASE_RATE',
  PREMIUM: 'PREMIUM',
  CHARGE: 'CHARGE',
  DISCOUNT: 'DISCOUNT',
  TAX: 'TAX',
} as const;
export type RuleKindType = (typeof RuleKind)[keyof typeof RuleKind];

export const ChargeCategory = {
  FACING: 'FACING',
  FLOOR: 'FLOOR',
  CORNER: 'CORNER',
  ROAD: 'ROAD',
  PARK: 'PARK',
  VIEW: 'VIEW',
  BHK: 'BHK',
  AMENITY: 'AMENITY',
  PARKING: 'PARKING',
  INFRA: 'INFRA',
  MAINTENANCE: 'MAINTENANCE',
  LEGAL: 'LEGAL',
  CLUB: 'CLUB',
  TAX: 'TAX',
  OTHER: 'OTHER',
} as const;
export type ChargeCategoryType = (typeof ChargeCategory)[keyof typeof ChargeCategory];

export const CalcMethod = {
  FIXED: 'FIXED',
  PER_SQFT: 'PER_SQFT',
  PER_SQYD: 'PER_SQYD',
  PERCENT_OF_BASE: 'PERCENT_OF_BASE',
  QTY_X_RATE: 'QTY_X_RATE',
} as const;
export type CalcMethodType = (typeof CalcMethod)[keyof typeof CalcMethod];

export const UnitType = {
  PLOT: 'PLOT',
  FLAT: 'FLAT',
  VILLA: 'VILLA',
  HOUSE: 'HOUSE',
  COMMERCIAL: 'COMMERCIAL',
  OTHER: 'OTHER',
} as const;
export type UnitTypeType = (typeof UnitType)[keyof typeof UnitType];

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** The attributes a rule can match against. Mirrors the ProjectUnit columns. */
export interface PricingUnitInput {
  unit_type: UnitTypeType;
  price_basis: PriceBasisType;

  // areas
  area_sqft?: number | null;
  carpet_area_sqft?: number | null;
  built_up_area_sqft?: number | null;
  super_built_up_area_sqft?: number | null;
  plot_area_sqyd?: number | null;

  // characteristics a premium can key off
  facing?: string | null;
  floor?: number | null;
  bhk?: string | null;
  type_code?: string | null;
  view?: string | null;
  is_corner?: boolean | null;
  is_road_facing?: boolean | null;
  is_park_facing?: boolean | null;
  is_main_road_facing?: boolean | null;

  parking_count?: number | null;

  /** Explicit base rate override for this unit; otherwise the BASE_RATE rule applies. */
  base_rate?: number | null;
  base_rate_unit?: CalcMethodType | null;
  /** Flat lump-sum base price, bypassing rate x area entirely. */
  base_price_override?: number | null;

  discount_amount?: number | null;
  discount_reason?: string | null;

  /** Optional ad-hoc lines an admin added by hand on this unit. */
  manual_lines?: ManualPriceLine[];
  /** Ids of optional (non-mandatory) rules the admin ticked for this unit. */
  selected_optional_rule_ids?: number[];
}

export interface ManualPriceLine {
  label: string;
  category?: ChargeCategoryType;
  kind?: RuleKindType;
  amount: number;
}

/** Mirrors ProjectPricingRule. Null match_* fields mean "don't care". */
export interface PricingRule {
  id: number;
  label: string;
  kind: RuleKindType;
  category: ChargeCategoryType;
  calc_method: CalcMethodType;
  rate: number;
  area_basis?: PriceBasisType | null;
  applies_to_unit_type?: UnitTypeType | null;

  is_mandatory?: boolean;
  is_tax?: boolean;
  is_refundable?: boolean;
  is_active?: boolean;
  sort_order?: number;

  match_facing?: string | null;
  match_corner?: boolean | null;
  match_park_facing?: boolean | null;
  match_road_facing?: boolean | null;
  match_main_road_facing?: boolean | null;
  match_floor_min?: number | null;
  match_floor_max?: number | null;
  match_bhk?: string | null;
  match_type_code?: string | null;
  match_view?: string | null;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export interface ComputedPriceLine {
  rule_id: number | null;
  label: string;
  kind: RuleKindType;
  category: ChargeCategoryType;
  calc_method: CalcMethodType;
  /** The rate applied (per sqft/sqyd, a percentage, or the fixed amount). */
  rate: number;
  /** What the rate was multiplied by. 1 for FIXED. */
  quantity: number;
  area_basis: PriceBasisType | null;
  amount: number;
  is_manual: boolean;
  is_refundable: boolean;
  sort_order: number;
}

export interface PriceComputation {
  lines: ComputedPriceLine[];
  base_price: number;
  premiums_total: number;
  charges_total: number;
  discount_amount: number;
  /** base + premiums + charges - discount. The spec's "FINAL PRICE". */
  calculated_price: number;
  taxes_total: number;
  /** calculated_price + taxes. What the buyer actually pays. */
  all_inclusive_price: number;
  /** Refundable deposits (IFMS) included above, surfaced for transparency. */
  refundable_total: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Rule matching
// ---------------------------------------------------------------------------

function matchesBool(
  ruleValue: boolean | null | undefined,
  unitValue: boolean | null | undefined,
): boolean {
  if (ruleValue === null || ruleValue === undefined) return true;
  return Boolean(unitValue) === ruleValue;
}

function matchesString(
  ruleValue: string | null | undefined,
  unitValue: string | null | undefined,
): boolean {
  if (ruleValue === null || ruleValue === undefined || ruleValue === '') return true;
  if (unitValue === null || unitValue === undefined) return false;
  return String(unitValue).toUpperCase() === String(ruleValue).toUpperCase();
}

/** Decides whether a rule applies to a unit. Every null condition is a wildcard. */
export function ruleMatchesUnit(rule: PricingRule, unit: PricingUnitInput): boolean {
  if (rule.is_active === false) return false;

  if (rule.applies_to_unit_type && rule.applies_to_unit_type !== unit.unit_type) return false;

  if (!matchesString(rule.match_facing, unit.facing)) return false;
  if (!matchesString(rule.match_bhk, unit.bhk)) return false;
  if (!matchesString(rule.match_type_code, unit.type_code)) return false;
  if (!matchesString(rule.match_view, unit.view)) return false;

  if (!matchesBool(rule.match_corner, unit.is_corner)) return false;
  if (!matchesBool(rule.match_park_facing, unit.is_park_facing)) return false;
  if (!matchesBool(rule.match_road_facing, unit.is_road_facing)) return false;
  if (!matchesBool(rule.match_main_road_facing, unit.is_main_road_facing)) return false;

  if (rule.match_floor_min !== null && rule.match_floor_min !== undefined) {
    if (unit.floor === null || unit.floor === undefined || unit.floor < rule.match_floor_min)
      return false;
  }
  if (rule.match_floor_max !== null && rule.match_floor_max !== undefined) {
    if (unit.floor === null || unit.floor === undefined || unit.floor > rule.match_floor_max)
      return false;
  }

  // An optional rule only applies when explicitly selected for this unit.
  if (rule.is_mandatory === false) {
    return (unit.selected_optional_rule_ids || []).includes(rule.id);
  }

  return true;
}

// ---------------------------------------------------------------------------
// Amount calculation
// ---------------------------------------------------------------------------

/** The area a rate multiplies, in the rate's own unit. */
function quantityForMethod(
  method: CalcMethodType,
  unit: PricingUnitInput,
  areaBasis: PriceBasisType,
  basePrice: number,
  warnings: string[],
  label: string,
): number {
  switch (method) {
    case 'FIXED':
      return 1;
    case 'PERCENT_OF_BASE':
      return basePrice;
    case 'QTY_X_RATE':
      return unit.parking_count ?? 1;
    case 'PER_SQFT':
    case 'PER_SQYD': {
      const sqft = resolveBasisAreaSqft(areaBasis, unit);
      if (sqft === null || sqft <= 0) {
        warnings.push(`"${label}" needs ${areaBasis} area but the unit has none — charged 0.`);
        return 0;
      }
      return method === 'PER_SQFT' ? sqft : sqft / SQFT_PER_UNIT.SQYD;
    }
    default:
      return 0;
  }
}

function amountFor(method: CalcMethodType, rate: number, quantity: number): number {
  if (method === 'PERCENT_OF_BASE') return round((quantity * rate) / 100, 2);
  return round(quantity * rate, 2);
}

// ---------------------------------------------------------------------------
// Base price
// ---------------------------------------------------------------------------

function computeBasePrice(
  unit: PricingUnitInput,
  rules: PricingRule[],
  warnings: string[],
): { amount: number; line: ComputedPriceLine | null } {
  // 1. An explicit lump sum wins outright.
  if (unit.base_price_override != null && unit.base_price_override > 0) {
    return {
      amount: round(unit.base_price_override, 2),
      line: {
        rule_id: null,
        label: 'Base Price',
        kind: 'BASE_RATE',
        category: 'OTHER',
        calc_method: 'FIXED',
        rate: round(unit.base_price_override, 2),
        quantity: 1,
        area_basis: null,
        amount: round(unit.base_price_override, 2),
        is_manual: true,
        is_refundable: false,
        sort_order: 0,
      },
    };
  }

  // 2. A per-unit base rate, else the project's BASE_RATE rule.
  const baseRule = rules.find((r) => r.kind === 'BASE_RATE' && ruleMatchesUnit(r, unit));
  const rate = unit.base_rate ?? baseRule?.rate ?? 0;
  const method: CalcMethodType =
    unit.base_rate_unit ??
    baseRule?.calc_method ??
    (unit.price_basis === 'PLOT_AREA' ? 'PER_SQYD' : 'PER_SQFT');
  const areaBasis: PriceBasisType = baseRule?.area_basis ?? unit.price_basis;

  if (!rate) {
    warnings.push('No base rate configured for this unit — base price is 0.');
    return { amount: 0, line: null };
  }

  if (method === 'FIXED' || areaBasis === 'LUMPSUM') {
    return {
      amount: round(rate, 2),
      line: {
        rule_id: baseRule?.id ?? null,
        label: baseRule?.label ?? 'Base Price',
        kind: 'BASE_RATE',
        category: 'OTHER',
        calc_method: 'FIXED',
        rate: round(rate, 2),
        quantity: 1,
        area_basis: null,
        amount: round(rate, 2),
        is_manual: false,
        is_refundable: false,
        sort_order: 0,
      },
    };
  }

  const quantity = quantityForMethod(method, unit, areaBasis, 0, warnings, 'Base Price');
  const amount = amountFor(method, rate, quantity);

  return {
    amount,
    line: {
      rule_id: baseRule?.id ?? null,
      label: baseRule?.label ?? 'Base Price',
      kind: 'BASE_RATE',
      category: 'OTHER',
      calc_method: method,
      rate: round(rate, 2),
      quantity: round(quantity, 4),
      area_basis: areaBasis,
      amount,
      is_manual: false,
      is_refundable: false,
      sort_order: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function computePrice(unit: PricingUnitInput, rules: PricingRule[] = []): PriceComputation {
  const warnings: string[] = [];
  const lines: ComputedPriceLine[] = [];

  const active = rules.filter((r) => r.is_active !== false);

  // 1. Base
  const base = computeBasePrice(unit, active, warnings);
  if (base.line) lines.push(base.line);
  const basePrice = base.amount;

  // 2. Premiums, charges and taxes, all keyed off the settled base price.
  const applicable = active
    .filter((r) => r.kind !== 'BASE_RATE' && r.kind !== 'DISCOUNT')
    .filter((r) => ruleMatchesUnit(r, unit))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  for (const rule of applicable) {
    const areaBasis: PriceBasisType = rule.area_basis ?? unit.price_basis;
    const quantity = quantityForMethod(
      rule.calc_method,
      unit,
      areaBasis,
      basePrice,
      warnings,
      rule.label,
    );
    const amount = amountFor(rule.calc_method, rule.rate, quantity);
    if (amount === 0 && rule.calc_method !== 'FIXED') {
      // A zero-value premium is noise on a cost sheet; skip it silently.
      continue;
    }
    lines.push({
      rule_id: rule.id,
      label: rule.label,
      kind: rule.kind,
      category: rule.category,
      calc_method: rule.calc_method,
      rate: round(rule.rate, 4),
      quantity: round(quantity, 4),
      area_basis:
        rule.calc_method === 'PER_SQFT' || rule.calc_method === 'PER_SQYD' ? areaBasis : null,
      amount,
      is_manual: false,
      is_refundable: Boolean(rule.is_refundable),
      sort_order: rule.sort_order ?? 0,
    });
  }

  // 3. Hand-added lines.
  for (const [i, manual] of (unit.manual_lines || []).entries()) {
    lines.push({
      rule_id: null,
      label: manual.label,
      kind: manual.kind ?? 'CHARGE',
      category: manual.category ?? 'OTHER',
      calc_method: 'FIXED',
      rate: round(manual.amount, 2),
      quantity: 1,
      area_basis: null,
      amount: round(manual.amount, 2),
      is_manual: true,
      is_refundable: false,
      sort_order: 900 + i,
    });
  }

  const sumOf = (predicate: (l: ComputedPriceLine) => boolean) =>
    round(
      lines.filter(predicate).reduce((acc, l) => acc + l.amount, 0),
      2,
    );

  const premiums_total = sumOf((l) => l.kind === 'PREMIUM');
  const charges_total = sumOf((l) => l.kind === 'CHARGE');
  const taxes_total = sumOf((l) => l.kind === 'TAX');
  const refundable_total = sumOf((l) => l.is_refundable);

  const discount_amount = round(unit.discount_amount ?? 0, 2);
  const calculated_price = round(basePrice + premiums_total + charges_total - discount_amount, 2);
  const all_inclusive_price = round(calculated_price + taxes_total, 2);

  if (discount_amount > basePrice + premiums_total + charges_total) {
    warnings.push('Discount exceeds the total price — the calculated price is negative.');
  }

  return {
    lines,
    base_price: round(basePrice, 2),
    premiums_total,
    charges_total,
    discount_amount,
    calculated_price,
    taxes_total,
    all_inclusive_price,
    refundable_total,
    warnings,
  };
}

/** final_price is the override when one is set, else the computed figure. */
export function resolveFinalPrice(calculatedPrice: number, overridePrice?: number | null): number {
  return overridePrice != null && overridePrice > 0
    ? round(overridePrice, 2)
    : round(calculatedPrice, 2);
}
