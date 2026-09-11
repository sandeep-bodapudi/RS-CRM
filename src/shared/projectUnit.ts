import { z } from 'zod';

// Project Unit & Pricing Rule schemas.
//
// A ProjectUnit is internally-authored inventory (spec: "ProjectUnit != Property")
// so, unlike PropertyCreateSchema, there is no address/location here at all — a
// unit always inherits its project's address. See services/projectUnit.service.ts.

export const UnitTypeEnum = z.enum(['PLOT', 'FLAT', 'VILLA', 'HOUSE', 'COMMERCIAL', 'OTHER']);
export const AreaUnitEnum = z.enum([
  'SQFT',
  'SQYD',
  'SQM',
  'ACRE',
  'GUNTA',
  'CENT',
  'ANKANAM',
  'HECTARE',
]);
export const PriceBasisEnum = z.enum([
  'CARPET',
  'BUILT_UP',
  'SUPER_BUILT_UP',
  'PLOT_AREA',
  'LUMPSUM',
]);
export const SalesStatusEnum = z.enum([
  'AVAILABLE',
  'HOLD',
  'RESERVED',
  'BOOKED',
  'SOLD',
  'BLOCKED',
  'UNAVAILABLE',
]);
export const ChargeCalcMethodEnum = z.enum([
  'FIXED',
  'PER_SQFT',
  'PER_SQYD',
  'PERCENT_OF_BASE',
  'QTY_X_RATE',
]);
export const PricingRuleKindEnum = z.enum(['BASE_RATE', 'PREMIUM', 'CHARGE', 'DISCOUNT', 'TAX']);
export const ChargeCategoryEnum = z.enum([
  'FACING',
  'FLOOR',
  'CORNER',
  'ROAD',
  'PARK',
  'VIEW',
  'BHK',
  'AMENITY',
  'PARKING',
  'INFRA',
  'MAINTENANCE',
  'LEGAL',
  'CLUB',
  'TAX',
  'OTHER',
]);

export const ProjectUnitCreateSchema = z.object({
  unit_number: z.string().min(1, 'Unit number is required'),
  unit_type: UnitTypeEnum,
  plot_number: z.string().optional().nullable(),
  survey_number: z.string().optional().nullable(),
  tower: z.string().optional().nullable(),
  block: z.string().optional().nullable(),
  floor: z.number().int().optional().nullable(),
  flat_number: z.string().optional().nullable(),
  villa_number: z.string().optional().nullable(),
  type_code: z.string().optional().nullable(),

  bhk: z.string().optional().nullable(),
  bedrooms: z.number().int().optional().nullable(),
  bathrooms: z.number().int().optional().nullable(),
  balconies: z.number().int().optional().nullable(),
  living_rooms: z.number().int().optional().nullable(),
  kitchens: z.number().int().optional().nullable(),
  utility_rooms: z.number().int().optional().nullable(),
  has_pooja_room: z.boolean().optional(),
  has_study_room: z.boolean().optional(),

  // Area — accepts what the user typed (area_value + area_unit); derived
  // sqft/sqyd are computed server-side via shared/measurement.ts, never trusted
  // from the client.
  area_value: z.number().positive().optional().nullable(),
  area_unit: AreaUnitEnum.optional().nullable(),

  plot_area_sqyd: z.number().positive().optional().nullable(),
  plot_length_ft: z.number().positive().optional().nullable(),
  plot_width_ft: z.number().positive().optional().nullable(),

  carpet_area_sqft: z.number().positive().optional().nullable(),
  built_up_area_sqft: z.number().positive().optional().nullable(),
  super_built_up_area_sqft: z.number().positive().optional().nullable(),
  ground_floor_area_sqft: z.number().positive().optional().nullable(),
  first_floor_area_sqft: z.number().positive().optional().nullable(),
  total_floors: z.number().int().optional().nullable(),

  price_basis: PriceBasisEnum.optional(),

  facing: z.string().optional().nullable(),
  is_corner: z.boolean().optional(),
  is_road_facing: z.boolean().optional(),
  is_park_facing: z.boolean().optional(),
  is_main_road_facing: z.boolean().optional(),
  road_width_ft: z.number().optional().nullable(),
  view: z.string().optional().nullable(),

  parking_included: z.boolean().optional(),
  parking_type: z.string().optional().nullable(),
  parking_count: z.number().int().optional().nullable(),
  parking_slots: z.string().optional().nullable(),

  // Pricing inputs — the engine computes everything else server-side.
  base_rate: z.number().optional().nullable(),
  base_rate_unit: ChargeCalcMethodEnum.optional().nullable(),
  base_price_override: z.number().optional().nullable(),
  discount_amount: z.number().optional().nullable(),
  discount_reason: z.string().optional().nullable(),
  manual_lines: z
    .array(
      z.object({
        label: z.string().min(1),
        category: ChargeCategoryEnum.optional(),
        amount: z.number(),
      }),
    )
    .optional(),
  selected_optional_rule_ids: z.array(z.number().int()).optional(),

  sales_status: SalesStatusEnum.optional(),
  notes: z.string().optional().nullable(),
});
export type ProjectUnitCreateInput = z.infer<typeof ProjectUnitCreateSchema>;

