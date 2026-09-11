"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PropertyService = exports.deriveAvailability = void 0;
const prisma_1 = require("../lib/prisma");
const shared_1 = require("../shared");
const authorization_1 = require("../authz/authorization");
const shared_2 = require("../shared");
const workflowEngine_1 = require("../workflows/workflowEngine");
const types_1 = require("../workflows/types");
const dataScope_1 = require("../authz/dataScope");
const slugify_1 = require("../utils/slugify");
const logger_1 = require("../utils/logger");
const measurement_1 = require("../shared/measurement");
const pricing_service_1 = require("./pricing/pricing.service");
const p = prisma_1.prisma;
/**
 * Resolves the flat area/pricing fields Phase 1's migration added to Property
 * (mirroring ProjectUnitService.resolveAreaFields/toCreateData so "one form
 * serves both", per that migration's own doc comment) into DB-ready columns.
 * `area_sqft` itself stays untouched here — it remains the pre-existing
 * required field read throughout the rest of the codebase (search, per-sqft
 * calculations, analytics); `area_value`/`area_unit`/`area_sqyd` are the
 * additional richer vocabulary layered on top for dual-unit display and
 * plot-style entry, same relationship ProjectUnit has between its own
 * area_sqft and area_value/area_unit.
 */
function resolvePropertyPricingFields(data) {
    const out = {};
    if (data.area_value != null && data.area_unit) {
        const normalized = (0, measurement_1.normalizeArea)(data.area_value, data.area_unit);
        out.area_value = normalized.area_value;
        out.area_unit = normalized.area_unit;
        out.area_sqyd = normalized.area_sqyd;
    }
    if (data.plot_length_ft && data.plot_width_ft) {
        const derived = (0, measurement_1.areaFromDimensions)(data.plot_length_ft, data.plot_width_ft);
        if (data.plot_area_sqyd == null) {
            out.plot_area_sqyd = derived.area_sqyd;
        }
        // A >2% disagreement is surfaced as a warning on the ProjectUnit path;
        // here it isn't blocking either — real plots are frequently irregular.
    }
    if (data.plot_area_sqyd != null)
        out.plot_area_sqyd = data.plot_area_sqyd;
    if (data.plot_length_ft != null)
        out.plot_length_ft = data.plot_length_ft;
    if (data.plot_width_ft != null)
        out.plot_width_ft = data.plot_width_ft;
    for (const key of [
        'carpet_area_sqft', 'built_up_area_sqft', 'super_built_up_area_sqft',
        'ground_floor_area_sqft', 'first_floor_area_sqft', 'total_floors', 'construction_year',
        'price_basis', 'view', 'road_width_ft', 'base_rate', 'base_rate_unit',
        'discount_amount', 'discount_reason',
    ]) {
        if (data[key] !== undefined)
            out[key] = data[key];
    }
    for (const key of ['is_corner', 'is_park_facing', 'is_road_facing', 'is_main_road_facing']) {
        if (data[key] !== undefined)
            out[key] = !!data[key];
    }
    return out;
}
/**
 * Builds the Prisma nested-write for one 1:1 sub-record (pricing, or any of
 * the 7 category detail tables) on an update. Only ever issues `delete` when
 * the row is actually there — PropertyForm.tsx submits the whole fetched
 * property back on every save, so `villa_details: null` arrives even when no
 * PropertyVillaDetails row was ever created; `{ delete: true }` against a
 * relation that was never there throws (Prisma P2025), so this must be a
 * harmless no-op instead. Returns `{}` (no key at all) when the caller sent
 * nothing for this field, leaving the existing row untouched.
 */
function subRecordUpdate(key, incoming, existing) {
    if (incoming === undefined)
        return {};
    if (incoming)
        return { [key]: { upsert: { create: incoming, update: incoming } } };
    return { [key]: existing ? { delete: true } : undefined };
}
/** Delete-and-recreate manual PriceLine rows for a property — mirrors
 * ProjectUnitService's identical pattern for units. */
async function replaceManualPriceLines(propertyId, manualLines) {
    await p.priceLine.deleteMany({ where: { property_id: propertyId, is_manual: true } });
    if (manualLines.length) {
        await p.priceLine.createMany({
            data: manualLines.map((m, i) => ({
                property_id: propertyId,
                label: m.label,
                kind: 'CHARGE',
                category: m.category ?? 'OTHER',
                calc_method: 'FIXED',
                rate: m.amount,
                quantity: 1,
                amount: m.amount,
                is_manual: true,
                sort_order: 900 + i,
            })),
        });
    }
}
/**
 * Derives the public-facing availability status from internal property state.
 * AVAILABLE: LIVE and no active lock
 * RESERVED: LOCKED with an active (non-expired) lock
 * SOLD: BOOKED or SOLD
 * UNAVAILABLE: PENDING_*, REJECTED, or any other internal state
 *
 * Expired locks resolve to AVAILABLE — the property is effectively free inventory.
 */
