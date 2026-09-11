import {
  Prisma,
  ProjectUnit,
  Property,
  ProjectPricingRule,
  PropertyPricingRule,
  ProjectAmenity,
  Amenity,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { TokenPayload } from '../../utils/jwt';
import { buildProjectScope, buildPropertyScope } from '../../authz/dataScope';
import {
  computePrice,
  resolveFinalPrice,
  PriceComputation,
  PricingRule,
  PricingUnitInput,
  ManualPriceLine,
} from './engine';
import { PricePreviewInput } from '../../shared/projectUnit';
import { normalizeArea, AreaUnitType } from '../../shared/measurement';

const p = prisma;

/**
 * Bridges the pure `engine.ts` calculator to the database: fetches a unit or
 * property plus its applicable rules, runs the engine, and persists the result
 * as PriceLine rows plus the summary fields on the unit/property itself.
 *
 * Persisted, not recomputed on read (see schema.prisma's PriceLine doc comment):
 * a quotation shown to a customer must stay reproducible even after the
 * project's rules change later. Recalculating is always an explicit action.
 */

export function ruleToEngineRule(r: ProjectPricingRule): PricingRule {
  return {
    id: r.id,
    label: r.label,
    kind: r.kind,
    category: r.category,
    calc_method: r.calc_method,
    rate: r.rate,
    area_basis: r.area_basis,
    applies_to_unit_type: r.applies_to_unit_type,
    is_mandatory: r.is_mandatory,
    is_tax: r.is_tax,
    is_refundable: r.is_refundable,
    is_active: r.is_active,
    sort_order: r.sort_order,
    match_facing: r.match_facing,
    match_corner: r.match_corner,
    match_park_facing: r.match_park_facing,
    match_road_facing: r.match_road_facing,
    match_main_road_facing: r.match_main_road_facing,
    match_floor_min: r.match_floor_min,
    match_floor_max: r.match_floor_max,
    match_bhk: r.match_bhk,
    match_type_code: r.match_type_code,
    match_view: r.match_view,
  };
}

/**
 * Maps a CHARGEABLE ProjectAmenity into the engine's PricingRule shape so the
 * calculator treats it exactly like a ProjectPricingRule with category:
 * AMENITY (implementation plan section 6.2 — this is where "amenity" and
 * "price" finally connect).
 *
 * `id` is encoded as `-amenity_id`: guaranteed never to collide with a real
 * ProjectPricingRule id (always positive), so a PriceLine produced from an
 * amenity can still be told apart from a genuine rule, and a unit's
 * `selected_optional_rule_ids` can reference an amenity the same way it
 * references an optional rule. persistComputation strips this back to `null`
 * before writing PriceLine.rule_id, which is a real FK to ProjectPricingRule
 * and cannot hold a synthetic id.
 *
 * applicability -> match semantics:
 *  - ALL_UNITS: applies to every unit (is_mandatory: true, no unit-type gate).
 *  - BY_UNIT_TYPE: applies to every unit of `applicable_unit_type`.
 *  - SELECTED_UNITS: applies only where the unit opted in — modelled as
 *    is_mandatory: false, requiring `-amenity_id` in the unit's
 *    `selected_optional_rule_ids` (see engine.ts's ruleMatchesUnit).
 */
export function amenityToEngineRule(pa: ProjectAmenity & { amenity: Amenity }): PricingRule {
  return {
    id: -pa.amenity_id,
    label: pa.amenity.name,
    kind: 'CHARGE',
    category: 'AMENITY',
    calc_method: pa.charge_calc_method ?? 'FIXED',
    rate: pa.charge_amount ?? 0,
    area_basis: null,
    applies_to_unit_type: pa.applicability === 'BY_UNIT_TYPE' ? pa.applicable_unit_type : null,
    is_mandatory: pa.applicability !== 'SELECTED_UNITS',
    is_tax: false,
    is_refundable: false,
    is_active: true,
    sort_order: pa.sort_order,
  };
}

/**
 * The full set of rules a unit's price is computed against: the project's own
 * ProjectPricingRule rows plus every CHARGEABLE ProjectAmenity, combined into
 * one list the engine can't tell apart. Every pricing entry point (create,
 * update, preview, bulk-generate, project-wide recalculate) must go through
 * this rather than querying `projectPricingRule` directly, or amenity charges
 * would silently apply in some flows and not others.
 */
export async function getEffectiveRules(projectId: number): Promise<PricingRule[]> {
  const [rules, amenities] = await Promise.all([
    p.projectPricingRule.findMany({ where: { project_id: projectId, is_active: true } }),
    p.projectAmenity.findMany({
      where: { project_id: projectId, availability: 'CHARGEABLE' },
      include: { amenity: true },
    }),
  ]);
  return [...rules.map(ruleToEngineRule), ...amenities.map(amenityToEngineRule)];
}

/**
 * § Phase 3: mirrors ruleToEngineRule for PropertyPricingRule — a standalone
 * Property's own conditional charge rules (facing/corner/park/road-facing
 * match conditions against that one property's own stored attributes). No
 * applies_to_unit_type (a property already has one fixed category) and no
 * floor matching (Property has no top-level numeric floor field).
 */
export function ruleToEngineRuleProperty(r: PropertyPricingRule): PricingRule {
  return {
    id: r.id,
    label: r.label,
    kind: r.kind,
    category: r.category,
    calc_method: r.calc_method,
    rate: r.rate,
    area_basis: r.area_basis,
    applies_to_unit_type: null,
    is_mandatory: r.is_mandatory,
    is_tax: r.is_tax,
    is_refundable: r.is_refundable,
    is_active: r.is_active,
    sort_order: r.sort_order,
    match_facing: r.match_facing,
    match_corner: r.match_corner,
    match_park_facing: r.match_park_facing,
    match_road_facing: r.match_road_facing,
    match_main_road_facing: r.match_main_road_facing,
    match_floor_min: null,
    match_floor_max: null,
    match_bhk: null,
    match_type_code: null,
    match_view: null,
  };
}

/** The full set of rules a Property's price is computed against — its own
 * PropertyPricingRule rows. Every Property pricing entry point (create,
 * update, preview, recalculate) must go through this. */
export async function getEffectiveRulesForProperty(propertyId: number): Promise<PricingRule[]> {
  const rules = await p.propertyPricingRule.findMany({
    where: { property_id: propertyId, is_active: true },
  });
  return rules.map(ruleToEngineRuleProperty);
}

/** Shared field mapping for anything with the ProjectUnit/Property area+pricing shape. */
function baseEngineInput(row: {
  area_sqft?: number | null;
  carpet_area_sqft?: number | null;
  built_up_area_sqft?: number | null;
  super_built_up_area_sqft?: number | null;
  plot_area_sqyd?: number | null;
  price_basis: any;
  facing?: string | null;
  floor?: number | null;
  bhk?: string | null;
  type_code?: string | null;
  view?: string | null;
  is_corner: boolean;
  is_road_facing: boolean;
  is_park_facing: boolean;
  is_main_road_facing: boolean;
  parking_count?: number | null;
  base_rate?: number | null;
  base_rate_unit?: any;
  discount_amount?: number | null;
  discount_reason?: string | null;
}): Omit<PricingUnitInput, 'unit_type' | 'manual_lines' | 'selected_optional_rule_ids'> {
  return {
    price_basis: row.price_basis,
    area_sqft: row.area_sqft,
    carpet_area_sqft: row.carpet_area_sqft,
    built_up_area_sqft: row.built_up_area_sqft,
    super_built_up_area_sqft: row.super_built_up_area_sqft,
    plot_area_sqyd: row.plot_area_sqyd,
    facing: row.facing,
    floor: row.floor,
    bhk: row.bhk,
    type_code: row.type_code,
    view: row.view,
    is_corner: row.is_corner,
    is_road_facing: row.is_road_facing,
    is_park_facing: row.is_park_facing,
    is_main_road_facing: row.is_main_road_facing,
    parking_count: row.parking_count,
    base_rate: row.base_rate,
    base_rate_unit: row.base_rate_unit,
    discount_amount: row.discount_amount,
    discount_reason: row.discount_reason,
  };
}

/** Reads a unit's persisted optional-rule/amenity selection (see schema.prisma's doc comment on ProjectUnit.selected_optional_rule_ids). */
function selectedRuleIdsOf(unit: { selected_optional_rule_ids: Prisma.JsonValue }): number[] {
  return Array.isArray(unit.selected_optional_rule_ids)
    ? (unit.selected_optional_rule_ids as number[])
    : [];
}

async function manualLinesFor(kind: 'UNIT' | 'PROPERTY', id: number): Promise<ManualPriceLine[]> {
  const rows = await p.priceLine.findMany({
    where:
      kind === 'UNIT'
        ? { project_unit_id: id, is_manual: true }
        : { property_id: id, is_manual: true },
  });
  return rows.map((r) => ({
    label: r.label,
    category: r.category,
    kind: r.kind,
    amount: r.amount,
  }));
}

async function persistComputation(
  tx: Prisma.TransactionClient,
  kind: 'UNIT' | 'PROPERTY',
  id: number,
  computation: PriceComputation,
  overridePrice: number | null | undefined,
) {
  const idField = kind === 'UNIT' ? 'project_unit_id' : 'property_id';
  await tx.priceLine.deleteMany({ where: { [idField]: id } as any });
  if (computation.lines.length > 0) {
    await tx.priceLine.createMany({
      data: computation.lines.map((l) => ({
        [idField]: id,
        // rule_id is a real FK to ProjectPricingRule; a line sourced from a
        // CHARGEABLE amenity carries a synthetic negative id (see
        // amenityToEngineRule) that must never be written here.
        // § Phase 3: a PROPERTY line's rule_id points at PropertyPricingRule
        // instead — a separate FK column since Prisma has no polymorphic
        // relations (see PriceLine's schema comment).
        rule_id: kind === 'UNIT' && l.rule_id != null && l.rule_id > 0 ? l.rule_id : null,
        property_rule_id:
          kind === 'PROPERTY' && l.rule_id != null && l.rule_id > 0 ? l.rule_id : null,
        label: l.label,
        kind: l.kind,
        category: l.category,
        calc_method: l.calc_method,
        rate: l.rate,
        quantity: l.quantity,
        area_basis: l.area_basis,
        amount: l.amount,
        is_manual: l.is_manual,
        is_refundable: l.is_refundable,
        sort_order: l.sort_order,
      })) as any,
    });
  }

  const finalPrice = resolveFinalPrice(computation.calculated_price, overridePrice);
  const summary = {
    base_price: computation.base_price,
    premiums_total: computation.premiums_total,
    charges_total: computation.charges_total,
    taxes_total: computation.taxes_total,
    discount_amount: computation.discount_amount,
    calculated_price: computation.calculated_price,
    final_price: finalPrice,
    price_computed_at: new Date(),
  };

  if (kind === 'UNIT') {
    await tx.projectUnit.update({ where: { id }, data: summary });
  } else {
    await tx.property.update({ where: { id }, data: summary });
  }

  return { ...computation, final_price: finalPrice };
}

export class PricingService {
  /**
   * Computes and persists the price for one existing project unit, using the
   * project's currently-active pricing rules plus whatever manual lines were
   * previously added to this unit.
   *
   * Per-unit optional-rule selection (spec: an amenity a specific unit opts
   * into) is deferred to the Amenities tab (build order phase 3) — every
   * mandatory rule is applied automatically; no optional rule auto-applies yet.
   */
  static async recalculateUnit(
    unitId: number,
  ): Promise<ProjectUnit & { _computation: PriceComputation }> {
    const unit = await p.projectUnit.findUnique({ where: { id: unitId } });
    if (!unit) throw { status: 404, message: 'Unit not found' };

    const engineRules = await getEffectiveRules(unit.project_id);
    const manual_lines = await manualLinesFor('UNIT', unitId);

    const input: PricingUnitInput = {
      unit_type: unit.unit_type,
      ...baseEngineInput(unit),
      manual_lines,
      selected_optional_rule_ids: selectedRuleIdsOf(unit),
    };

    const computation = computePrice(input, engineRules);

    return p.$transaction(async (tx) => {
      await persistComputation(tx, 'UNIT', unitId, computation, unit.override_price);
      const updated = await tx.projectUnit.findUniqueOrThrow({ where: { id: unitId } });
      return { ...updated, _computation: computation };
    });
  }

  /** Same as recalculateUnit, for a standalone Property — now (§ Phase 3)
   * priced against its own PropertyPricingRule rows plus manual lines, the
   * same two-layer pattern Project/ProjectUnit already uses. */
  static async recalculateProperty(
    propertyId: number,
  ): Promise<Property & { _computation: PriceComputation }> {
    const property = await p.property.findUnique({ where: { id: propertyId } });
    if (!property) throw { status: 404, message: 'Property not found' };

    const engineRules = await getEffectiveRulesForProperty(propertyId);
    const manual_lines = await manualLinesFor('PROPERTY', propertyId);

    const input: PricingUnitInput = {
      unit_type: 'OTHER',
      ...baseEngineInput(property),
      manual_lines,
      selected_optional_rule_ids: [],
    };

    const computation = computePrice(input, engineRules);

    return p.$transaction(async (tx) => {
      await persistComputation(tx, 'PROPERTY', propertyId, computation, property.override_price);
      const updated = await tx.property.findUniqueOrThrow({ where: { id: propertyId } });
      return { ...updated, _computation: computation };
    });
  }

  /**
   * Preview endpoint: computes a price WITHOUT the unit needing to exist yet
   * and without persisting anything. This is what backs the "Add Unit" wizard's
   * live cost-sheet preview — the server is the sole source of truth for the
   * number shown, even before a row is created.
   */
  static async previewForProject(
    user: TokenPayload,
    projectId: number,
    input: PricePreviewInput,
  ): Promise<PriceComputation> {
    const scope = await buildProjectScope(user);
    const project = await p.project.findFirst({ where: { id: projectId, ...scope } });
    if (!project) throw { status: 404, message: 'Project not found' };

    const engineRules = await getEffectiveRules(projectId);

    // Normalise whatever the wizard typed (area_value + area_unit) the same way
    // createUnit does, so previewing a plot priced by Sq.Yd works even when the
    // caller only filled in the generic area field, not plot_area_sqyd directly.
    let areaSqft: number | null = null;
    let plotAreaSqyd: number | null = input.plot_area_sqyd ?? null;
    if (input.area_value != null && input.area_unit) {
      const normalized = normalizeArea(input.area_value, input.area_unit as AreaUnitType);
      areaSqft = normalized.area_sqft;
      if (plotAreaSqyd == null) plotAreaSqyd = normalized.area_sqyd;
    }

    const engineInput: PricingUnitInput = {
      unit_type: input.unit_type,
      price_basis: input.price_basis ?? project.default_price_basis ?? 'SUPER_BUILT_UP',
      area_sqft: areaSqft,
      carpet_area_sqft: input.carpet_area_sqft ?? null,
      built_up_area_sqft: input.built_up_area_sqft ?? null,
      super_built_up_area_sqft: input.super_built_up_area_sqft ?? null,
      plot_area_sqyd: plotAreaSqyd,
      facing: input.facing ?? null,
      floor: input.floor ?? null,
      bhk: input.bhk ?? null,
      type_code: input.type_code ?? null,
      view: input.view ?? null,
      is_corner: !!input.is_corner,
      is_road_facing: !!input.is_road_facing,
      is_park_facing: !!input.is_park_facing,
      is_main_road_facing: !!input.is_main_road_facing,
      parking_count: input.parking_count ?? null,
      base_rate: input.base_rate ?? null,
      base_rate_unit: input.base_rate_unit ?? null,
      discount_amount: input.discount_amount ?? null,
      discount_reason: input.discount_reason ?? null,
      manual_lines: input.manual_lines,
      selected_optional_rule_ids: input.selected_optional_rule_ids ?? [],
    };

    return computePrice(engineInput, engineRules);
  }

  /**
   * § Phase 3: same idea as previewForProject, for a standalone Property —
   * computes against the property's already-persisted PropertyPricingRule
   * rows plus whatever manual lines/overrides the caller is currently
   * editing, without persisting anything. Requires the property to already
   * exist (rules are scoped per-property, so there's nothing to preview
   * against before the first save — the create wizard's own lighter
   * client-side estimate covers that gap, same as it always has).
   */
  static async previewForProperty(
    user: TokenPayload,
    propertyId: number,
    input: PricePreviewInput,
  ): Promise<PriceComputation> {
    const scope = await buildPropertyScope(user);
    const property = await p.property.findFirst({ where: { id: propertyId, ...scope } });
    if (!property) throw { status: 404, message: 'Property not found' };

    const engineRules = await getEffectiveRulesForProperty(propertyId);

    let areaSqft: number | null =
      input.area_value != null && input.area_unit == null ? input.area_value : null;
    let plotAreaSqyd: number | null = input.plot_area_sqyd ?? null;
    if (input.area_value != null && input.area_unit) {
      const normalized = normalizeArea(input.area_value, input.area_unit as AreaUnitType);
      areaSqft = normalized.area_sqft;
      if (plotAreaSqyd == null) plotAreaSqyd = normalized.area_sqyd;
    }

    const engineInput: PricingUnitInput = {
      unit_type: 'OTHER',
      price_basis: input.price_basis ?? 'SUPER_BUILT_UP',
      area_sqft: areaSqft ?? property.area_sqft,
      carpet_area_sqft: input.carpet_area_sqft ?? property.carpet_area_sqft,
      built_up_area_sqft: input.built_up_area_sqft ?? property.built_up_area_sqft,
      super_built_up_area_sqft: input.super_built_up_area_sqft ?? property.super_built_up_area_sqft,
      plot_area_sqyd: plotAreaSqyd ?? property.plot_area_sqyd,
      facing: input.facing ?? property.facing,
      floor: null,
      bhk: null,
      type_code: null,
      view: input.view ?? property.view,
      is_corner: input.is_corner ?? property.is_corner,
      is_road_facing: input.is_road_facing ?? property.is_road_facing,
      is_park_facing: input.is_park_facing ?? property.is_park_facing,
      is_main_road_facing: input.is_main_road_facing ?? property.is_main_road_facing,
      parking_count: null,
      base_rate: input.base_rate ?? property.base_rate,
      base_rate_unit: input.base_rate_unit ?? property.base_rate_unit,
      discount_amount: input.discount_amount ?? property.discount_amount,
      discount_reason: input.discount_reason ?? property.discount_reason,
      manual_lines: input.manual_lines ?? (await manualLinesFor('PROPERTY', propertyId)),
      selected_optional_rule_ids: input.selected_optional_rule_ids ?? [],
    };

    return computePrice(engineInput, engineRules);
  }

  /**
   * Preview-only recalculation across every unit in a project: shows what would
   * change if the current rules were reapplied, without writing anything.
   * The Pricing tab's "Recalculate all units" flow calls this first, then
   * `applyRecalculateProject` only after the admin confirms the diff.
   */
  static async previewRecalculateProject(user: TokenPayload, projectId: number) {
    const scope = await buildProjectScope(user);
    const project = await p.project.findFirst({ where: { id: projectId, ...scope } });
    if (!project) throw { status: 404, message: 'Project not found' };

    const [units, engineRules] = await Promise.all([
      p.projectUnit.findMany({ where: { project_id: projectId } }),
      getEffectiveRules(projectId),
    ]);

    const diffs = await Promise.all(
      units.map(async (unit) => {
        const manual_lines = await manualLinesFor('UNIT', unit.id);
        const input: PricingUnitInput = {
          unit_type: unit.unit_type,
          ...baseEngineInput(unit),
          manual_lines,
          selected_optional_rule_ids: selectedRuleIdsOf(unit),
        };
        const computation = computePrice(input, engineRules);
        const newFinal = resolveFinalPrice(computation.calculated_price, unit.override_price);
        return {
          unit_id: unit.id,
          unit_number: unit.unit_number,
          old_calculated_price: unit.calculated_price,
          new_calculated_price: computation.calculated_price,
          old_final_price: unit.final_price,
          new_final_price: newFinal,
          delta: round2(newFinal - unit.final_price),
        };
      }),
    );

    const changed = diffs.filter((d) => d.delta !== 0);
    return {
      total_units: units.length,
      changed_count: changed.length,
      changes: changed,
    };
  }

  /** Applies the recalculation to every unit in a project — the confirmed action. */
  static async applyRecalculateProject(user: TokenPayload, projectId: number) {
    const scope = await buildProjectScope(user);
    const project = await p.project.findFirst({ where: { id: projectId, ...scope } });
    if (!project) throw { status: 404, message: 'Project not found' };

    const units = await p.projectUnit.findMany({
      where: { project_id: projectId },
      select: { id: true },
    });
    let updated = 0;
    for (const u of units) {
      await PricingService.recalculateUnit(u.id);
      updated++;
    }
    return { updated_count: updated };
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