export const ProjectUnitUpdateSchema = ProjectUnitCreateSchema.partial();
export type ProjectUnitUpdateInput = z.infer<typeof ProjectUnitUpdateSchema>;

// Bulk generation — the "Generate many" mode. `common` seeds shared defaults;
// each row in `units` may override anything the common block sets.
export const ProjectUnitBulkCreateSchema = z.object({
  common: ProjectUnitCreateSchema.partial().optional(),
  units: z
    .array(ProjectUnitCreateSchema.partial().extend({ unit_number: z.string().min(1) }))
    .min(1, 'At least one unit is required')
    .max(500, 'Cannot create more than 500 units in a single request'),
});
export type ProjectUnitBulkCreateInput = z.infer<typeof ProjectUnitBulkCreateSchema>;

export const ChangeUnitStatusSchema = z.object({
  sales_status: SalesStatusEnum,
  reason: z.string().optional(),
});

export const OverrideUnitPriceSchema = z
  .object({
    override_price: z.number().positive().nullable(),
    override_reason: z
      .string()
      .min(3, 'A reason is required when overriding the calculated price')
      .optional()
      .nullable(),
  })
  .refine((data) => data.override_price === null || !!data.override_reason, {
    message: 'A reason is required when setting an override price',
    path: ['override_reason'],
  });

// --- Pricing rules ---------------------------------------------------------

export const ProjectPricingRuleCreateSchema = z.object({
  label: z.string().min(1),
  kind: PricingRuleKindEnum,
  category: ChargeCategoryEnum,
  calc_method: ChargeCalcMethodEnum,
  rate: z.number(),
  area_basis: PriceBasisEnum.optional().nullable(),
  applies_to_unit_type: UnitTypeEnum.optional().nullable(),

  is_mandatory: z.boolean().optional(),
  is_tax: z.boolean().optional(),
  is_refundable: z.boolean().optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),

  match_facing: z.string().optional().nullable(),
  match_corner: z.boolean().optional().nullable(),
  match_park_facing: z.boolean().optional().nullable(),
  match_road_facing: z.boolean().optional().nullable(),
  match_main_road_facing: z.boolean().optional().nullable(),
  match_floor_min: z.number().int().optional().nullable(),
  match_floor_max: z.number().int().optional().nullable(),
  match_bhk: z.string().optional().nullable(),
  match_type_code: z.string().optional().nullable(),
  match_view: z.string().optional().nullable(),
});
export type ProjectPricingRuleCreateInput = z.infer<typeof ProjectPricingRuleCreateSchema>;

export const ProjectPricingRuleUpdateSchema = ProjectPricingRuleCreateSchema.partial();
export type ProjectPricingRuleUpdateInput = z.infer<typeof ProjectPricingRuleUpdateSchema>;

export const AddUnitFeatureSchema = z.object({
  label: z.string().min(1, 'Label is required'),
  charge_amount: z.number().positive().optional().nullable(),
});
export type AddUnitFeatureInput = z.infer<typeof AddUnitFeatureSchema>;

/** Body for the price-preview endpoint — a unit's shape without it needing to exist yet. */
export const PricePreviewSchema = ProjectUnitCreateSchema.partial().extend({
  unit_type: UnitTypeEnum,
});
export type PricePreviewInput = z.infer<typeof PricePreviewSchema>;
