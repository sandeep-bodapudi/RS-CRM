import { prisma } from '../lib/prisma';
import { TokenPayload } from '../utils/jwt';
import { buildProjectScope } from '../authz/dataScope';
import { can } from '../authz/authorization';
import { Permissions } from '../shared';
import {
  AmenityCreateInput,
  AmenityUpdateInput,
  ProjectAmenityUpsertInput,
} from '../shared/amenity';

const p = prisma;

// The catalog (Amenity) is company-wide, not tied to any one project, so
// `can()`'s PROJECTS_UPDATE policy check — which requires a project resource
// and returns false without one — doesn't apply here. Base-permission check
// only, same convention as the per-project checks below minus the resource.
function hasCatalogAccess(user: TokenPayload): boolean {
  return (user.permissions || []).includes(Permissions.PROJECTS_UPDATE);
}

/**
 * Company-wide amenity catalog + per-project amenity configuration
 * (Rebuild Phase 3, closing the gap the implementation plan's section 6.2
 * flagged: the Amenity/ProjectAmenity tables existed in the schema since
 * Phase 1 but had no CRUD at all).
 *
 * Gated on PROJECTS_READ/PROJECTS_UPDATE, same as pricing rules — this build
 * deliberately deferred a generic admin-configurable permission surface
 * (Charge Master / Amenity Master was explicitly scoped out), so amenities
 * are managed by whoever can manage a project.
 */
export class AmenityService {
  // ---- Company-wide catalog -----------------------------------------------

