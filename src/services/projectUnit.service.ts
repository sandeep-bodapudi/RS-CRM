import { Prisma, ProjectUnit } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { TokenPayload } from '../utils/jwt';
import { buildProjectScope } from '../authz/dataScope';
import { can } from '../authz/authorization';
import { Permissions } from '../shared';
import {
  ProjectUnitCreateInput,
  ProjectUnitUpdateInput,
  ProjectUnitBulkCreateInput,
} from '../shared/projectUnit';
import {
  normalizeArea,
  areaFromDimensions,
  dimensionsDisagree,
  validateFlatAreas,
  AreaUnitType,
} from '../shared/measurement';
import { PricingService, getEffectiveRules } from './pricing/pricing.service';
import { computePrice, resolveFinalPrice, PricingUnitInput } from './pricing/engine';

const p = prisma;

/**
 * ProjectUnit CRUD. A unit never collects its own address — it always inherits
 * the parent project's — so, unlike PropertyService.createProperty, there is no
 * location handling here at all (spec: "don't duplicate common data").
 *
 * Units are internally-authored inventory (confirmed scope decision): no
 * PM -> DM -> MD approval gate. Every create/update recomputes price via
 * PricingService so the persisted PriceLine rows are never stale relative to
 * the fields that produced them.
 */
export class ProjectUnitService {
  private static async assertProjectInScope(user: TokenPayload, projectId: number) {
    const scope = await buildProjectScope(user);
    const project = await p.project.findFirst({ where: { id: projectId, ...scope } });
    if (!project) throw { status: 404, message: 'Project not found' };
    return project;
  }

  private static async generateUnitCode(
    projectCode: string,
    client: { projectUnit: { count: (args?: any) => Promise<number> } } = p,
  ): Promise<string> {
    const count = await client.projectUnit.count();
    const seq = (count + 1).toString().padStart(5, '0');
    return `${projectCode}-U${seq}`;
  }

  /** Normalises area fields shared by create/update/bulk into DB-ready columns. */
  private static resolveAreaFields(data: Partial<ProjectUnitCreateInput>) {
    const out: Record<string, any> = {};

    if (data.area_value != null && data.area_unit) {
      const normalized = normalizeArea(data.area_value, data.area_unit as AreaUnitType);
      out.area_value = normalized.area_value;
      out.area_unit = normalized.area_unit;
      out.area_sqft = normalized.area_sqft;
      out.area_sqyd = normalized.area_sqyd;
    }

    // Plots: derive area from L x W when both are present and no direct plot
    // area was given; warn (via the returned array) rather than block when they
    // disagree, since real plots are frequently irregular.
    const warnings: string[] = [];
    if (data.plot_length_ft && data.plot_width_ft) {
      const derived = areaFromDimensions(data.plot_length_ft, data.plot_width_ft);
      if (data.plot_area_sqyd == null) {
        out.plot_area_sqyd = derived.area_sqyd;
      } else if (dimensionsDisagree(derived.area_sqft, data.plot_length_ft, data.plot_width_ft)) {
        warnings.push(
          `Entered plot area disagrees with length x width by more than 2% (L x W = ${derived.area_sqft} sqft).`,
        );
      }
    }
    if (data.plot_area_sqyd != null) out.plot_area_sqyd = data.plot_area_sqyd;
    if (data.plot_length_ft != null) out.plot_length_ft = data.plot_length_ft;
    if (data.plot_width_ft != null) out.plot_width_ft = data.plot_width_ft;

    if (data.carpet_area_sqft != null) out.carpet_area_sqft = data.carpet_area_sqft;
    if (data.built_up_area_sqft != null) out.built_up_area_sqft = data.built_up_area_sqft;
    if (data.super_built_up_area_sqft != null)
      out.super_built_up_area_sqft = data.super_built_up_area_sqft;

    const areaIssues = validateFlatAreas({
      carpet_area_sqft: out.carpet_area_sqft ?? data.carpet_area_sqft,
      built_up_area_sqft: out.built_up_area_sqft ?? data.built_up_area_sqft,
      super_built_up_area_sqft: out.super_built_up_area_sqft ?? data.super_built_up_area_sqft,
    });
    const areaErrors = areaIssues.filter((i) => i.severity === 'error');
    if (areaErrors.length > 0) {
      throw { status: 400, message: areaErrors.map((e) => e.message).join(' ') };
    }

    return {
      fields: out,
      warnings: [
        ...warnings,
        ...areaIssues.filter((i) => i.severity === 'warning').map((i) => i.message),
      ],
    };
  }