function deriveAvailability(property) {
    if (property.status === 'LIVE')
        return 'AVAILABLE';
    if (property.status === 'LOCKED') {
        if (property.locked_until && property.locked_until < new Date())
            return 'AVAILABLE';
        return 'RESERVED';
    }
    if (property.status === 'BOOKED' || property.status === 'SOLD')
        return 'SOLD';
    return 'UNAVAILABLE';
}
exports.deriveAvailability = deriveAvailability;
class PropertyService {
    static async generateNextPropertyCode() {
        const currentYear = new Date().getFullYear();
        const count = await p.property.count();
        const seq = (count + 1).toString().padStart(4, '0');
        return `RRH-PR-${currentYear}-${seq}`;
    }
    static async listProperties(user, filters, take = 20, skip = 0) {
        const whereCondition = await (0, dataScope_1.buildPropertyScope)(user);
        if (filters.brand) {
            whereCondition.brand_type = filters.brand;
        }
        if (filters.category) {
            whereCondition.category = filters.category;
        }
        // Decision 3: sales_status (commercial availability) is a separate axis
        // from `status` (the listing/publication pipeline) — never conflate them
        // into one filter (see PropertyManagement.tsx's two independent rows).
        if (filters.sales_status) {
            whereCondition.sales_status = filters.sales_status;
        }
        if (filters.status) {
            whereCondition.status = filters.status;
        }
        else {
            // Archived listings are a soft-delete state — hidden by default, only
            // shown when explicitly filtered for (?status=ARCHIVED).
            whereCondition.status = { not: 'ARCHIVED' };
        }
        if (filters.project_id) {
            whereCondition.project_id = filters.project_id;
        }
        else {
            // Phase 2.17: the Properties page shows standalone inventory only —
            // project units are reached exclusively through that project's own
            // Units view (GET /properties?project_id=X, the branch above).
            whereCondition.project_id = null;
        }
        if (filters.unassigned) {
            whereCondition.assigned_pm_id = null;
        }
        if (filters.dm_executive_id) {
            whereCondition.digital_marketing_executive_id = filters.dm_executive_id;
        }
        return await p.property.findMany({
            where: whereCondition,
            take,
            skip,
            include: {
                assigned_pm: { select: { id: true, employee_code: true, full_name: true, phone: true } },
                created_by: { select: { id: true, employee_code: true, full_name: true } },
                images: true,
                pricing: true,
                plot_details: true,
                apartment_details: true,
                villa_details: true,
                house_details: true,
                commercial_shop_details: true,
                commercial_office_details: true,
                farm_land_details: true,
                price_lines: { orderBy: { sort_order: 'asc' } },
                verification_logs: {
                    orderBy: { created_at: 'desc' },
                    include: { actor: { select: { id: true, employee_code: true, full_name: true } } },
                },
                publications: true,
                _count: {
                    select: { interested_leads: true }
                },
            },
            orderBy: { created_at: 'desc' },
        });
    }
    /** Single-property fetch, scoped like listProperties. Was missing entirely —
     * the frontend worked around it by calling the list endpoint with ?project_id=. */
    static async getProperty(user, propertyId) {
        const whereCondition = await (0, dataScope_1.buildPropertyScope)(user);
        const property = await p.property.findFirst({
            where: { id: propertyId, ...whereCondition },
            include: {
                project: { select: { id: true, name: true, project_code: true, location: true } },
                assigned_pm: { select: { id: true, employee_code: true, full_name: true, phone: true } },
                created_by: { select: { id: true, employee_code: true, full_name: true } },
                digital_marketing_executive: { select: { id: true, employee_code: true, full_name: true } },
                images: { orderBy: { sort_order: 'asc' } },
                pricing: true,
                plot_details: true,
                apartment_details: true,
                villa_details: true,
                house_details: true,
                commercial_shop_details: true,
                commercial_office_details: true,
                farm_land_details: true,
                price_lines: { orderBy: { sort_order: 'asc' } },
                verification_logs: {
                    orderBy: { created_at: 'desc' },
                    include: { actor: { select: { id: true, employee_code: true, full_name: true } } },
                },
                publications: true,
                _count: { select: { interested_leads: true } },
            },
        });
        if (!property)
            throw { status: 404, message: 'Property not found or unauthorized' };
        return property;
    }
    /**
     * Soft-deletes ("archives") a property by transitioning status to ARCHIVED —
     * mirrors ProjectService.deleteProject's soft CANCELLED transition rather than
     * a hard row delete, since Property is referenced by Lead/Booking/SiteVisit/etc.
     * Blocked once a unit is under an active commercial state (LOCKED/BOOKED/SOLD)
     * — archiving a listing must never hide a unit a customer already committed to.
     * Idempotent if already ARCHIVED.
     */
    static async archiveProperty(user, propertyId, reason) {
        if (!(0, authorization_1.can)(user, shared_2.Permissions.PROPERTIES_DELETE)) {
            throw { status: 403, message: 'Forbidden: Missing properties.delete permission' };
        }
        const whereCondition = await (0, dataScope_1.buildPropertyScope)(user);
        const property = await p.property.findFirst({ where: { id: propertyId, ...whereCondition } });
        if (!property)
            throw { status: 404, message: 'Property not found or unauthorized' };
        if (!(0, authorization_1.can)(user, shared_2.Permissions.PROPERTIES_DELETE, property)) {
            throw { status: 403, message: 'Forbidden: Insufficient permissions or out of scope' };
        }
        if (property.status === 'ARCHIVED') {
            return property;
        }
        if (['LOCKED', 'BOOKED', 'SOLD'].includes(property.status)) {
            throw {
                status: 409,
                message: `Cannot archive a property that is ${property.status}. Resolve the active booking first.`,
            };
        }
        return await p.$transaction(async (tx) => {
            const updated = await tx.property.update({
                where: { id: propertyId },
                data: { status: 'ARCHIVED' },
            });
            await tx.propertyVerificationLog.create({
                data: {
                    property_id: propertyId,
                    actor_id: user.employeeId || 1,
                    from_status: property.status,
                    to_status: 'ARCHIVED',
                    notes: reason ? `Archived. Reason: ${reason}` : 'Archived by user.',
                },
            });
            await tx.auditEvent.create({
                data: {
                    actor_id: user.employeeId || 1,
                    action: 'ARCHIVE',
                    entity_type: 'PROPERTY',
                    entity_id: propertyId,
                    old_value: property.status,
                    new_value: 'ARCHIVED',
                    reason: reason || null,
                },
            });
            return updated;
        });
    }
    static async createProperty(user, data) {
        if (!(0, authorization_1.can)(user, shared_2.Permissions.PROPERTIES_CREATE)) {
            throw { status: 403, message: 'Forbidden: Missing properties.create permission' };
        }
        const companyId = user.companyId || 1;
        const branchId = user.branchId || 1;
        const employeeId = user.employeeId || 1;
        let project = null;
        if (data.project_id) {
            project = await p.project.findFirst({
                where: { id: data.project_id, company_id: companyId }
            });
            if (!project) {
                throw { status: 400, message: 'Invalid or unauthorized project reference' };
            }
        }
        const propertyCode = await this.generateNextPropertyCode();
        let finalPmId = null;
        if (data.assigned_pm_id) {
            // Explicit PM assignment
            const pm = await p.employee.findFirst({
                where: { id: data.assigned_pm_id, company_id: companyId, status: 'ACTIVE' }
            });
            if (!pm) {
                throw { status: 400, message: 'Invalid or unauthorized project manager assigned' };
            }
            finalPmId = pm.id;
        }
        else if (project && project.assigned_pm_id) {
            // Inherit from project
            finalPmId = project.assigned_pm_id;
        }
        if (!finalPmId && data.city) {
            // Find PMs assigned to this city
            const assignments = await p.pMLocationAssignment.findMany({
                where: { location: data.city, company_id: companyId },
                select: { pm_id: true }
            });
            if (assignments.length === 1) {
                finalPmId = assignments[0].pm_id;
            }
            else if (assignments.length > 1) {
                // Tiebreaker: lowest PENDING_VERIFICATION load
                const pmIds = assignments.map((a) => a.pm_id);
                const loads = await p.property.groupBy({
                    by: ['assigned_pm_id'],
                    where: { assigned_pm_id: { in: pmIds }, status: 'PENDING_VERIFICATION' },
                    _count: { assigned_pm_id: true }
                });
                // Initialize all PMs with 0 load
                const loadMap = new Map();
                pmIds.forEach((id) => loadMap.set(id, 0));
                loads.forEach((l) => {
                    if (l.assigned_pm_id !== null) {
                        loadMap.set(l.assigned_pm_id, l._count.assigned_pm_id);
                    }
                });
                let minLoad = Infinity;
                let selectedPmId = pmIds[0];
                for (const [id, count] of loadMap.entries()) {
                    if (count < minLoad) {
                        minLoad = count;
                        selectedPmId = id;
                    }
                }
                finalPmId = selectedPmId;
            }
        }
        return await p.$transaction(async (tx) => {
            const baseSlug = (0, slugify_1.slugify)(`${data.title} ${data.location} ${data.category}`);
            const slug = await (0, slugify_1.generateUniqueSlug)(baseSlug, companyId, async (s, cId) => {
                const existing = await tx.property.findFirst({ where: { slug: s, company_id: cId } });
                return !!existing;
            });
            const property = await tx.property.create({
                data: {
                    property_code: propertyCode,
                    company_id: companyId,
                    branch_id: branchId,
                    title: data.title,
                    description: data.description || null,
                    brand_type: data.brand_type,
                    category: data.category,
                    area_sqft: data.area_sqft,
                    location: data.location,
                    address: data.address || null,
                    bedrooms: data.bedrooms ? Number(data.bedrooms) : null,
                    bathrooms: data.bathrooms ? Number(data.bathrooms) : null,
                    // Intentionally nullable (requirement: standalone properties are never
                    // implicitly forced into a project) — do not default this to a project.
                    project_id: data.project_id || null,
                    facing: data.facing || null,
                    amenities: data.amenities || null,
                    possession_status: data.possession_status || null,
                    pricing: data.pricing ? { create: data.pricing } : undefined,
                    plot_details: data.plot_details ? { create: data.plot_details } : undefined,
                    apartment_details: data.apartment_details ? { create: data.apartment_details } : undefined,
                    villa_details: data.villa_details ? { create: data.villa_details } : undefined,
                    house_details: data.house_details ? { create: data.house_details } : undefined,
                    commercial_shop_details: data.commercial_shop_details ? { create: data.commercial_shop_details } : undefined,
                    commercial_office_details: data.commercial_office_details ? { create: data.commercial_office_details } : undefined,
                    farm_land_details: data.farm_land_details ? { create: data.farm_land_details } : undefined,
                    assigned_pm_id: finalPmId,
                    status: 'PENDING_VERIFICATION',
                    created_by_id: employeeId,
                    ...resolvePropertyPricingFields(data),
                    // WR-2: Structured location fields
                    state: data.state || null,
                    city: data.city || null,
                    locality: data.locality || null,
                    pincode: data.pincode || null,
                    latitude: data.latitude != null ? Number(data.latitude) : null,
                    longitude: data.longitude != null ? Number(data.longitude) : null,
                    listing_type: data.listing_type || 'NEW',
                    source: data.source || 'INTERNAL',
                    // WR-6: SEO slug
                    slug,
                },
            });
            await tx.propertyVerificationLog.create({
                data: {
                    property_id: property.id,
                    actor_id: employeeId,
                    from_status: 'DRAFT',
                    to_status: 'PENDING_VERIFICATION',
                    notes: `Property ${propertyCode} submitted. Assigned to PM ID ${finalPmId || 'Queue'} for On-Site Verification.`,
                },
            });
            if (!finalPmId) {
                const mdEmployees = await tx.employee.findMany({
                    where: {
                        company_id: companyId,
                        status: 'ACTIVE',
                        roles: {
                            some: {
                                role: {
                                    name: shared_1.Roles.MD
                                }
                            }
                        }
                    },
                    select: { id: true }
                });
                if (mdEmployees.length > 0) {
                    await tx.notification.createMany({
                        data: mdEmployees.map((md) => ({
                            employee_id: md.id,
                            type: 'SYSTEM_ALERT',
                            title: 'Property Requires PM Assignment',
                            message: `Property ${propertyCode} (${data.title}) was created without an assigned PM. Location: ${data.city || 'Unknown'}`
                        }))
                    });
                }
            }
            return property;
        }).then(async (property) => {
            // Outside the create transaction, same as ProjectUnitService.createUnit:
            // manual lines + the initial price computation both do their own reads
            // and writes, and recalculateProperty already wraps its own in a
            // transaction — nesting it inside the create transaction above buys
            // nothing and only holds that transaction open longer.
            if (data.manual_lines?.length) {
                await replaceManualPriceLines(property.id, data.manual_lines);
            }
            await pricing_service_1.PricingService.recalculateProperty(property.id);
            // Re-fetch with the full include set (category details, images, price
            // lines, ...) rather than returning recalculateProperty's bare row —
            // the caller (PropertyForm.tsx) needs the just-created category detail
            // record back to render immediately, not just the updated price fields.
            return this.getProperty(user, property.id);
        });
    }
    static async updateProperty(user, propertyId, data) {
        if (!(0, authorization_1.can)(user, shared_2.Permissions.PROPERTIES_UPDATE)) {
            throw { status: 403, message: 'Forbidden: Missing properties.update permission' };
        }
        const companyId = user.companyId || 1;
        // Validate that the property exists and belongs to the allowed scope
        const whereCondition = await (0, dataScope_1.buildPropertyScope)(user);
        const property = await p.property.findFirst({
            where: {
                id: propertyId,
                ...whereCondition,
            },
            // Needed below to decide upsert vs delete vs no-op on the legacy 1:1
            // sub-records — PropertyForm.tsx (Rebuild Phase 5) sends the whole
            // fetched property back on every save (like ProjectWizard.tsx does),
            // which means `pricing: null` arrives even when no PropertyPricing row
            // was ever created; `{ delete: true }` against a relation that was
            // never there throws (Prisma P2025), so this must be conditional on
            // the row actually existing.
            select: {
                id: true, status: true, assigned_pm_id: true,
                pricing: { select: { property_id: true } },
                plot_details: { select: { property_id: true } },
                apartment_details: { select: { property_id: true } },
                villa_details: { select: { property_id: true } },
                house_details: { select: { property_id: true } },
                commercial_shop_details: { select: { property_id: true } },
                commercial_office_details: { select: { property_id: true } },
                farm_land_details: { select: { property_id: true } },
            },
        });
        if (!property)
            throw { status: 404, message: 'Property not found or unauthorized' };
        // Validate project_id cross-company reference if provided
        if (data.project_id) {
            const project = await p.project.findFirst({
                where: { id: data.project_id, company_id: companyId }
            });
            if (!project)
                throw { status: 400, message: 'Invalid or unauthorized project reference' };
        }
        if (data.assigned_pm_id && data.assigned_pm_id !== property.assigned_pm_id) {
            const pm = await p.employee.findFirst({
                where: { id: data.assigned_pm_id, company_id: companyId }
            });
            if (!pm)
                throw { status: 400, message: 'Invalid assigned_pm_id or does not belong to your company' };
        }
        // Explicitly exclude workflow fields
        const safeData = {};
        const safeKeys = [
            'title', 'description', 'brand_type', 'category', 'area_sqft',
            'location', 'address', 'bedrooms', 'bathrooms', 'facing', 'amenities',
            'possession_status', 'assigned_pm_id', 'project_id',
            // WR-2: Structured location fields
            'state', 'city', 'locality', 'pincode', 'latitude', 'longitude', 'listing_type'
        ];
        for (const key of safeKeys) {
            if (data[key] !== undefined) {
                if (key === 'bedrooms' || key === 'bathrooms') {
                    safeData[key] = data[key] ? Number(data[key]) : null;
                }
                else if (key === 'latitude' || key === 'longitude') {
                    safeData[key] = data[key] != null ? Number(data[key]) : null;
                }
                else {
                    safeData[key] = data[key];
                }
            }
        }
        Object.assign(safeData, resolvePropertyPricingFields(data));
        const updatedProperty = await p.property.update({
            where: { id: propertyId },
            data: {
                ...safeData,
                // Only ever issue `delete` when the row is actually there — sending
                // `pricing: null` to clear a sub-record that was never created (e.g.
                // PropertyForm.tsx submits the whole fetched property, including
                // whichever of these came back null) must be a harmless no-op, not a
                // Prisma P2025 "record to delete does not exist" crash.
                ...subRecordUpdate('pricing', data.pricing, property.pricing),
                ...subRecordUpdate('plot_details', data.plot_details, property.plot_details),
                ...subRecordUpdate('apartment_details', data.apartment_details, property.apartment_details),
                ...subRecordUpdate('villa_details', data.villa_details, property.villa_details),
                ...subRecordUpdate('house_details', data.house_details, property.house_details),
                ...subRecordUpdate('commercial_shop_details', data.commercial_shop_details, property.commercial_shop_details),
                ...subRecordUpdate('commercial_office_details', data.commercial_office_details, property.commercial_office_details),
                ...subRecordUpdate('farm_land_details', data.farm_land_details, property.farm_land_details),
            },
        });
        if (updatedProperty.status === 'LIVE') {
            Promise.resolve().then(() => __importStar(require('./lead.service'))).then(({ LeadService }) => {
                LeadService.triggerLeadRecoveryForProperty(updatedProperty.id).catch(err => logger_1.logger.error(`Error triggering lead recovery for property ${updatedProperty.id}:`, err));
            });
        }
        if (data.manual_lines !== undefined) {
            await replaceManualPriceLines(propertyId, data.manual_lines || []);
        }
        // Every update recomputes price, same invariant as
        // ProjectUnitService.updateUnit — a field affecting price (area, facing,
        // base_rate, discount, manual lines) must never leave calculated_price
        // stale relative to what actually produced it.
        await pricing_service_1.PricingService.recalculateProperty(propertyId);
        // Re-fetch with the full include set — see createProperty's matching comment.
        return this.getProperty(user, propertyId);
    }
    static async verifyProperty(user, propertyId, data) {
        const property = await p.property.findFirst({
            where: { id: propertyId, company_id: user.companyId },
            include: {
                // Only count photos uploaded by THIS PM — seller-submitted or third-party photos
                // do not satisfy the "PM took on-site pictures" requirement.
                images: {
                    where: { uploaded_by_id: user.employeeId },
                    select: { id: true },
                },
            },
        });
        if (!property)
            throw { status: 404, message: 'Property not found' };
        if (!(0, authorization_1.can)(user, shared_2.Permissions.PROPERTIES_VERIFY, property)) {
            throw { status: 403, message: 'Forbidden: Insufficient permissions or out of scope' };
        }
        const transition = workflowEngine_1.WorkflowEngine.canTransition({
            domain: types_1.WorkflowDomain.PROPERTY,
            currentState: property.status,
            action: 'VERIFY',
            actor: user,
            entity: property,
        });
        if (!transition.allowed) {
            throw { status: 409, message: transition.reason || 'Invalid state transition' };
        }
        // Pre-conditions apply only on the APPROVE path — rejection has no requirements
        if (data.approved) {
            if (property.images.length === 0) {
                throw {
                    status: 400,
                    message: 'Cannot approve: at least one photo uploaded by you (the assigned PM) is required before verification.',
                };
            }
            if (!property.location_confirmed_by_pm) {
                throw {
                    status: 400,
                    message: 'Cannot approve: PM must confirm location details on-site before verification (use the Confirm Location action).',
                };
            }
        }
        const nextStatus = data.approved ? 'PENDING_DM_POLISH' : 'REJECTED';
        return await p.$transaction(async (tx) => {
            const updated = await tx.property.update({
                where: { id: propertyId },
                data: {
                    status: nextStatus,
                    verified_by_pm_at: data.approved ? new Date() : null,
                    rejection_reason: data.approved ? null : data.notes,
                },
            });
            await tx.propertyVerificationLog.create({
                data: {
                    property_id: propertyId,
                    actor_id: user.employeeId || 1,
                    from_status: property.status,
                    to_status: nextStatus,
                    notes: `PM On-Site Verification: ${data.approved ? 'PASSED' : 'REJECTED'}. Notes: ${data.notes}`,
                },
            });
            return updated;
        });
    }
    /**
     * PM explicitly confirms that location details (city, locality, lat/lng) match
     * what was observed on-site. This is a prerequisite for verifyProperty to succeed.
     * Requires PROPERTIES_VERIFY permission — same gate as the verify action itself.
     */
    static async confirmLocationByPM(user, propertyId) {
        const property = await p.property.findFirst({ where: { id: propertyId, company_id: user.companyId } });
        if (!property)
            throw { status: 404, message: 'Property not found' };
        if (!(0, authorization_1.can)(user, shared_2.Permissions.PROPERTIES_VERIFY, property)) {
            throw { status: 403, message: 'Forbidden: Only the assigned PM (or MD/Admin) can confirm location for this property' };
        }
        if (property.status !== 'PENDING_VERIFICATION') {
            throw { status: 409, message: 'Location confirmation is only applicable while the property is in PENDING_VERIFICATION status' };
        }
        return await p.property.update({
            where: { id: propertyId },
            data: { location_confirmed_by_pm: true },
            select: { id: true, property_code: true, location_confirmed_by_pm: true },
        });
    }
    /**
     * Phase 2.6: REJECTED was previously a dead end — nothing in the codebase
     * could move a property out of it. Lets the assigned PM (same gate as
     * verifyProperty) fix whatever caused the rejection (at either the PM
     * verification step or the MD approval step — both land here) and put the
     * listing back at the start of the pipeline. Existing images and
     * `location_confirmed_by_pm` are left untouched — the PM only needs to redo
     * whatever was actually wrong, and can call /verify immediately if nothing
     * about the physical listing changed. `rejection_reason` is cleared on
     * resubmission (same as the approve paths already clear it) since the full
     * before/after is preserved permanently in `PropertyVerificationLog`, not
     * lost — and confirmed product decision (2026-09-06): notify every MD in the
     * company, since the schema has no "who rejected it" field to target one.
     */
    static async resubmitProperty(user, propertyId, data) {
        const property = await p.property.findFirst({ where: { id: propertyId, company_id: user.companyId } });
        if (!property)
            throw { status: 404, message: 'Property not found' };
        if (!(0, authorization_1.can)(user, shared_2.Permissions.PROPERTIES_VERIFY, property)) {
            throw { status: 403, message: 'Forbidden: Insufficient permissions or out of scope' };
        }
        const transition = workflowEngine_1.WorkflowEngine.canTransition({
            domain: types_1.WorkflowDomain.PROPERTY,
            currentState: property.status,
            action: 'RESUBMIT',
            actor: user,
            entity: property,
        });
        if (!transition.allowed) {
            throw { status: 409, message: transition.reason || 'Invalid state transition' };
        }
        return await p.$transaction(async (tx) => {
            const updated = await tx.property.update({
                where: { id: propertyId },
                data: {
                    status: 'PENDING_VERIFICATION',
                    rejection_reason: null,
                },
            });
            await tx.propertyVerificationLog.create({
                data: {
                    property_id: propertyId,
                    actor_id: user.employeeId || 1,
                    from_status: 'REJECTED',
                    to_status: 'PENDING_VERIFICATION',
                    notes: `Resubmitted by PM.${property.rejection_reason ? ` Original rejection reason: ${property.rejection_reason}.` : ''}${data.notes ? ` PM notes: ${data.notes}` : ''}`,
                },
            });
            const mdEmployees = await tx.employee.findMany({
                where: { company_id: user.companyId, status: 'ACTIVE', roles: { some: { role: { name: shared_1.Roles.MD } } } },
                select: { id: true },
            });
            if (mdEmployees.length > 0) {
                await tx.notification.createMany({
                    data: mdEmployees.map((md) => ({
                        employee_id: md.id,
                        type: 'SYSTEM_ALERT',
                        title: 'Property Resubmitted for Review',
                        message: `Property ${property.property_code} (${property.title}) was resubmitted after rejection and is back in the verification pipeline.`,
                    })),
                });
            }
            return updated;
        });
    }
    static async dmPolishProperty(user, propertyId, data) {
        const property = await p.property.findFirst({ where: { id: propertyId, company_id: user.companyId } });
        if (!property)
            throw { status: 404, message: 'Property not found' };
        if (!(0, authorization_1.can)(user, shared_2.Permissions.PROPERTIES_DM_POLISH, property)) {
            throw { status: 403, message: 'Forbidden: Insufficient permissions or out of scope' };
        }
        const transition = workflowEngine_1.WorkflowEngine.canTransition({
            domain: types_1.WorkflowDomain.PROPERTY,
            currentState: property.status,
            action: 'DM_POLISH',
            actor: user,
            entity: property,
        });
        if (!transition.allowed) {
            throw { status: 409, message: transition.reason || 'Invalid state transition' };
        }
        return await p.$transaction(async (tx) => {
            const updated = await tx.property.update({
                where: { id: propertyId },
                data: {
                    status: 'PENDING_MD_APPROVAL',
                    seo_title: data.seo_title || property.seo_title,
                    seo_keywords: data.seo_keywords || property.seo_keywords,
                    description: data.description || property.description,
                    digital_marketing_executive_id: data.digital_marketing_executive_id,
                    dm_polished_at: new Date(),
                },
            });
            await tx.propertyVerificationLog.create({
                data: {
                    property_id: propertyId,
                    actor_id: user.employeeId || 1,
                    from_status: property.status,
                    to_status: 'PENDING_MD_APPROVAL',
                    notes: `Digital Marketing Polish Completed. Submitted for MD Final Approval.${data.notes ? ` Notes: ${data.notes}` : ''}`,
                },
            });
            return updated;
        });
    }
    /**
     * DM Head "Verified As-Is" bypass — skips the polish step and advances the property
     * directly to PENDING_MD_APPROVAL without assigning a DM Executive.
     * Requires PROPERTIES_DM_POLISH permission (same gate as the standard polish path).
     */
    static async dmVerifyAsIsProperty(user, propertyId, data) {
        const property = await p.property.findFirst({ where: { id: propertyId, company_id: user.companyId } });
        if (!property)
            throw { status: 404, message: 'Property not found' };
        if (!(0, authorization_1.can)(user, shared_2.Permissions.PROPERTIES_DM_POLISH, property)) {
            throw { status: 403, message: 'Forbidden: Insufficient permissions or out of scope' };
        }
        const transition = workflowEngine_1.WorkflowEngine.canTransition({
            domain: types_1.WorkflowDomain.PROPERTY,
            currentState: property.status,
            action: 'DM_VERIFY_AS_IS',
            actor: user,
            entity: property,
        });
        if (!transition.allowed) {
            throw { status: 409, message: transition.reason || 'Invalid state transition' };
        }
        return await p.$transaction(async (tx) => {
            const updated = await tx.property.update({
                where: { id: propertyId },
                data: {
                    status: 'PENDING_MD_APPROVAL',
                    // Mark dm_polished_at so the audit trail shows a DM Head reviewed it
                    dm_polished_at: new Date(),
                },
            });
            await tx.propertyVerificationLog.create({
                data: {
                    property_id: propertyId,
                    actor_id: user.employeeId || 1,
                    from_status: property.status,
                    to_status: 'PENDING_MD_APPROVAL',
                    notes: `Digital Marketing Head verified property as-is (no polish required). Submitted directly for MD Final Approval.${data.notes ? ` Notes: ${data.notes}` : ''}`,
                },
            });
            return updated;
        });
    }
    static async mdApproveProperty(user, propertyId, data) {
        const property = await p.property.findFirst({ where: { id: propertyId, company_id: user.companyId } });
        if (!property)
            throw { status: 404, message: 'Property not found' };
        if (!(0, authorization_1.can)(user, shared_2.Permissions.PROPERTIES_MD_APPROVE, property)) {
            throw { status: 403, message: 'Forbidden: Insufficient permissions or out of scope' };
        }
        const transition = workflowEngine_1.WorkflowEngine.canTransition({
            domain: types_1.WorkflowDomain.PROPERTY,
            currentState: property.status,
            action: 'MD_APPROVE',
            actor: user,
            entity: property,
        });
        if (!transition.allowed) {
            throw { status: 409, message: transition.reason || 'Invalid state transition' };
        }
        const nextStatus = data.approved ? 'LIVE' : 'REJECTED';
        const result = await p.$transaction(async (tx) => {
            const updated = await tx.property.update({
                where: { id: propertyId },
                data: {
                    status: nextStatus,
                    md_approved_at: data.approved ? new Date() : null,
                    rejection_reason: data.approved ? null : data.comments,
                },
            });
            await tx.propertyVerificationLog.create({
                data: {
                    property_id: propertyId,
                    actor_id: user.employeeId || 1,
                    from_status: property.status,
                    to_status: nextStatus,
                    notes: `MD Decision: ${data.approved ? 'APPROVED & LIVE' : 'REJECTED'}.${data.comments ? ` Comments: ${data.comments}` : ''}`,
                },
            });
            await tx.auditEvent.create({
                data: {
                    actor_id: user.employeeId || 1,
                    action: data.approved ? 'PROPERTY_MD_APPROVED_LIVE' : 'PROPERTY_MD_REJECTED',
                    entity_type: 'PROPERTY',
                    entity_id: propertyId,
                    old_value: JSON.stringify({ status: property.status }),
                    new_value: JSON.stringify({ status: nextStatus, comments: data.comments }),
                },
            });
            return updated;
        });
        if (result.status === 'LIVE') {
            Promise.resolve().then(() => __importStar(require('./lead.service'))).then(({ LeadService }) => {
                LeadService.triggerLeadRecoveryForProperty(result.id).catch(err => logger_1.logger.error(`Error triggering lead recovery for property ${result.id}:`, err));
            });
        }
        return result;
    }
    /** § Phase 3: mirrors ProjectUnitService.overridePrice — lets a PM/MD set a
     * final selling price that wins over the computed one (e.g. a negotiated
     * one-off), with a required reason and a full audit trail. Clearing the
     * override (null) reverts to whatever the engine computes. */
    static async overridePrice(user, propertyId, overridePrice, reason) {
        const property = await p.property.findFirst({ where: { id: propertyId, company_id: user.companyId } });
        if (!property)
            throw { status: 404, message: 'Property not found or unauthorized' };
        if (!(0, authorization_1.can)(user, shared_2.Permissions.PROPERTIES_UPDATE, property)) {
            throw { status: 403, message: 'Forbidden: Missing properties.update permission' };
        }
        const oldFinal = property.final_price;
        await p.property.update({
            where: { id: propertyId },
            data: {
                override_price: overridePrice,
                override_reason: overridePrice != null ? reason ?? null : null,
                overridden_by_id: overridePrice != null ? user.employeeId : null,
                overridden_at: overridePrice != null ? new Date() : null,
            },
        });
        const { _computation, ...priced } = await pricing_service_1.PricingService.recalculateProperty(propertyId);
        await p.auditEvent.create({
            data: {
                actor_id: user.employeeId || 1,
                action: 'PRICE_OVERRIDE',
                entity_type: 'PROPERTY',
                entity_id: propertyId,
                old_value: String(oldFinal),
                new_value: String(priced.final_price),
                reason: reason || null,
            },
        });
        return priced;
    }
    static async togglePublication(user, propertyId, companyId, isPublished) {
        if (!(0, authorization_1.can)(user, shared_2.Permissions.PROPERTIES_UPDATE)) {
            throw { status: 403, message: 'Forbidden: Missing properties.update permission' };
        }
        const property = await p.property.findFirst({
            where: { id: propertyId, company_id: user.companyId },
        });
        if (!property)
            throw { status: 404, message: 'Property not found or unauthorized' };
        if (companyId !== user.companyId) {
            throw { status: 403, message: 'Cannot publish to a different company' };
        }
        // § Phase 3: publishing was previously ungated by status — a property
        // stuck in PENDING_VERIFICATION could be marked "published" in the admin
        // UI even though the public site's own status filter would still hide it,
        // which is confusing for staff even if not exploitable. Unpublishing
        // always stays allowed (e.g. to hide a LOCKED/BOOKED/SOLD unit).
        if (isPublished && property.status !== 'LIVE') {
            throw { status: 409, message: 'Only a LIVE property can be published to the website.' };
        }
        const publication = await p.propertyPublication.upsert({
            where: {
                property_id_company_id: { property_id: propertyId, company_id: companyId },
            },
            update: {
                is_published: isPublished,
                published_at: isPublished ? new Date() : null,
            },
            create: {
                property_id: propertyId,
                company_id: companyId,
                is_published: isPublished,
                published_at: isPublished ? new Date() : null,
            },
        });
        return publication;
    }
    static async getPublications(user, propertyId) {
        if (!(0, authorization_1.can)(user, shared_2.Permissions.PROPERTIES_READ)) {
            throw { status: 403, message: 'Forbidden: Missing properties.read permission' };
        }
        const property = await p.property.findFirst({
            where: { id: propertyId, company_id: user.companyId },
        });
        if (!property)
            throw { status: 404, message: 'Property not found or unauthorized' };
        return await p.propertyPublication.findMany({
            where: { property_id: propertyId },
            include: { company: { select: { id: true, name: true, code: true } } },
        });
    }
    static async reassignProperty(user, propertyId, newPmId, reason) {
        if (!reason || reason.trim() === '') {
            throw { status: 400, message: 'Reassignment reason is mandatory' };
        }
        // Scoped the same way the route's own resource check does (buildPropertyScope),
        // not a flat company_id match — an ADMIN (or anyone granted cross-company
        // access) can legitimately reassign a property outside their own JWT "home"
        // company, matching ProjectService.reassignProject's equivalent fix.
        const whereCondition = await (0, dataScope_1.buildPropertyScope)(user);
        const property = await p.property.findFirst({ where: { id: propertyId, ...whereCondition } });
        if (!property)
            throw { status: 404, message: 'Property not found or unauthorized' };
        if (!(0, authorization_1.can)(user, shared_2.Permissions.PROPERTIES_UPDATE, property)) {
            throw { status: 403, message: 'Forbidden: Missing permission to reassign property' };
        }
        // New PM must belong to the PROPERTY's own company, not necessarily the
        // acting user's — same reasoning as reassignProject.
        const newPm = await p.employee.findFirst({
            where: { id: newPmId, company_id: property.company_id, status: 'ACTIVE' }
        });
        if (!newPm)
            throw { status: 400, message: 'New assignee not found or unauthorized' };
        const oldPmId = property.assigned_pm_id;
        return await p.$transaction(async (tx) => {
            const updated = await tx.property.update({
                where: { id: propertyId },
                data: { assigned_pm_id: newPmId }
            });
            await tx.auditEvent.create({
                data: {
                    actor_id: user.employeeId,
                    action: 'REASSIGNMENT',
                    entity_type: 'PROPERTY',
                    entity_id: propertyId,
                    old_value: oldPmId ? oldPmId.toString() : 'UNASSIGNED',
                    new_value: newPmId.toString(),
                    reason: reason
                }
            });
            return updated;
        });
    }
}
exports.PropertyService = PropertyService;