  static async listCatalog(user: TokenPayload) {
    return p.amenity.findMany({
      where: { company_id: user.companyId, is_active: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  static async createCatalogAmenity(user: TokenPayload, data: AmenityCreateInput) {
    if (!hasCatalogAccess(user)) {
      throw { status: 403, message: 'Forbidden: Missing projects.update permission' };
    }
    try {
      return await p.amenity.create({ data: { company_id: user.companyId, ...data } });
    } catch (err: any) {
      if (err?.code === 'P2002')
        throw { status: 409, message: 'An amenity with this name already exists' };
      throw err;
    }
  }

  static async updateCatalogAmenity(
    user: TokenPayload,
    amenityId: number,
    data: AmenityUpdateInput,
  ) {
    if (!hasCatalogAccess(user)) {
      throw { status: 403, message: 'Forbidden: Missing projects.update permission' };
    }
    const amenity = await p.amenity.findFirst({
      where: { id: amenityId, company_id: user.companyId },
    });
    if (!amenity) throw { status: 404, message: 'Amenity not found' };
    return p.amenity.update({ where: { id: amenityId }, data });
  }

  /** Soft-deactivate — a project may still reference this amenity historically. */
  static async deleteCatalogAmenity(user: TokenPayload, amenityId: number) {
    if (!hasCatalogAccess(user)) {
      throw { status: 403, message: 'Forbidden: Missing projects.update permission' };
    }
    const amenity = await p.amenity.findFirst({
      where: { id: amenityId, company_id: user.companyId },
    });
    if (!amenity) throw { status: 404, message: 'Amenity not found' };
    await p.amenity.update({ where: { id: amenityId }, data: { is_active: false } });
    return { deactivated: true };
  }

  // ---- Per-project configuration ------------------------------------------

  private static async assertProjectInScope(user: TokenPayload, projectId: number) {
    const scope = await buildProjectScope(user);
    const project = await p.project.findFirst({ where: { id: projectId, ...scope } });
    if (!project) throw { status: 404, message: 'Project not found' };
    return project;
  }

  static async listProjectAmenities(user: TokenPayload, projectId: number) {
    await this.assertProjectInScope(user, projectId);
    return p.projectAmenity.findMany({
      where: { project_id: projectId },
      include: { amenity: true },
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * Upsert one project's configuration of one catalog amenity. When
   * CHARGEABLE+SELECTED_UNITS, also writes the chosen unit ids onto each
   * ProjectUnit's `selected_optional_rule_ids` (encoded as `-amenityId` so it
   * never collides with a real ProjectPricingRule id — see
   * pricing.service.ts's getEffectiveRules/amenityToEngineRule).
   *
   * Deliberately does NOT recompute any unit's price here — same as
   * PricingRulesService's rule CRUD, a configuration change here only takes
   * effect on existing units once "Recalculate All Units" is explicitly run
   * (Decision 2: recalculation is a preview-then-apply action, never
   * automatic, so a shown price never moves without the admin seeing why). A
   * brand-new unit still picks it up immediately, because createUnit always
   * prices against the project's current effective rules.
   */
  static async setProjectAmenity(
    user: TokenPayload,
    projectId: number,
    amenityId: number,
    data: ProjectAmenityUpsertInput,
  ) {
    const project = await this.assertProjectInScope(user, projectId);
    if (!can(user, Permissions.PROJECTS_UPDATE, project)) {
      throw { status: 403, message: 'Forbidden: Missing projects.update permission' };
    }
    const amenity = await p.amenity.findFirst({
      where: { id: amenityId, company_id: user.companyId },
    });
    if (!amenity) throw { status: 404, message: 'Amenity not found' };

    const { selected_unit_ids, ...rest } = data;

    const projectAmenity = await p.projectAmenity.upsert({
      where: { project_id_amenity_id: { project_id: projectId, amenity_id: amenityId } },
      create: { project_id: projectId, amenity_id: amenityId, ...rest },
      update: rest,
      include: { amenity: true },
    });

    const isSelected =
      projectAmenity.availability === 'CHARGEABLE' &&
      projectAmenity.applicability === 'SELECTED_UNITS';
    await this.applySelectedUnits(
      projectId,
      amenityId,
      isSelected ? (selected_unit_ids ?? []) : null,
    );

    return projectAmenity;
  }

  /**
   * Writes/clears the `-amenityId` marker on every unit's
   * `selected_optional_rule_ids`: present for units in `unitIds`, absent for
   * every other unit in the project. Passing `null` clears the marker from
   * every unit (used when the amenity stops being SELECTED_UNITS-scoped).
   */
  private static async applySelectedUnits(
    projectId: number,
    amenityId: number,
    unitIds: number[] | null,
  ): Promise<void> {
    const marker = -amenityId;
    const units = await p.projectUnit.findMany({
      where: { project_id: projectId },
      select: { id: true, selected_optional_rule_ids: true },
    });

    const wantSelected = new Set(unitIds ?? []);

    for (const unit of units) {
      const current: number[] = Array.isArray(unit.selected_optional_rule_ids)
        ? (unit.selected_optional_rule_ids as number[])
        : [];
      const hasMarker = current.includes(marker);
      const shouldHave = unitIds !== null && wantSelected.has(unit.id);
      if (hasMarker === shouldHave) continue;

      const next = shouldHave ? [...current, marker] : current.filter((id) => id !== marker);
      await p.projectUnit.update({
        where: { id: unit.id },
        data: { selected_optional_rule_ids: next },
      });
    }
  }

  static async removeProjectAmenity(user: TokenPayload, projectId: number, amenityId: number) {
    const project = await this.assertProjectInScope(user, projectId);
    if (!can(user, Permissions.PROJECTS_UPDATE, project)) {
      throw { status: 403, message: 'Forbidden: Missing projects.update permission' };
    }
    const existing = await p.projectAmenity.findUnique({
      where: { project_id_amenity_id: { project_id: projectId, amenity_id: amenityId } },
    });
    if (!existing) throw { status: 404, message: 'This amenity is not configured on this project' };

    await p.projectAmenity.delete({
      where: { project_id_amenity_id: { project_id: projectId, amenity_id: amenityId } },
    });
    await this.applySelectedUnits(projectId, amenityId, null);
    return { removed: true };
  }
}
