"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PricePreviewSchema = exports.AddUnitFeatureSchema = exports.ProjectPricingRuleUpdateSchema = exports.ProjectPricingRuleCreateSchema = exports.OverrideUnitPriceSchema = exports.ChangeUnitStatusSchema = exports.ProjectUnitBulkCreateSchema = exports.ProjectUnitUpdateSchema = exports.ProjectUnitCreateSchema = exports.ChargeCategoryEnum = exports.PricingRuleKindEnum = exports.ChargeCalcMethodEnum = exports.SalesStatusEnum = exports.PriceBasisEnum = exports.AreaUnitEnum = exports.UnitTypeEnum = void 0;
const zod_1 = require("zod");
// Project Unit & Pricing Rule schemas.
//
// A ProjectUnit is internally-authored inventory (spec: "ProjectUnit != Property")
// so, unlike PropertyCreateSchema, there is no address/location here at all — a
// unit always inherits its project's address. See services/projectUnit.service.ts.
exports.UnitTypeEnum = zod_1.z.enum(['PLOT', 'FLAT', 'VILLA', 'HOUSE', 'COMMERCIAL', 'OTHER']);
exports.AreaUnitEnum = zod_1.z.enum(['SQFT', 'SQYD', 'SQM', 'ACRE', 'GUNTA', 'CENT', 'ANKANAM', 'HECTARE']);
exports.PriceBasisEnum = zod_1.z.enum(['CARPET', 'BUILT_UP', 'SUPER_BUILT_UP', 'PLOT_AREA', 'LUMPSUM']);
exports.SalesStatusEnum = zod_1.z.enum(['AVAILABLE', 'HOLD', 'RESERVED', 'BOOKED', 'SOLD', 'BLOCKED', 'UNAVAILABLE']);
exports.ChargeCalcMethodEnum = zod_1.z.enum(['FIXED', 'PER_SQFT', 'PER_SQYD', 'PERCENT_OF_BASE', 'QTY_X_RATE']);
exports.PricingRuleKindEnum = zod_1.z.enum(['BASE_RATE', 'PREMIUM', 'CHARGE', 'DISCOUNT', 'TAX']);
exports.ChargeCategoryEnum = zod_1.z.enum([
    'FACING', 'FLOOR', 'CORNER', 'ROAD', 'PARK', 'VIEW', 'BHK', 'AMENITY',
    'PARKING', 'INFRA', 'MAINTENANCE', 'LEGAL', 'CLUB', 'TAX', 'OTHER',
]);
exports.ProjectUnitCreateSchema = zod_1.z.object({
    unit_number: zod_1.z.string().min(1, 'Unit number is required'),
    unit_type: exports.UnitTypeEnum,
    plot_number: zod_1.z.string().optional().nullable(),
    survey_number: zod_1.z.string().optional().nullable(),
    tower: zod_1.z.string().optional().nullable(),
    block: zod_1.z.string().optional().nullable(),
    floor: zod_1.z.number().int().optional().nullable(),
    flat_number: zod_1.z.string().optional().nullable(),
    villa_number: zod_1.z.string().optional().nullable(),
    type_code: zod_1.z.string().optional().nullable(),
    bhk: zod_1.z.string().optional().nullable(),
    bedrooms: zod_1.z.number().int().optional().nullable(),
    bathrooms: zod_1.z.number().int().optional().nullable(),
    balconies: zod_1.z.number().int().optional().nullable(),
    living_rooms: zod_1.z.number().int().optional().nullable(),
    kitchens: zod_1.z.number().int().optional().nullable(),
    utility_rooms: zod_1.z.number().int().optional().nullable(),
    has_pooja_room: zod_1.z.boolean().optional(),
    has_study_room: zod_1.z.boolean().optional(),
    // Area — accepts what the user typed (area_value + area_unit); derived
    // sqft/sqyd are computed server-side via shared/measurement.ts, never trusted
    // from the client.
    area_value: zod_1.z.number().positive().optional().nullable(),
    area_unit: exports.AreaUnitEnum.optional().nullable(),
    plot_area_sqyd: zod_1.z.number().positive().optional().nullable(),
    plot_length_ft: zod_1.z.number().positive().optional().nullable(),
    plot_width_ft: zod_1.z.number().positive().optional().nullable(),
    carpet_area_sqft: zod_1.z.number().positive().optional().nullable(),
    built_up_area_sqft: zod_1.z.number().positive().optional().nullable(),
    super_built_up_area_sqft: zod_1.z.number().positive().optional().nullable(),
    ground_floor_area_sqft: zod_1.z.number().positive().optional().nullable(),
    first_floor_area_sqft: zod_1.z.number().positive().optional().nullable(),
    total_floors: zod_1.z.number().int().optional().nullable(),
    price_basis: exports.PriceBasisEnum.optional(),
    facing: zod_1.z.string().optional().nullable(),
    is_corner: zod_1.z.boolean().optional(),
    is_road_facing: zod_1.z.boolean().optional(),
    is_park_facing: zod_1.z.boolean().optional(),
    is_main_road_facing: zod_1.z.boolean().optional(),
    road_width_ft: zod_1.z.number().optional().nullable(),
    view: zod_1.z.string().optional().nullable(),
    parking_included: zod_1.z.boolean().optional(),
    parking_type: zod_1.z.string().optional().nullable(),
    parking_count: zod_1.z.number().int().optional().nullable(),
    parking_slots: zod_1.z.string().optional().nullable(),
    // Pricing inputs — the engine computes everything else server-side.
    base_rate: zod_1.z.number().optional().nullable(),
    base_rate_unit: exports.ChargeCalcMethodEnum.optional().nullable(),
    base_price_override: zod_1.z.number().optional().nullable(),
    discount_amount: zod_1.z.number().optional().nullable(),
    discount_reason: zod_1.z.string().optional().nullable(),
    manual_lines: zod_1.z
        .array(zod_1.z.object({ label: zod_1.z.string().min(1), category: exports.ChargeCategoryEnum.optional(), amount: zod_1.z.number() }))
        .optional(),
    selected_optional_rule_ids: zod_1.z.array(zod_1.z.number().int()).optional(),
    sales_status: exports.SalesStatusEnum.optional(),
    notes: zod_1.z.string().optional().nullable(),
});
exports.ProjectUnitUpdateSchema = exports.ProjectUnitCreateSchema.partial();
// Bulk generation — the "Generate many" mode. `common` seeds shared defaults;
// each row in `units` may override anything the common block sets.
exports.ProjectUnitBulkCreateSchema = zod_1.z.object({
    common: exports.ProjectUnitCreateSchema.partial().optional(),
    units: zod_1.z
        .array(exports.ProjectUnitCreateSchema.partial().extend({ unit_number: zod_1.z.string().min(1) }))
        .min(1, 'At least one unit is required')
        .max(500, 'Cannot create more than 500 units in a single request'),
});
exports.ChangeUnitStatusSchema = zod_1.z.object({
    sales_status: exports.SalesStatusEnum,
    reason: zod_1.z.string().optional(),
});
exports.OverrideUnitPriceSchema = zod_1.z.object({
    override_price: zod_1.z.number().positive().nullable(),
    override_reason: zod_1.z.string().min(3, 'A reason is required when overriding the calculated price').optional().nullable(),
}).refine((data) => data.override_price === null || !!data.override_reason, {
    message: 'A reason is required when setting an override price',
    path: ['override_reason'],
});
// --- Pricing rules ---------------------------------------------------------
exports.ProjectPricingRuleCreateSchema = zod_1.z.object({
    label: zod_1.z.string().min(1),
    kind: exports.PricingRuleKindEnum,
    category: exports.ChargeCategoryEnum,
    calc_method: exports.ChargeCalcMethodEnum,
    rate: zod_1.z.number(),
    area_basis: exports.PriceBasisEnum.optional().nullable(),
    applies_to_unit_type: exports.UnitTypeEnum.optional().nullable(),
    is_mandatory: zod_1.z.boolean().optional(),
    is_tax: zod_1.z.boolean().optional(),
    is_refundable: zod_1.z.boolean().optional(),
    is_active: zod_1.z.boolean().optional(),
    sort_order: zod_1.z.number().int().optional(),
    match_facing: zod_1.z.string().optional().nullable(),
    match_corner: zod_1.z.boolean().optional().nullable(),
    match_park_facing: zod_1.z.boolean().optional().nullable(),
    match_road_facing: zod_1.z.boolean().optional().nullable(),
    match_main_road_facing: zod_1.z.boolean().optional().nullable(),
    match_floor_min: zod_1.z.number().int().optional().nullable(),
    match_floor_max: zod_1.z.number().int().optional().nullable(),
    match_bhk: zod_1.z.string().optional().nullable(),
    match_type_code: zod_1.z.string().optional().nullable(),
    match_view: zod_1.z.string().optional().nullable(),
});
exports.ProjectPricingRuleUpdateSchema = exports.ProjectPricingRuleCreateSchema.partial();
exports.AddUnitFeatureSchema = zod_1.z.object({
    label: zod_1.z.string().min(1, 'Label is required'),
    charge_amount: zod_1.z.number().positive().optional().nullable(),
});
/** Body for the price-preview endpoint — a unit's shape without it needing to exist yet. */
exports.PricePreviewSchema = exports.ProjectUnitCreateSchema.partial().extend({
    unit_type: exports.UnitTypeEnum,
});