  private static toCreateData(data: Partial<ProjectUnitCreateInput>) {
    const { fields: areaFields } = this.resolveAreaFields(data);
    return {
      unit_number: data.unit_number,
      unit_type: data.unit_type,
      plot_number: data.plot_number ?? null,
      survey_number: data.survey_number ?? null,
      tower: data.tower ?? null,
      block: data.block ?? null,
      floor: data.floor ?? null,
      flat_number: data.flat_number ?? null,
      villa_number: data.villa_number ?? null,
      type_code: data.type_code ?? null,

      bhk: data.bhk ?? null,
      listing_type: data.listing_type ?? null,
      bedrooms: data.bedrooms ?? null,
      bathrooms: data.bathrooms ?? null,
      balconies: data.balconies ?? null,
      living_rooms: data.living_rooms ?? null,
      kitchens: data.kitchens ?? null,
      utility_rooms: data.utility_rooms ?? null,
      has_pooja_room: data.has_pooja_room ?? false,
      has_study_room: data.has_study_room ?? false,

      ...areaFields,
      ground_floor_area_sqft: data.ground_floor_area_sqft ?? null,
      first_floor_area_sqft: data.first_floor_area_sqft ?? null,
      total_floors: data.total_floors ?? null,
      price_basis: data.price_basis ?? undefined,

      facing: data.facing ?? null,
      is_corner: data.is_corner ?? false,
      is_road_facing: data.is_road_facing ?? false,
      is_park_facing: data.is_park_facing ?? false,
      is_main_road_facing: data.is_main_road_facing ?? false,
      road_width_ft: data.road_width_ft ?? null,
      view: data.view ?? null,

      parking_included: data.parking_included ?? false,
      parking_type: data.parking_type ?? null,
      parking_count: data.parking_count ?? null,
      parking_slots: data.parking_slots ?? null,

      base_rate: data.base_rate ?? null,
      base_rate_unit: data.base_rate_unit ?? null,
      discount_amount: data.discount_amount ?? 0,
      discount_reason: data.discount_reason ?? null,

      sales_status: data.sales_status ?? undefined,
      notes: data.notes ?? null,
      // Only overwritten when the caller actually sent a list — AmenityService
      // also writes this field directly (see its applySelectedUnits), and a
      // plain field edit through this path must not clobber that.
      selected_optional_rule_ids: data.selected_optional_rule_ids ?? undefined,
    };
  }

  static async listUnits(
    user: TokenPayload,
    projectId: number,
    filters: {
      unit_type?: string;
      sales_status?: string;
      tower?: string;
      floor?: number;
      bhk?: string;
      facing?: string;
      search?: string;
    },
    take = 50,
    skip = 0,
  ) {
    await this.assertProjectInScope(user, projectId);

    const where: Prisma.ProjectUnitWhereInput = { project_id: projectId };
    if (filters.unit_type) where.unit_type = filters.unit_type as any;
    if (filters.sales_status) where.sales_status = filters.sales_status as any;
    if (filters.tower) where.tower = filters.tower;
    if (filters.floor != null) where.floor = filters.floor;
    if (filters.bhk) where.bhk = filters.bhk;
    if (filters.facing) where.facing = filters.facing;
    if (filters.search) {
      where.OR = [
        { unit_number: { contains: filters.search } },
        { plot_number: { contains: filters.search } },
        { flat_number: { contains: filters.search } },
        { villa_number: { contains: filters.search } },
      ];
    }

    const [units, total] = await Promise.all([
      p.projectUnit.findMany({
        where,
        take,
        skip,
        orderBy: [{ tower: 'asc' }, { floor: 'asc' }, { unit_number: 'asc' }],
      }),
      p.projectUnit.count({ where }),
    ]);

    return { units, total };
  }

