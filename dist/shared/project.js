"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AddPropertyInterestSchema = exports.ProjectLayoutRegionsSchema = exports.ProjectReassignSchema = exports.ProjectUpdateSchema = exports.ProjectCreateSchema = void 0;
const zod_1 = require("zod");
// Project Constants & Schemas
const ProjectTypeEnum = zod_1.z.enum(['PLOTTED', 'APARTMENT', 'VILLA', 'MIXED', 'COMMERCIAL']);
const AreaUnitEnum = zod_1.z.enum(['SQFT', 'SQYD', 'SQM', 'ACRE', 'GUNTA', 'CENT', 'ANKANAM', 'HECTARE']);
const PriceBasisEnum = zod_1.z.enum(['CARPET', 'BUILT_UP', 'SUPER_BUILT_UP', 'PLOT_AREA', 'LUMPSUM']);
// Common-data fields (Rebuild Phase 2): everything a unit inherits from its
// project rather than re-collecting — see docs/PROJECTS-PROPERTIES-REBUILD-IMPLEMENTATION-PLAN.md.
const ProjectCommonFields = {
    project_type: ProjectTypeEnum.optional().nullable(),
    developer_name: zod_1.z.string().optional().nullable(),
    // Structured location — Project previously only had a single free-text
    // `location` string; units need a real address to inherit.
    state: zod_1.z.string().optional().nullable(),
    district: zod_1.z.string().optional().nullable(),
    city: zod_1.z.string().optional().nullable(),
    mandal: zod_1.z.string().optional().nullable(),
    village: zod_1.z.string().optional().nullable(),
    locality: zod_1.z.string().optional().nullable(),
    address: zod_1.z.string().optional().nullable(),
    pincode: zod_1.z.string().optional().nullable(),
    latitude: zod_1.z.number().optional().nullable(),
    longitude: zod_1.z.number().optional().nullable(),
    maps_link: zod_1.z.string().optional().nullable(),
    total_area_value: zod_1.z.number().positive().optional().nullable(),
    total_area_unit: AreaUnitEnum.optional().nullable(),
    towers_count: zod_1.z.number().int().positive().optional().nullable(),
    blocks_count: zod_1.z.number().int().positive().optional().nullable(),
    floors_count: zod_1.z.number().int().positive().optional().nullable(),
    completion_date: zod_1.z.string().optional().nullable(),
    rera_status: zod_1.z.enum(['NOT_APPLICABLE', 'APPLIED', 'APPROVED']).optional().nullable(),
    approval_authority: zod_1.z.enum(['RERA', 'DTCP', 'HMDA', 'PANCHAYAT']).optional().nullable(),
    approval_number: zod_1.z.string().optional().nullable(),
    lp_number: zod_1.z.string().optional().nullable(),
    default_price_basis: PriceBasisEnum.optional().nullable(),
    default_area_unit: AreaUnitEnum.optional().nullable(),
    cover_image_url: zod_1.z.string().optional().nullable(),
};
exports.ProjectCreateSchema = zod_1.z.object({
    name: zod_1.z.string().min(3),
    description: zod_1.z.string().optional().nullable(),
    location: zod_1.z.string().min(3),
    total_area: zod_1.z.string().optional().nullable(),
    total_units: zod_1.z.number().int().positive().optional().nullable(),
    // .nullable() throughout: ProjectWizard.tsx (Rebuild Phase 2) always sends
    // every optional field's key, as either a real value or explicit `null`
    // (never omitted) — one incremental PUT per wizard step, each clearing
    // whatever that step's fields don't have. Plain .optional() rejects `null`,
    // 400ing on every step submitted with a field left blank (Phase 2.5 first
    // found this for launch_date; the same fix now applies to every field here).
    launch_date: zod_1.z.string().optional().nullable(),
    project_phase: zod_1.z.string().optional().nullable(),
    rera_number: zod_1.z.string().optional().nullable(),
    amenities: zod_1.z.any().optional(),
    assigned_pm_id: zod_1.z.number().int().positive().optional().nullable(),
    ...ProjectCommonFields,
});
exports.ProjectUpdateSchema = zod_1.z.object({
    name: zod_1.z.string().min(3).optional(),
    description: zod_1.z.string().optional().nullable(),
    location: zod_1.z.string().min(3).optional(),
    total_area: zod_1.z.string().optional().nullable(),
    total_units: zod_1.z.number().int().positive().optional().nullable(),
    launch_date: zod_1.z.string().optional().nullable(),
    project_phase: zod_1.z.string().optional().nullable(),
    rera_number: zod_1.z.string().optional().nullable(),
    amenities: zod_1.z.any().optional(),
    assigned_pm_id: zod_1.z.number().int().positive().optional().nullable(),
    status: zod_1.z.enum(['PLANNING', 'UNDER_CONSTRUCTION', 'COMPLETED', 'CANCELLED']).optional(),
    ...ProjectCommonFields,
});
// Phase 2.7: reassigning a project's PM as a distinct, reasoned action
// (mirrors LeadReassignSchema) — separate from the general edit form, which
// already lets assigned_pm_id change freely with no reason/audit trail.
exports.ProjectReassignSchema = zod_1.z.object({
    new_pm_id: zod_1.z.number().int().positive('New assignee ID is required'),
    reason: zod_1.z.string().min(3, 'Reassignment reason is required'),
});
// Phase 2.23: bulk upsert of layout-image pin positions.
exports.ProjectLayoutRegionsSchema = zod_1.z.object({
    regions: zod_1.z
        .array(zod_1.z.object({
        property_id: zod_1.z.number().int().positive(),
        x: zod_1.z.number().min(0).max(1),
        y: zod_1.z.number().min(0).max(1),
    }))
        .min(1, 'At least one region is required'),
});
exports.AddPropertyInterestSchema = zod_1.z.object({
    property_id: zod_1.z.number().int().positive(),
});
