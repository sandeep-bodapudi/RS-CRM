import { z } from 'zod';

// Project Constants & Schemas
const ProjectTypeEnum = z.enum(['PLOTTED', 'APARTMENT', 'VILLA', 'MIXED', 'COMMERCIAL']);
const AreaUnitEnum = z.enum(['SQFT', 'SQYD', 'SQM', 'ACRE', 'GUNTA', 'CENT', 'ANKANAM', 'HECTARE']);
const PriceBasisEnum = z.enum(['CARPET', 'BUILT_UP', 'SUPER_BUILT_UP', 'PLOT_AREA', 'LUMPSUM']);

// Common-data fields (Rebuild Phase 2): everything a unit inherits from its
// project rather than re-collecting — see docs/PROJECTS-PROPERTIES-REBUILD-IMPLEMENTATION-PLAN.md.
const ProjectCommonFields = {
  project_type: ProjectTypeEnum.optional().nullable(),
  developer_name: z.string().optional().nullable(),

  // Structured location — Project previously only had a single free-text
  // `location` string; units need a real address to inherit.
  state: z.string().optional().nullable(),
  district: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  mandal: z.string().optional().nullable(),
  village: z.string().optional().nullable(),
  locality: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  pincode: z.string().optional().nullable(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  maps_link: z.string().optional().nullable(),

  total_area_value: z.number().positive().optional().nullable(),
  total_area_unit: AreaUnitEnum.optional().nullable(),
  towers_count: z.number().int().positive().optional().nullable(),
  blocks_count: z.number().int().positive().optional().nullable(),
  floors_count: z.number().int().positive().optional().nullable(),
  completion_date: z.string().optional().nullable(),

  rera_status: z.enum(['NOT_APPLICABLE', 'APPLIED', 'APPROVED']).optional().nullable(),
  approval_authority: z.enum(['RERA', 'DTCP', 'HMDA', 'PANCHAYAT']).optional().nullable(),
  approval_number: z.string().optional().nullable(),
  lp_number: z.string().optional().nullable(),

  default_price_basis: PriceBasisEnum.optional().nullable(),
  default_area_unit: AreaUnitEnum.optional().nullable(),
  cover_image_url: z.string().optional().nullable(),
};

export const ProjectCreateSchema = z.object({
  name: z.string().min(3),
  description: z.string().optional().nullable(),
  location: z.string().min(3),
  total_area: z.string().optional().nullable(),
  total_units: z.number().int().positive().optional().nullable(),
  // .nullable() throughout: ProjectWizard.tsx (Rebuild Phase 2) always sends
  // every optional field's key, as either a real value or explicit `null`
  // (never omitted) — one incremental PUT per wizard step, each clearing
  // whatever that step's fields don't have. Plain .optional() rejects `null`,
  // 400ing on every step submitted with a field left blank (Phase 2.5 first
  // found this for launch_date; the same fix now applies to every field here).
  launch_date: z.string().optional().nullable(),
  project_phase: z.string().optional().nullable(),
  rera_number: z.string().optional().nullable(),
  amenities: z.any().optional(),
  assigned_pm_id: z.number().int().positive().optional().nullable(),
  ...ProjectCommonFields,
});

export type ProjectCreateInput = z.infer<typeof ProjectCreateSchema>;

export const ProjectUpdateSchema = z.object({
  name: z.string().min(3).optional(),
  description: z.string().optional().nullable(),
  location: z.string().min(3).optional(),
  total_area: z.string().optional().nullable(),
  total_units: z.number().int().positive().optional().nullable(),
  launch_date: z.string().optional().nullable(),
  project_phase: z.string().optional().nullable(),
  rera_number: z.string().optional().nullable(),
  amenities: z.any().optional(),
  assigned_pm_id: z.number().int().positive().optional().nullable(),
  status: z.enum(['PLANNING', 'UNDER_CONSTRUCTION', 'COMPLETED', 'CANCELLED']).optional(),
  ...ProjectCommonFields,
});

export type ProjectUpdateInput = z.infer<typeof ProjectUpdateSchema>;

// Phase 2.7: reassigning a project's PM as a distinct, reasoned action
// (mirrors LeadReassignSchema) — separate from the general edit form, which
// already lets assigned_pm_id change freely with no reason/audit trail.
export const ProjectReassignSchema = z.object({
  new_pm_id: z.number().int().positive('New assignee ID is required'),
  reason: z.string().min(3, 'Reassignment reason is required'),
});
export type ProjectReassignInput = z.infer<typeof ProjectReassignSchema>;

// Phase 2.23: bulk upsert of layout-image pin positions.
export const ProjectLayoutRegionsSchema = z.object({
  regions: z
    .array(
      z.object({
        property_id: z.number().int().positive(),
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
      }),
    )
    .min(1, 'At least one region is required'),
});
export type ProjectLayoutRegionsInput = z.infer<typeof ProjectLayoutRegionsSchema>;

export const AddPropertyInterestSchema = z.object({
  property_id: z.number().int().positive(),
});

