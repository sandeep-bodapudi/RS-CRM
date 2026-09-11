"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PropertyImageMetadataSchema = exports.PropertyReassignSchema = exports.PropertyTogglePublicationBodySchema = exports.PropertyPublicationSchema = exports.PropertyUpdateSchema = exports.PropertyResubmitSchema = exports.PropertyMDApprovalSchema = exports.PropertyDMVerifyAsIsSchema = exports.PropertyDMUpdateSchema = exports.PropertyVerificationSchema = exports.PropertyCreateSchema = exports.PropertyBrand = exports.PropertyAvailability = exports.PropertyStatus = exports.OverridePropertyPriceSchema = exports.PropertyPricePreviewSchema = exports.PropertyPricingRuleUpdateSchema = exports.PropertyPricingRuleCreateSchema = void 0;
const zod_1 = require("zod");
const projectUnit_1 = require("./projectUnit");
// § Phase 3: a Property's own conditional pricing rules — mirrors
// ProjectPricingRuleCreateSchema, minus applies_to_unit_type (a property
// already has one fixed category) and floor matching (no top-level numeric
// floor field on Property).
exports.PropertyPricingRuleCreateSchema = zod_1.z.object({
    label: zod_1.z.string().min(1),
    kind: projectUnit_1.PricingRuleKindEnum,
    category: projectUnit_1.ChargeCategoryEnum,
    calc_method: projectUnit_1.ChargeCalcMethodEnum,
    rate: zod_1.z.number(),
    area_basis: projectUnit_1.PriceBasisEnum.optional().nullable(),
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
});
exports.PropertyPricingRuleUpdateSchema = exports.PropertyPricingRuleCreateSchema.partial();
/** Body for the property price-preview endpoint. */
exports.PropertyPricePreviewSchema = zod_1.z.object({
    area_value: zod_1.z.number().positive().optional().nullable(),
    area_unit: projectUnit_1.AreaUnitEnum.optional().nullable(),
    plot_area_sqyd: zod_1.z.number().positive().optional().nullable(),
    carpet_area_sqft: zod_1.z.number().positive().optional().nullable(),
    built_up_area_sqft: zod_1.z.number().positive().optional().nullable(),
    super_built_up_area_sqft: zod_1.z.number().positive().optional().nullable(),
    price_basis: projectUnit_1.PriceBasisEnum.optional().nullable(),
    facing: zod_1.z.string().optional().nullable(),
    view: zod_1.z.string().optional().nullable(),
    is_corner: zod_1.z.boolean().optional(),
    is_road_facing: zod_1.z.boolean().optional(),
    is_park_facing: zod_1.z.boolean().optional(),
    is_main_road_facing: zod_1.z.boolean().optional(),
    base_rate: zod_1.z.number().optional().nullable(),
    base_rate_unit: projectUnit_1.ChargeCalcMethodEnum.optional().nullable(),
    discount_amount: zod_1.z.number().optional().nullable(),
    discount_reason: zod_1.z.string().optional().nullable(),
    manual_lines: zod_1.z
        .array(zod_1.z.object({ label: zod_1.z.string().min(1), category: projectUnit_1.ChargeCategoryEnum.optional(), amount: zod_1.z.number() }))
        .optional(),
});
exports.OverridePropertyPriceSchema = zod_1.z.object({
    override_price: zod_1.z.number().positive().nullable(),
    override_reason: zod_1.z.string().min(3, 'A reason is required when overriding the calculated price').optional().nullable(),
}).refine((data) => data.override_price === null || !!data.override_reason, {
    message: 'A reason is required when setting an override price',
    path: ['override_reason'],
});
// Property Constants & Schemas
// Rebuild Phase 5: the flat pricing/area/characteristic columns Phase 1's
// migration added to the Property model (mirroring ProjectUnit, "one form
// serves both") were never actually reachable through this API — Zod strips
// any key not listed in a schema before the service ever sees it. Spread into
// both Create and Update schemas below so PropertyForm.tsx can finally set
// them, same as ProjectCommonFields does for Project/ProjectWizard.
const PropertyPricingFields = {
    area_value: zod_1.z.number().positive().optional().nullable(),
    area_unit: projectUnit_1.AreaUnitEnum.optional().nullable(),
    plot_area_sqyd: zod_1.z.number().positive().optional().nullable(),
    plot_length_ft: zod_1.z.number().positive().optional().nullable(),
    plot_width_ft: zod_1.z.number().positive().optional().nullable(),
    carpet_area_sqft: zod_1.z.number().positive().optional().nullable(),
    built_up_area_sqft: zod_1.z.number().positive().optional().nullable(),
    super_built_up_area_sqft: zod_1.z.number().positive().optional().nullable(),
    ground_floor_area_sqft: zod_1.z.number().positive().optional().nullable(),
    first_floor_area_sqft: zod_1.z.number().positive().optional().nullable(),
    total_floors: zod_1.z.number().int().optional().nullable(),
    construction_year: zod_1.z.number().int().optional().nullable(),
    price_basis: projectUnit_1.PriceBasisEnum.optional(),
    view: zod_1.z.string().optional().nullable(),
    road_width_ft: zod_1.z.number().optional().nullable(),
    is_corner: zod_1.z.boolean().optional(),
    is_park_facing: zod_1.z.boolean().optional(),
    is_road_facing: zod_1.z.boolean().optional(),
    is_main_road_facing: zod_1.z.boolean().optional(),
    is_premium_location: zod_1.z.boolean().optional(),
    base_rate: zod_1.z.number().optional().nullable(),
    base_rate_unit: projectUnit_1.ChargeCalcMethodEnum.optional().nullable(),
    discount_amount: zod_1.z.number().optional().nullable(),
    discount_reason: zod_1.z.string().optional().nullable(),
    manual_lines: zod_1.z
        .array(zod_1.z.object({ label: zod_1.z.string().min(1), category: projectUnit_1.ChargeCategoryEnum.optional(), amount: zod_1.z.number() }))
        .optional(),
};
// Category-specific detail sub-objects (property details.md spec) — one real,
// typed shape per property type instead of every category sharing the same
// generic field set. Each is optional/nullable as a whole (only the category
// matching the property's own `category` is ever sent) and every field
// inside is optional (a form can save partial progress). PropertyService
// upserts these 1:1 with the matching Prisma sub-table, mirroring how
// plot_details/apartment_details already worked before this rebuild.
const PlotDetailsSchema = zod_1.z.object({
    plot_number: zod_1.z.string().optional().nullable(),
    phase: zod_1.z.string().optional().nullable(),
    sector_block: zod_1.z.string().optional().nullable(),
    survey_number: zod_1.z.string().optional().nullable(),
    subdivision_number: zod_1.z.string().optional().nullable(),
    length: zod_1.z.number().optional().nullable(),
    width: zod_1.z.number().optional().nullable(),
    frontage: zod_1.z.number().optional().nullable(),
    dimension_string: zod_1.z.string().optional().nullable(),
    north_boundary: zod_1.z.string().optional().nullable(),
    south_boundary: zod_1.z.string().optional().nullable(),
    east_boundary: zod_1.z.string().optional().nullable(),
    west_boundary: zod_1.z.string().optional().nullable(),
    road_width: zod_1.z.number().optional().nullable(),
    number_of_roads: zod_1.z.number().int().optional().nullable(),
    is_corner: zod_1.z.boolean().optional().nullable(),
    is_park_facing: zod_1.z.boolean().optional().nullable(),
    is_main_road_facing: zod_1.z.boolean().optional().nullable(),
    near_entrance: zod_1.z.boolean().optional().nullable(),
    near_clubhouse: zod_1.z.boolean().optional().nullable(),
    near_park: zod_1.z.boolean().optional().nullable(),
});
const ApartmentDetailsSchema = zod_1.z.object({
    tower: zod_1.z.string().optional().nullable(),
    block: zod_1.z.string().optional().nullable(),
    floor: zod_1.z.string().optional().nullable(),
    unit_number: zod_1.z.string().optional().nullable(),
    flat_number: zod_1.z.string().optional().nullable(),
    bhk: zod_1.z.string().optional().nullable(),
    balcony_count: zod_1.z.number().int().optional().nullable(),
    has_study_room: zod_1.z.boolean().optional().nullable(),
    has_servant_room: zod_1.z.boolean().optional().nullable(),
    has_utility_area: zod_1.z.boolean().optional().nullable(),
    carpet_area: zod_1.z.number().optional().nullable(),
    built_up_area: zod_1.z.number().optional().nullable(),
    super_built_up_area: zod_1.z.number().optional().nullable(),
    balcony_area: zod_1.z.number().optional().nullable(),
    terrace_area: zod_1.z.number().optional().nullable(),
    is_pool_view: zod_1.z.boolean().optional().nullable(),
    is_garden_view: zod_1.z.boolean().optional().nullable(),
    is_road_view: zod_1.z.boolean().optional().nullable(),
    is_main_road_view: zod_1.z.boolean().optional().nullable(),
    is_city_view: zod_1.z.boolean().optional().nullable(),
    is_higher_floor: zod_1.z.boolean().optional().nullable(),
    is_near_lift: zod_1.z.boolean().optional().nullable(),
    is_near_staircase: zod_1.z.boolean().optional().nullable(),
    parking_included: zod_1.z.boolean().optional().nullable(),
    parking_type: zod_1.z.string().optional().nullable(),
    parking_slots: zod_1.z.number().int().optional().nullable(),
    parking_number: zod_1.z.string().optional().nullable(),
    is_covered_parking: zod_1.z.boolean().optional().nullable(),
    has_additional_parking: zod_1.z.boolean().optional().nullable(),
    structure_type: zod_1.z.string().optional().nullable(),
    flooring: zod_1.z.string().optional().nullable(),
    kitchen_type: zod_1.z.string().optional().nullable(),
    windows: zod_1.z.string().optional().nullable(),
    doors: zod_1.z.string().optional().nullable(),
    electrical: zod_1.z.string().optional().nullable(),
    plumbing: zod_1.z.string().optional().nullable(),
    bathroom_type: zod_1.z.string().optional().nullable(),
    paint: zod_1.z.string().optional().nullable(),
    fixtures: zod_1.z.string().optional().nullable(),
});
const VillaDetailsSchema = zod_1.z.object({
    villa_number: zod_1.z.string().optional().nullable(),
    villa_type: zod_1.z.string().optional().nullable(),
    bhk: zod_1.z.string().optional().nullable(),
    has_second_floor: zod_1.z.boolean().optional().nullable(),
    second_floor_area: zod_1.z.number().optional().nullable(),
    has_servant_room: zod_1.z.boolean().optional().nullable(),
    has_pooja_room: zod_1.z.boolean().optional().nullable(),
    has_study_room: zod_1.z.boolean().optional().nullable(),
    has_family_room: zod_1.z.boolean().optional().nullable(),
    garden_area: zod_1.z.number().optional().nullable(),
    terrace_area: zod_1.z.number().optional().nullable(),
    is_clubhouse_facing: zod_1.z.boolean().optional().nullable(),
    is_pool_facing: zod_1.z.boolean().optional().nullable(),
    has_private_garden: zod_1.z.boolean().optional().nullable(),
    has_private_pool: zod_1.z.boolean().optional().nullable(),
    has_terrace: zod_1.z.boolean().optional().nullable(),
    has_compound_wall: zod_1.z.boolean().optional().nullable(),
    has_gate: zod_1.z.boolean().optional().nullable(),
    number_of_cars: zod_1.z.number().int().optional().nullable(),
    has_ev_charging: zod_1.z.boolean().optional().nullable(),
});
const HouseDetailsSchema = zod_1.z.object({
    house_number: zod_1.z.string().optional().nullable(),
    house_type: zod_1.z.string().optional().nullable(),
    bhk: zod_1.z.string().optional().nullable(),
    has_kitchen: zod_1.z.boolean().optional().nullable(),
    has_pooja_room: zod_1.z.boolean().optional().nullable(),
    has_study_room: zod_1.z.boolean().optional().nullable(),
    has_servant_room: zod_1.z.boolean().optional().nullable(),
    has_utility_room: zod_1.z.boolean().optional().nullable(),
    garden_area: zod_1.z.number().optional().nullable(),
    terrace_area: zod_1.z.number().optional().nullable(),
    is_covered_parking: zod_1.z.boolean().optional().nullable(),
    parking_capacity: zod_1.z.number().int().optional().nullable(),
    parking_number: zod_1.z.string().optional().nullable(),
    has_additional_parking: zod_1.z.boolean().optional().nullable(),
});
const CommercialShopDetailsSchema = zod_1.z.object({
    shop_number: zod_1.z.string().optional().nullable(),
    building: zod_1.z.string().optional().nullable(),
    block: zod_1.z.string().optional().nullable(),
    floor: zod_1.z.string().optional().nullable(),
    shop_type: zod_1.z.string().optional().nullable(),
    frontage: zod_1.z.number().optional().nullable(),
    depth: zod_1.z.number().optional().nullable(),
    ceiling_height: zod_1.z.number().optional().nullable(),
    is_mall_facing: zod_1.z.boolean().optional().nullable(),
    is_entrance_facing: zod_1.z.boolean().optional().nullable(),
    is_parking_facing: zod_1.z.boolean().optional().nullable(),
    is_high_footfall_location: zod_1.z.boolean().optional().nullable(),
    has_parking: zod_1.z.boolean().optional().nullable(),
    has_power: zod_1.z.boolean().optional().nullable(),
    has_water: zod_1.z.boolean().optional().nullable(),
    has_washroom: zod_1.z.boolean().optional().nullable(),
    has_lift: zod_1.z.boolean().optional().nullable(),
    has_security: zod_1.z.boolean().optional().nullable(),
    has_fire_safety: zod_1.z.boolean().optional().nullable(),
    has_signage_space: zod_1.z.boolean().optional().nullable(),
});
const CommercialOfficeDetailsSchema = zod_1.z.object({
    office_number: zod_1.z.string().optional().nullable(),
    tower: zod_1.z.string().optional().nullable(),
    floor: zod_1.z.string().optional().nullable(),
    block: zod_1.z.string().optional().nullable(),
    office_type: zod_1.z.string().optional().nullable(),
    cabins: zod_1.z.number().int().optional().nullable(),
    workstations: zod_1.z.number().int().optional().nullable(),
    meeting_rooms: zod_1.z.number().int().optional().nullable(),
    has_reception: zod_1.z.boolean().optional().nullable(),
    has_pantry: zod_1.z.boolean().optional().nullable(),
    washrooms: zod_1.z.number().int().optional().nullable(),
    has_server_room: zod_1.z.boolean().optional().nullable(),
    is_city_view: zod_1.z.boolean().optional().nullable(),
    is_higher_floor: zod_1.z.boolean().optional().nullable(),
    has_parking: zod_1.z.boolean().optional().nullable(),
    has_power_backup: zod_1.z.boolean().optional().nullable(),
    has_lift: zod_1.z.boolean().optional().nullable(),
    has_security: zod_1.z.boolean().optional().nullable(),
    has_fire_safety: zod_1.z.boolean().optional().nullable(),
    has_hvac: zod_1.z.boolean().optional().nullable(),
    has_internet: zod_1.z.boolean().optional().nullable(),
    has_ev_charging: zod_1.z.boolean().optional().nullable(),
});
const FarmLandDetailsSchema = zod_1.z.object({
    farm_land_number: zod_1.z.string().optional().nullable(),
    parcel_number: zod_1.z.string().optional().nullable(),
    survey_number: zod_1.z.string().optional().nullable(),
    subdivision: zod_1.z.string().optional().nullable(),
    road_frontage: zod_1.z.number().optional().nullable(),
    boundary_details: zod_1.z.string().optional().nullable(),
    is_near_water_source: zod_1.z.boolean().optional().nullable(),
    has_internal_road: zod_1.z.boolean().optional().nullable(),
    has_electricity: zod_1.z.boolean().optional().nullable(),
    has_water: zod_1.z.boolean().optional().nullable(),
    has_borewell: zod_1.z.boolean().optional().nullable(),
    has_irrigation: zod_1.z.boolean().optional().nullable(),
    has_fencing: zod_1.z.boolean().optional().nullable(),
    has_plantation: zod_1.z.boolean().optional().nullable(),
    has_drainage: zod_1.z.boolean().optional().nullable(),
    has_farmhouse_permission: zod_1.z.boolean().optional().nullable(),
});
const CategoryDetailFields = {
    plot_details: PlotDetailsSchema.partial().optional().nullable(),
    apartment_details: ApartmentDetailsSchema.partial().optional().nullable(),
    villa_details: VillaDetailsSchema.partial().optional().nullable(),
    house_details: HouseDetailsSchema.partial().optional().nullable(),
    commercial_shop_details: CommercialShopDetailsSchema.partial().optional().nullable(),
    commercial_office_details: CommercialOfficeDetailsSchema.partial().optional().nullable(),
    farm_land_details: FarmLandDetailsSchema.partial().optional().nullable(),
};
exports.PropertyStatus = {
    PENDING_VERIFICATION: 'PENDING_VERIFICATION',
    PENDING_DM_POLISH: 'PENDING_DM_POLISH',
    PENDING_MD_APPROVAL: 'PENDING_MD_APPROVAL',
    LIVE: 'LIVE',
    REJECTED: 'REJECTED',
    LOCKED: 'LOCKED',
    BOOKED: 'BOOKED',
    SOLD: 'SOLD',
    // Soft-delete state (PropertyService.archiveProperty) — excluded from the
    // default property list unless explicitly filtered for.
    ARCHIVED: 'ARCHIVED',
};
exports.PropertyAvailability = {
    AVAILABLE: 'AVAILABLE',
    RESERVED: 'RESERVED',
    SOLD: 'SOLD',
    UNAVAILABLE: 'UNAVAILABLE',
};
exports.PropertyBrand = {
    SONTHILLU: 'SONTHILLU', // Residential Villas & Apartments
    RADHA_REAL_HOMES: 'RADHA_REAL_HOMES', // Commercial Plots & Land
};
exports.PropertyCreateSchema = zod_1.z.object({
    title: zod_1.z.string().min(3, 'Title is required'),
    description: zod_1.z.string().optional().nullable(),
    brand_type: zod_1.z.enum(['SONTHILLU', 'RADHA_REAL_HOMES']),
    category: zod_1.z.enum([
        'APARTMENT', 'INDEPENDENT_HOUSE', 'DUPLEX', 'INDEPENDENT_FLOOR',
        'VILLA', 'PENTHOUSE', 'STUDIO', 'PLOT', 'FARM_HOUSE', 'AGRICULTURAL_LAND',
        // Were missing entirely — propertyWizardShared.tsx's PROPERTY_CATEGORIES
        // has always listed these two, but the schema stripped them before they
        // ever reached the service, so a Commercial Shop/Office could never
        // actually be created.
        'COMMERCIAL_SHOP', 'COMMERCIAL_OFFICE',
    ]),
    area_sqft: zod_1.z.number().positive('Area in sqft is required'),
    location: zod_1.z.string().min(2, 'Location is required'),
    address: zod_1.z.string().optional(),
    bedrooms: zod_1.z.number().int().optional().nullable(),
    bathrooms: zod_1.z.number().int().optional().nullable(),
    facing: zod_1.z.string().optional(),
    amenities: zod_1.z.string().optional(),
    possession_status: zod_1.z.enum(['READY_TO_MOVE', 'UNDER_CONSTRUCTION']).optional(),
    assigned_pm_id: zod_1.z.number().int().optional().nullable(),
    // Was missing entirely — validateRequestBody's schema.parse() strips any key not
    // listed here, so a property could never actually be linked to a project via this
    // endpoint despite property.service.ts's createProperty always reading data.project_id.
    project_id: zod_1.z.number().int().positive().optional().nullable(),
    details: zod_1.z.any().optional(), // kept for backward compatibility if needed temporarily
    pricing: zod_1.z.any().optional(),
    // WR-2: Structured location fields
    state: zod_1.z.string().optional().nullable(),
    city: zod_1.z.string().optional().nullable(),
    locality: zod_1.z.string().optional().nullable(),
    pincode: zod_1.z.string().optional().nullable(),
    latitude: zod_1.z.number().optional().nullable(),
    longitude: zod_1.z.number().optional().nullable(),
    listing_type: zod_1.z.enum(['NEW', 'RESALE']).optional(),
    source: zod_1.z.enum(['INTERNAL', 'WEBSITE_SELLER']).optional(),
    ...PropertyPricingFields,
    ...CategoryDetailFields,
}).superRefine((data, ctx) => {
    // § Phase 3: base_rate is now the sole required pricing input — it replaced
    // the removed manual `price` field as what actually drives final_price.
    if (data.base_rate == null || data.base_rate <= 0) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            path: ['base_rate'],
            message: 'Base rate is required and must be greater than 0',
        });
    }
});
exports.PropertyVerificationSchema = zod_1.z.object({
    approved: zod_1.z.boolean(),
    notes: zod_1.z.string().min(3, 'Verification notes required'),
    assigned_pm_id: zod_1.z.number().int().optional(),
});
exports.PropertyDMUpdateSchema = zod_1.z.object({
    digital_marketing_executive_id: zod_1.z.number().int().positive('Must select a Digital Marketing Executive'),
    seo_title: zod_1.z.string().optional(),
    seo_keywords: zod_1.z.string().optional(),
    description: zod_1.z.string().optional(),
    notes: zod_1.z.string().optional(),
});
exports.PropertyDMVerifyAsIsSchema = zod_1.z.object({
    notes: zod_1.z.string().optional(),
});
exports.PropertyMDApprovalSchema = zod_1.z.object({
    approved: zod_1.z.boolean(),
    comments: zod_1.z.string().optional(),
});
// Phase 2.6: a PM resubmitting a REJECTED property back into the pipeline
// after fixing whatever caused the rejection.
exports.PropertyResubmitSchema = zod_1.z.object({
    notes: zod_1.z.string().optional(),
});
exports.PropertyUpdateSchema = zod_1.z.object({
    title: zod_1.z.string().min(3).optional(),
    // .nullable(): PropertyForm.tsx (Rebuild Phase 5) always sends the full
    // fetched property back on submit (like ProjectWizard.tsx does for
    // Project), so any field the DB can hold as null must accept null here too
    // — plain .optional() rejects null and 400s on every edit that hasn't
    // touched that field. (Same class of bug as Project's description/
    // total_area/project_phase/rera_number fix earlier in this rebuild.)
    description: zod_1.z.string().optional().nullable(),
    brand_type: zod_1.z.enum(['SONTHILLU', 'RADHA_REAL_HOMES']).optional(),
    category: zod_1.z.string().optional(),
    area_sqft: zod_1.z.number().positive().optional(),
    location: zod_1.z.string().min(3).optional(),
    address: zod_1.z.string().optional().nullable(),
    bedrooms: zod_1.z.number().int().optional().nullable(),
    bathrooms: zod_1.z.number().int().optional().nullable(),
    facing: zod_1.z.string().optional().nullable(),
    amenities: zod_1.z.any().optional(),
    possession_status: zod_1.z.enum(['READY_TO_MOVE', 'UNDER_CONSTRUCTION']).optional().nullable(),
    assigned_pm_id: zod_1.z.number().int().optional().nullable(),
    project_id: zod_1.z.number().int().positive().nullable().optional(),
    // Nested detail sub-records: passed through here and handled by
    // PropertyService.updateProperty (upsert-or-delete per key). `pricing` is
    // the legacy free-form sub-record kept for old data; the category-specific
    // ones below are now real, typed shapes (CategoryDetailFields).
    pricing: zod_1.z.any().optional().nullable(),
    // WR-2: Structured location fields
    state: zod_1.z.string().optional().nullable(),
    city: zod_1.z.string().optional().nullable(),
    locality: zod_1.z.string().optional().nullable(),
    pincode: zod_1.z.string().optional().nullable(),
    latitude: zod_1.z.number().optional().nullable(),
    longitude: zod_1.z.number().optional().nullable(),
    listing_type: zod_1.z.enum(['NEW', 'RESALE']).optional().nullable(),
    ...PropertyPricingFields,
    ...CategoryDetailFields,
});
exports.PropertyPublicationSchema = zod_1.z.object({
    property_id: zod_1.z.number().int().positive(),
    company_id: zod_1.z.number().int().positive(),
    is_published: zod_1.z.boolean(),
});
exports.PropertyTogglePublicationBodySchema = zod_1.z.object({
    company_id: zod_1.z.number().int().positive(),
    is_published: zod_1.z.boolean(),
});
// Reassigning a property's PM as a distinct, reasoned action — mirrors
// ProjectReassignSchema. Wires up PropertyService.reassignProperty, which
// existed but had no route calling it.
exports.PropertyReassignSchema = zod_1.z.object({
    new_pm_id: zod_1.z.number().int().positive('New assignee ID is required'),
    reason: zod_1.z.string().min(3, 'Reassignment reason is required'),
});
exports.PropertyImageMetadataSchema = zod_1.z.object({
    alt_text: zod_1.z.string().optional(),
    sort_order: zod_1.z.union([zod_1.z.string().regex(/^\d+$/).transform(Number), zod_1.z.number().int().nonnegative()]).optional(),
    is_primary: zod_1.z.union([
        zod_1.z.string().toLowerCase().transform(v => v === 'true'),
        zod_1.z.boolean()
    ]).optional(),
});