  static async getUnit(user: TokenPayload, unitId: number) {
    const unit = await p.projectUnit.findUnique({
      where: { id: unitId },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            project_code: true,
            location: true,
            assigned_pm_id: true,
            company_id: true,
            branch_id: true,
          },
        },
        price_lines: { orderBy: { sort_order: 'asc' } },
        features: true,
        images: { orderBy: { sort_order: 'asc' } },
        documents: true,
      },
    });
    if (!unit) throw { status: 404, message: 'Unit not found' };

    // Scope via the parent project, matching every other unit operation.
    const scope = await buildProjectScope(user);
    const inScope = await p.project.findFirst({
      where: { id: unit.project_id, ...scope },
      select: { id: true },
    });
    if (!inScope) throw { status: 404, message: 'Unit not found' };

    return unit;
  }

  static async createUnit(user: TokenPayload, projectId: number, data: ProjectUnitCreateInput) {
    const project = await this.assertProjectInScope(user, projectId);
    if (!can(user, Permissions.PROJECTS_UPDATE, project)) {
      throw { status: 403, message: 'Forbidden: Missing projects.update permission' };
    }

    const unitCode = await this.generateUnitCode(project.project_code);
    const createData = this.toCreateData(data);

    const unit = await p.projectUnit.create({
      data: {
        unit_code: unitCode,
        project_id: projectId,
        company_id: project.company_id,
        branch_id: project.branch_id,
        created_by_id: user.employeeId,
        ...createData,
      } as any,
    });

    if (data.manual_lines?.length) {
      await p.priceLine.createMany({
        data: data.manual_lines.map((m, i) => ({
          project_unit_id: unit.id,
          label: m.label,
          kind: 'CHARGE' as const,
          category: m.category ?? ('OTHER' as const),
          calc_method: 'FIXED' as const,
          rate: m.amount,
          quantity: 1,
          amount: m.amount,
          is_manual: true,
          sort_order: 900 + i,
        })),
      });
    }

    const { _computation, ...priced } = await PricingService.recalculateUnit(unit.id);
    return priced;
  }

  static async updateUnit(user: TokenPayload, unitId: number, data: ProjectUnitUpdateInput) {
    const unit = await p.projectUnit.findUnique({ where: { id: unitId } });
    if (!unit) throw { status: 404, message: 'Unit not found' };
    const project = await this.assertProjectInScope(user, unit.project_id);
    if (!can(user, Permissions.PROJECTS_UPDATE, project)) {
      throw { status: 403, message: 'Forbidden: Missing projects.update permission' };
    }

    // sales_status is not editable through the general update path — it is
    // owned by changeStatus() (manual states) and the booking workflow
    // (RESERVED/BOOKED/SOLD), never by a free-form field edit.
    const { sales_status: _ignored, manual_lines, ...rest } = data;

    // toCreateData defaults every omitted field to null/false — correct for a
    // CREATE, wrong for a partial UPDATE (a PUT with just `{ is_corner: true }`
    // must not silently wipe facing/floor/etc. back to null). Merging the
    // incoming partial over the existing row first means toCreateData only
    // ever sees "no value provided" for fields that were never set at all,
    // never for fields this request simply didn't touch.
    const merged = { ...(unit as any), ...rest };
    const updateData = this.toCreateData(merged);

    await p.projectUnit.update({ where: { id: unitId }, data: updateData as any });

    if (manual_lines !== undefined) {
      await p.priceLine.deleteMany({ where: { project_unit_id: unitId, is_manual: true } });
      if (manual_lines.length) {
        await p.priceLine.createMany({
          data: manual_lines.map((m, i) => ({
            project_unit_id: unitId,
            label: m.label,
            kind: 'CHARGE' as const,
            category: m.category ?? ('OTHER' as const),
            calc_method: 'FIXED' as const,
            rate: m.amount,
            quantity: 1,
            amount: m.amount,
            is_manual: true,
            sort_order: 900 + i,
          })),
        });
      }
    }

    const { _computation, ...priced } = await PricingService.recalculateUnit(unitId);
    return priced;
  }

  /**
   * Manual status changes only. RESERVED/BOOKED/SOLD are owned by the booking
   * workflow (services/inventory/reference.ts) and rejected here — an admin
   * cannot mark a unit BOOKED by hand while a real booking exists, or a
   * cancelled/completed booking's inventory state would drift from reality.
   */
  static async changeStatus(user: TokenPayload, unitId: number, status: string, reason?: string) {
    const unit = await p.projectUnit.findUnique({ where: { id: unitId } });
    if (!unit) throw { status: 404, message: 'Unit not found' };
    const project = await this.assertProjectInScope(user, unit.project_id);
    if (!can(user, Permissions.PROJECTS_UPDATE, project)) {
      throw { status: 403, message: 'Forbidden: Missing projects.update permission' };
    }

    if (['RESERVED', 'BOOKED'].includes(status)) {
      throw {
        status: 409,
        message: `${status} is set automatically when a booking is created — it cannot be set manually.`,
      };
    }
    if (status === 'SOLD' && unit.sales_status !== 'BOOKED') {
      throw {
        status: 409,
        message: 'A unit can only be marked SOLD from BOOKED (on final payment/registration).',
      };
    }
    if (unit.locked_by_booking_id && !['SOLD'].includes(status)) {
      throw {
        status: 409,
        message: 'This unit is locked by an active booking. Cancel the booking first.',
      };
    }

    return p.$transaction(async (tx) => {
      const updated = await tx.projectUnit.update({
        where: { id: unitId },
        data: { sales_status: status as any },
      });
      await tx.auditEvent.create({
        data: {
          actor_id: user.employeeId || 1,
          action: 'STATUS_CHANGE',
          entity_type: 'PROJECT_UNIT',
          entity_id: unitId,
          old_value: unit.sales_status,
          new_value: status,
          reason: reason || null,
        },
      });
      return updated;
    });
  }

  static async overridePrice(
    user: TokenPayload,
    unitId: number,
    overridePrice: number | null,
    reason?: string | null,
  ) {
    const unit = await p.projectUnit.findUnique({ where: { id: unitId } });
    if (!unit) throw { status: 404, message: 'Unit not found' };
    const project = await this.assertProjectInScope(user, unit.project_id);
    if (!can(user, Permissions.PROJECTS_UPDATE, project)) {
      throw { status: 403, message: 'Forbidden: Missing projects.update permission' };
    }

    const oldFinal = unit.final_price;
    await p.projectUnit.update({
      where: { id: unitId },
      data: {
        override_price: overridePrice,
        override_reason: overridePrice != null ? (reason ?? null) : null,
        overridden_by_id: overridePrice != null ? user.employeeId : null,
        overridden_at: overridePrice != null ? new Date() : null,
      },
    });

    const { _computation, ...priced } = await PricingService.recalculateUnit(unitId);

    await p.auditEvent.create({
      data: {
        actor_id: user.employeeId || 1,
        action: 'PRICE_OVERRIDE',
        entity_type: 'PROJECT_UNIT',
        entity_id: unitId,
        old_value: String(oldFinal),
        new_value: String(priced.final_price),
        reason: reason || null,
      },
    });

    return priced;
  }

  /** Blocked once a unit is under an active commercial state — deleting a unit
   * a customer already committed to would silently orphan their booking. */
  static async deleteUnit(user: TokenPayload, unitId: number) {
    const unit = await p.projectUnit.findUnique({ where: { id: unitId } });
    if (!unit) throw { status: 404, message: 'Unit not found' };
    const project = await this.assertProjectInScope(user, unit.project_id);
    if (!can(user, Permissions.PROJECTS_UPDATE, project)) {
      throw { status: 403, message: 'Forbidden: Missing projects.update permission' };
    }

    if (['RESERVED', 'BOOKED', 'SOLD'].includes(unit.sales_status)) {
      throw {
        status: 409,
        message: `Cannot delete: unit is ${unit.sales_status}. Resolve the booking first.`,
      };
    }

    const [bookingCount, interestCount] = await Promise.all([
      p.booking.count({ where: { project_unit_id: unitId } }),
      p.leadPropertyInterest.count({ where: { project_unit_id: unitId } }),
    ]);
    if (bookingCount > 0) {
      throw {
        status: 409,
        message: 'Cannot delete: this unit has booking history. Change its status instead.',
      };
    }
    if (interestCount > 0) {
      throw {
        status: 409,
        message:
          'Cannot delete: leads have shown interest in this unit. Change its status instead.',
      };
    }

    await p.projectUnit.delete({ where: { id: unitId } });
    return { deleted: true };
  }

  /** A free-standing feature ("Park Facing", "2 Car Parking") — distinct from a
   * project amenity, which every matching unit shares (spec section 29). */
  static async addFeature(
    user: TokenPayload,
    unitId: number,
    label: string,
    chargeAmount?: number | null,
  ) {
    const unit = await p.projectUnit.findUnique({ where: { id: unitId } });
    if (!unit) throw { status: 404, message: 'Unit not found' };
    const project = await this.assertProjectInScope(user, unit.project_id);
    if (!can(user, Permissions.PROJECTS_UPDATE, project)) {
      throw { status: 403, message: 'Forbidden: Missing projects.update permission' };
    }
    return p.inventoryFeature.create({
      data: { project_unit_id: unitId, label, charge_amount: chargeAmount ?? null },
    });
  }

  static async removeFeature(user: TokenPayload, unitId: number, featureId: number) {
    const unit = await p.projectUnit.findUnique({ where: { id: unitId } });
    if (!unit) throw { status: 404, message: 'Unit not found' };
    const project = await this.assertProjectInScope(user, unit.project_id);
    if (!can(user, Permissions.PROJECTS_UPDATE, project)) {
      throw { status: 403, message: 'Forbidden: Missing projects.update permission' };
    }
    const feature = await p.inventoryFeature.findFirst({
      where: { id: featureId, project_unit_id: unitId },
    });
    if (!feature) throw { status: 404, message: 'Feature not found' };
    await p.inventoryFeature.delete({ where: { id: featureId } });
    return { deleted: true };
  }

  /** STATUS_CHANGE and PRICE_OVERRIDE events are already written by changeStatus/overridePrice above — this just lists them. */
  static async listActivity(user: TokenPayload, unitId: number) {
    const unit = await p.projectUnit.findUnique({ where: { id: unitId } });
    if (!unit) throw { status: 404, message: 'Unit not found' };
    await this.assertProjectInScope(user, unit.project_id);

    const events = await p.auditEvent.findMany({
      where: { entity_type: 'PROJECT_UNIT', entity_id: unitId },
      orderBy: { created_at: 'desc' },
    });
    // AuditEvent.actor_id has no FK relation (see schema.prisma) — resolve
    // names with a single batched lookup rather than one query per row.
    const actorIds = [...new Set(events.map((e) => e.actor_id))];
    const actors = await p.employee.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, full_name: true },
    });
    const nameById = new Map(actors.map((a) => [a.id, a.full_name]));
    return events.map((e) => ({ ...e, actor_name: nameById.get(e.actor_id) || null }));
  }

  /**
   * Live inventory counts — spec section 24: "No one should manually enter
   * these numbers. They should be calculated from the units." Backs the
   * inventory summary tiles on the project dashboard.
   */
  static async getInventorySummary(user: TokenPayload, projectId: number) {
    await this.assertProjectInScope(user, projectId);

    const [byStatus, byType, totalAgg] = await Promise.all([
      p.projectUnit.groupBy({
        by: ['sales_status'],
        where: { project_id: projectId },
        _count: { _all: true },
        _sum: { final_price: true },
      }),
      p.projectUnit.groupBy({
        by: ['unit_type'],
        where: { project_id: projectId },
        _count: { _all: true },
      }),
      p.projectUnit.aggregate({
        where: { project_id: projectId },
        _count: { _all: true },
        _sum: { final_price: true },
        _min: { final_price: true },
        _max: { final_price: true },
      }),
    ]);

    const statusCounts: Record<string, number> = {};
    const statusValue: Record<string, number> = {};
    for (const row of byStatus) {
      statusCounts[row.sales_status] = row._count._all;
      statusValue[row.sales_status] = row._sum.final_price || 0;
    }

    const typeCounts: Record<string, number> = {};
    for (const row of byType) {
      typeCounts[row.unit_type] = row._count._all;
    }

    const soldValue = (statusValue.SOLD || 0) + (statusValue.BOOKED || 0);

    return {
      total_units: totalAgg._count._all,
      by_status: statusCounts,
      by_unit_type: typeCounts,
      total_inventory_value: totalAgg._sum.final_price || 0,
      sold_and_booked_value: soldValue,
      price_range: { min: totalAgg._min.final_price || 0, max: totalAgg._max.final_price || 0 },
    };
  }

  /**
   * Bulk generation — the "Generate many" mode. Fetches the project's pricing
   * rules once and prices every row against them (rather than looping
   * PricingService.recalculateUnit, which would refetch rules per row).
   */
  static async bulkCreateUnits(
    user: TokenPayload,
    projectId: number,
    payload: ProjectUnitBulkCreateInput,
  ) {
    const project = await this.assertProjectInScope(user, projectId);
    if (!can(user, Permissions.PROJECTS_UPDATE, project)) {
      throw { status: 403, message: 'Forbidden: Missing projects.update permission' };
    }

    const engineRules = await getEffectiveRules(projectId);

    const common = payload.common || {};
    const failed: { index: number; error: string }[] = [];
    const createdIds: number[] = [];
    let created = 0;

    await p.$transaction(async (tx) => {
      for (let i = 0; i < payload.units.length; i++) {
        const row = { ...common, ...payload.units[i] };
        try {
          if (!row.unit_number) throw new Error('unit_number is required');
          if (!row.unit_type) throw new Error('unit_type is required (per-unit or common)');

          const createData = this.toCreateData(row);
          const unitCode = await this.generateUnitCode(project.project_code, tx as any);

          const unit = await tx.projectUnit.create({
            data: {
              unit_code: unitCode,
              project_id: projectId,
              company_id: project.company_id,
              branch_id: project.branch_id,
              created_by_id: user.employeeId,
              ...createData,
            } as any,
          });

          const engineInput: PricingUnitInput = {
            unit_type: unit.unit_type,
            price_basis: unit.price_basis,
            area_sqft: unit.area_sqft,
            carpet_area_sqft: unit.carpet_area_sqft,
            built_up_area_sqft: unit.built_up_area_sqft,
            super_built_up_area_sqft: unit.super_built_up_area_sqft,
            plot_area_sqyd: unit.plot_area_sqyd,
            facing: unit.facing,
            floor: unit.floor,
            bhk: unit.bhk,
            type_code: unit.type_code,
            view: unit.view,
            is_corner: unit.is_corner,
            is_road_facing: unit.is_road_facing,
            is_park_facing: unit.is_park_facing,
            is_main_road_facing: unit.is_main_road_facing,
            parking_count: unit.parking_count,
            base_rate: unit.base_rate,
            base_rate_unit: unit.base_rate_unit,
            discount_amount: unit.discount_amount,
            discount_reason: unit.discount_reason,
            manual_lines: row.manual_lines,
            selected_optional_rule_ids: [],
          };
          const computation = computePrice(engineInput, engineRules);
          const finalPrice = resolveFinalPrice(computation.calculated_price, null);

          await tx.projectUnit.update({
            where: { id: unit.id },
            data: {
              base_price: computation.base_price,
              premiums_total: computation.premiums_total,
              charges_total: computation.charges_total,
              taxes_total: computation.taxes_total,
              discount_amount: computation.discount_amount,
              calculated_price: computation.calculated_price,
              final_price: finalPrice,
              price_computed_at: new Date(),
            },
          });

          if (computation.lines.length > 0) {
            await tx.priceLine.createMany({
              data: computation.lines.map((l) => ({
                project_unit_id: unit.id,
                rule_id: l.rule_id,
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
              })),
            });
          }

          created++;
          createdIds.push(unit.id);
        } catch (err: any) {
          failed.push({ index: i, error: err?.message || 'Unknown error creating this unit' });
        }
      }
    });

    return { created, total: payload.units.length, failed, created_ids: createdIds };
  }
}
