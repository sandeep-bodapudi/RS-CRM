import { z } from 'zod';
import { AreaUnitEnum, PriceBasisEnum, ChargeCalcMethodEnum, ChargeCategoryEnum, PricingRuleKindEnum } from './projectUnit';

// § Phase 3: a Property's own conditional pricing rules — mirrors
// ProjectPricingRuleCreateSchema, minus applies_to_unit_type (a property
// already has one fixed category) and floor matching (no top-level numeric
// floor field on Property).
export const PropertyPricingRuleCreateSchema = z.object({
  label: z.string().min(1),
  kind: PricingRuleKindEnum,
  category: ChargeCategoryEnum,
  calc_method: ChargeCalcMethodEnum,
  rate: z.number(),
  area_basis: PriceBasisEnum.optional().nullable(),

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
});
export type PropertyPricingRuleCreateInput = z.infer<typeof PropertyPricingRuleCreateSchema>;

export const PropertyPricingRuleUpdateSchema = PropertyPricingRuleCreateSchema.partial();
export type PropertyPricingRuleUpdateInput = z.infer<typeof PropertyPricingRuleUpdateSchema>;

/** Body for the property price-preview endpoint. */
export const PropertyPricePreviewSchema = z.object({
  area_value: z.number().positive().optional().nullable(),
  area_unit: AreaUnitEnum.optional().nullable(),
  plot_area_sqyd: z.number().positive().optional().nullable(),
  carpet_area_sqft: z.number().positive().optional().nullable(),
  built_up_area_sqft: z.number().positive().optional().nullable(),
  super_built_up_area_sqft: z.number().positive().optional().nullable(),
  price_basis: PriceBasisEnum.optional().nullable(),
  facing: z.string().optional().nullable(),
  view: z.string().optional().nullable(),
  is_corner: z.boolean().optional(),
  is_road_facing: z.boolean().optional(),
  is_park_facing: z.boolean().optional(),
  is_main_road_facing: z.boolean().optional(),
  base_rate: z.number().optional().nullable(),
  base_rate_unit: ChargeCalcMethodEnum.optional().nullable(),
  discount_amount: z.number().optional().nullable(),
  discount_reason: z.string().optional().nullable(),
  manual_lines: z
    .array(z.object({ label: z.string().min(1), category: ChargeCategoryEnum.optional(), amount: z.number() }))
    .optional(),
});
export type PropertyPricePreviewInput = z.infer<typeof PropertyPricePreviewSchema>;

export const OverridePropertyPriceSchema = z.object({
  override_price: z.number().positive().nullable(),
  override_reason: z.string().min(3, 'A reason is required when overriding the calculated price').optional().nullable(),
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
  construction_year: z.number().int().optional().nullable(),

  price_basis: PriceBasisEnum.optional(),

  view: z.string().optional().nullable(),
  road_width_ft: z.number().optional().nullable(),
  is_corner: z.boolean().optional(),
  is_park_facing: z.boolean().optional(),
  is_road_facing: z.boolean().optional(),
  is_main_road_facing: z.boolean().optional(),

  is_premium_location: z.boolean().optional(),

  base_rate: z.number().optional().nullable(),
  base_rate_unit: ChargeCalcMethodEnum.optional().nullable(),
  discount_amount: z.number().optional().nullable(),
  discount_reason: z.string().optional().nullable(),
  manual_lines: z
    .array(z.object({ label: z.string().min(1), category: ChargeCategoryEnum.optional(), amount: z.number() }))
    .optional(),
};

// Category-specific detail sub-objects (property details.md spec) — one real,
// typed shape per property type instead of every category sharing the same
// generic field set. Each is optional/nullable as a whole (only the category
// matching the property's own `category` is ever sent) and every field
// inside is optional (a form can save partial progress). PropertyService
// upserts these 1:1 with the matching Prisma sub-table, mirroring how
// plot_details/apartment_details already worked before this rebuild.
const PlotDetailsSchema = z.object({
  plot_number: z.string().optional().nullable(),
  phase: z.string().optional().nullable(),
  sector_block: z.string().optional().nullable(),
  survey_number: z.string().optional().nullable(),
  subdivision_number: z.string().optional().nullable(),
  length: z.number().optional().nullable(),
  width: z.number().optional().nullable(),
  frontage: z.number().optional().nullable(),
  dimension_string: z.string().optional().nullable(),
  north_boundary: z.string().optional().nullable(),
  south_boundary: z.string().optional().nullable(),
  east_boundary: z.string().optional().nullable(),
  west_boundary: z.string().optional().nullable(),
  road_width: z.number().optional().nullable(),
  number_of_roads: z.number().int().optional().nullable(),
  is_corner: z.boolean().optional().nullable(),
  is_park_facing: z.boolean().optional().nullable(),
  is_main_road_facing: z.boolean().optional().nullable(),
  near_entrance: z.boolean().optional().nullable(),
  near_clubhouse: z.boolean().optional().nullable(),
  near_park: z.boolean().optional().nullable(),
});

const ApartmentDetailsSchema = z.object({
  tower: z.string().optional().nullable(),
  block: z.string().optional().nullable(),
  floor: z.string().optional().nullable(),
  unit_number: z.string().optional().nullable(),
  flat_number: z.string().optional().nullable(),
  bhk: z.string().optional().nullable(),
  balcony_count: z.number().int().optional().nullable(),
  has_study_room: z.boolean().optional().nullable(),
  has_servant_room: z.boolean().optional().nullable(),
  has_utility_area: z.boolean().optional().nullable(),
  carpet_area: z.number().optional().nullable(),
  built_up_area: z.number().optional().nullable(),
  super_built_up_area: z.number().optional().nullable(),
  balcony_area: z.number().optional().nullable(),
  terrace_area: z.number().optional().nullable(),
  is_pool_view: z.boolean().optional().nullable(),
  is_garden_view: z.boolean().optional().nullable(),
  is_road_view: z.boolean().optional().nullable(),
  is_main_road_view: z.boolean().optional().nullable(),
  is_city_view: z.boolean().optional().nullable(),
  is_higher_floor: z.boolean().optional().nullable(),
  is_near_lift: z.boolean().optional().nullable(),
  is_near_staircase: z.boolean().optional().nullable(),
  parking_included: z.boolean().optional().nullable(),
  parking_type: z.string().optional().nullable(),
  parking_slots: z.number().int().optional().nullable(),
  parking_number: z.string().optional().nullable(),
  is_covered_parking: z.boolean().optional().nullable(),
  has_additional_parking: z.boolean().optional().nullable(),
  structure_type: z.string().optional().nullable(),
  flooring: z.string().optional().nullable(),
  kitchen_type: z.string().optional().nullable(),
  windows: z.string().optional().nullable(),
  doors: z.string().optional().nullable(),
  electrical: z.string().optional().nullable(),
  plumbing: z.string().optional().nullable(),
  bathroom_type: z.string().optional().nullable(),
  paint: z.string().optional().nullable(),
  fixtures: z.string().optional().nullable(),
});

const VillaDetailsSchema = z.object({
  villa_number: z.string().optional().nullable(),
  villa_type: z.string().optional().nullable(),
  bhk: z.string().optional().nullable(),
  has_second_floor: z.boolean().optional().nullable(),
  second_floor_area: z.number().optional().nullable(),
  has_servant_room: z.boolean().optional().nullable(),
  has_pooja_room: z.boolean().optional().nullable(),
  has_study_room: z.boolean().optional().nullable(),
  has_family_room: z.boolean().optional().nullable(),
  garden_area: z.number().optional().nullable(),
  terrace_area: z.number().optional().nullable(),
  is_clubhouse_facing: z.boolean().optional().nullable(),
  is_pool_facing: z.boolean().optional().nullable(),
  has_private_garden: z.boolean().optional().nullable(),
  has_private_pool: z.boolean().optional().nullable(),
  has_terrace: z.boolean().optional().nullable(),
  has_compound_wall: z.boolean().optional().nullable(),
  has_gate: z.boolean().optional().nullable(),
  number_of_cars: z.number().int().optional().nullable(),
  has_ev_charging: z.boolean().optional().nullable(),
});

const HouseDetailsSchema = z.object({
  house_number: z.string().optional().nullable(),
  house_type: z.string().optional().nullable(),
  bhk: z.string().optional().nullable(),
  has_kitchen: z.boolean().optional().nullable(),
  has_pooja_room: z.boolean().optional().nullable(),
  has_study_room: z.boolean().optional().nullable(),
  has_servant_room: z.boolean().optional().nullable(),
  has_utility_room: z.boolean().optional().nullable(),
  garden_area: z.number().optional().nullable(),
  terrace_area: z.number().optional().nullable(),
  is_covered_parking: z.boolean().optional().nullable(),
  parking_capacity: z.number().int().optional().nullable(),
  parking_number: z.string().optional().nullable(),
  has_additional_parking: z.boolean().optional().nullable(),
});

const CommercialShopDetailsSchema = z.object({
  shop_number: z.string().optional().nullable(),
  building: z.string().optional().nullable(),
  block: z.string().optional().nullable(),
  floor: z.string().optional().nullable(),
  shop_type: z.string().optional().nullable(),
  frontage: z.number().optional().nullable(),
  depth: z.number().optional().nullable(),
  ceiling_height: z.number().optional().nullable(),
  is_mall_facing: z.boolean().optional().nullable(),
  is_entrance_facing: z.boolean().optional().nullable(),
  is_parking_facing: z.boolean().optional().nullable(),
  is_high_footfall_location: z.boolean().optional().nullable(),
  has_parking: z.boolean().optional().nullable(),
  has_power: z.boolean().optional().nullable(),
  has_water: z.boolean().optional().nullable(),
  has_washroom: z.boolean().optional().nullable(),
  has_lift: z.boolean().optional().nullable(),
  has_security: z.boolean().optional().nullable(),
  has_fire_safety: z.boolean().optional().nullable(),
  has_signage_space: z.boolean().optional().nullable(),
});

const CommercialOfficeDetailsSchema = z.object({
  office_number: z.string().optional().nullable(),
  tower: z.string().optional().nullable(),
  floor: z.string().optional().nullable(),
  block: z.string().optional().nullable(),
  office_type: z.string().optional().nullable(),
  cabins: z.number().int().optional().nullable(),
  workstations: z.number().int().optional().nullable(),
  meeting_rooms: z.number().int().optional().nullable(),
  has_reception: z.boolean().optional().nullable(),
  has_pantry: z.boolean().optional().nullable(),
  washrooms: z.number().int().optional().nullable(),
  has_server_room: z.boolean().optional().nullable(),
  is_city_view: z.boolean().optional().nullable(),
  is_higher_floor: z.boolean().optional().nullable(),
  has_parking: z.boolean().optional().nullable(),
  has_power_backup: z.boolean().optional().nullable(),
  has_lift: z.boolean().optional().nullable(),
  has_security: z.boolean().optional().nullable(),
  has_fire_safety: z.boolean().optional().nullable(),
  has_hvac: z.boolean().optional().nullable(),
  has_internet: z.boolean().optional().nullable(),
  has_ev_charging: z.boolean().optional().nullable(),
});

const FarmLandDetailsSchema = z.object({
  farm_land_number: z.string().optional().nullable(),
  parcel_number: z.string().optional().nullable(),
  survey_number: z.string().optional().nullable(),
  subdivision: z.string().optional().nullable(),
  road_frontage: z.number().optional().nullable(),
  boundary_details: z.string().optional().nullable(),
  is_near_water_source: z.boolean().optional().nullable(),
  has_internal_road: z.boolean().optional().nullable(),
  has_electricity: z.boolean().optional().nullable(),
  has_water: z.boolean().optional().nullable(),
  has_borewell: z.boolean().optional().nullable(),
  has_irrigation: z.boolean().optional().nullable(),
  has_fencing: z.boolean().optional().nullable(),
  has_plantation: z.boolean().optional().nullable(),
  has_drainage: z.boolean().optional().nullable(),
  has_farmhouse_permission: z.boolean().optional().nullable(),
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
export const PropertyStatus = {
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
} as const;

export type PropertyStatusType = typeof PropertyStatus[keyof typeof PropertyStatus];

export const PropertyAvailability = {
  AVAILABLE: 'AVAILABLE',
  RESERVED: 'RESERVED',
  SOLD: 'SOLD',
  UNAVAILABLE: 'UNAVAILABLE',
} as const;

export type PropertyAvailabilityType = typeof PropertyAvailability[keyof typeof PropertyAvailability];

export const PropertyBrand = {
  SONTHILLU: 'SONTHILLU', // Residential Villas & Apartments
  RADHA_REAL_HOMES: 'RADHA_REAL_HOMES', // Commercial Plots & Land
} as const;

export const PropertyCreateSchema = z.object({
  title: z.string().min(3, 'Title is required'),
  description: z.string().optional().nullable(),
  brand_type: z.enum(['SONTHILLU', 'RADHA_REAL_HOMES']),
  category: z.enum([
    'APARTMENT', 'INDEPENDENT_HOUSE', 'DUPLEX', 'INDEPENDENT_FLOOR',
    'VILLA', 'PENTHOUSE', 'STUDIO', 'PLOT', 'FARM_HOUSE', 'AGRICULTURAL_LAND',
    // Were missing entirely — propertyWizardShared.tsx's PROPERTY_CATEGORIES
    // has always listed these two, but the schema stripped them before they
    // ever reached the service, so a Commercial Shop/Office could never
    // actually be created.
    'COMMERCIAL_SHOP', 'COMMERCIAL_OFFICE',
  ]),
  area_sqft: z.number().positive('Area in sqft is required'),
  location: z.string().min(2, 'Location is required'),
  address: z.string().optional(),
  bedrooms: z.number().int().optional().nullable(),
  bathrooms: z.number().int().optional().nullable(),
  facing: z.string().optional(),
  amenities: z.string().optional(),
  possession_status: z.enum(['READY_TO_MOVE', 'UNDER_CONSTRUCTION']).optional(),
  assigned_pm_id: z.number().int().optional().nullable(),
  // Was missing entirely — validateRequestBody's schema.parse() strips any key not
  // listed here, so a property could never actually be linked to a project via this
  // endpoint despite property.service.ts's createProperty always reading data.project_id.
  project_id: z.number().int().positive().optional().nullable(),
  details: z.any().optional(), // kept for backward compatibility if needed temporarily
  pricing: z.any().optional(),
  // WR-2: Structured location fields
  state: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  locality: z.string().optional().nullable(),
  pincode: z.string().optional().nullable(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  listing_type: z.enum(['NEW', 'RESALE']).optional(),
  source: z.enum(['INTERNAL', 'WEBSITE_SELLER']).optional(),
  ...PropertyPricingFields,
  ...CategoryDetailFields,
}).superRefine((data, ctx) => {
  // § Phase 3: base_rate is now the sole required pricing input — it replaced
  // the removed manual `price` field as what actually drives final_price.
  if (data.base_rate == null || data.base_rate <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['base_rate'],
      message: 'Base rate is required and must be greater than 0',
    });
  }
});

export type PropertyCreateInput = z.infer<typeof PropertyCreateSchema>;

export const PropertyVerificationSchema = z.object({
  approved: z.boolean(),
  notes: z.string().min(3, 'Verification notes required'),
  assigned_pm_id: z.number().int().optional(),
});

export type PropertyVerificationInput = z.infer<typeof PropertyVerificationSchema>;

export const PropertyDMUpdateSchema = z.object({
  digital_marketing_executive_id: z.number().int().positive('Must select a Digital Marketing Executive'),
  seo_title: z.string().optional(),
  seo_keywords: z.string().optional(),
  description: z.string().optional(),
  notes: z.string().optional(),
});

export type PropertyDMUpdateInput = z.infer<typeof PropertyDMUpdateSchema>;

export const PropertyDMVerifyAsIsSchema = z.object({
  notes: z.string().optional(),
});
export type PropertyDMVerifyAsIsInput = z.infer<typeof PropertyDMVerifyAsIsSchema>;

export const PropertyMDApprovalSchema = z.object({
  approved: z.boolean(),
  comments: z.string().optional(),
});

// Phase 2.6: a PM resubmitting a REJECTED property back into the pipeline
// after fixing whatever caused the rejection.
export const PropertyResubmitSchema = z.object({
  notes: z.string().optional(),
});
export type PropertyResubmitInput = z.infer<typeof PropertyResubmitSchema>;

export type PropertyMDApprovalInput = z.infer<typeof PropertyMDApprovalSchema>;

export const PropertyUpdateSchema = z.object({
  title: z.string().min(3).optional(),
  // .nullable(): PropertyForm.tsx (Rebuild Phase 5) always sends the full
  // fetched property back on submit (like ProjectWizard.tsx does for
  // Project), so any field the DB can hold as null must accept null here too
  // — plain .optional() rejects null and 400s on every edit that hasn't
  // touched that field. (Same class of bug as Project's description/
  // total_area/project_phase/rera_number fix earlier in this rebuild.)
  description: z.string().optional().nullable(),
  brand_type: z.enum(['SONTHILLU', 'RADHA_REAL_HOMES']).optional(),
  category: z.string().optional(),
  area_sqft: z.number().positive().optional(),
  location: z.string().min(3).optional(),
  address: z.string().optional().nullable(),
  bedrooms: z.number().int().optional().nullable(),
  bathrooms: z.number().int().optional().nullable(),
  facing: z.string().optional().nullable(),
  amenities: z.any().optional(),
  possession_status: z.enum(['READY_TO_MOVE', 'UNDER_CONSTRUCTION']).optional().nullable(),
  assigned_pm_id: z.number().int().optional().nullable(),
  project_id: z.number().int().positive().nullable().optional(),
  // Nested detail sub-records: passed through here and handled by
  // PropertyService.updateProperty (upsert-or-delete per key). `pricing` is
  // the legacy free-form sub-record kept for old data; the category-specific
  // ones below are now real, typed shapes (CategoryDetailFields).
  pricing: z.any().optional().nullable(),
  // WR-2: Structured location fields
  state: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  locality: z.string().optional().nullable(),
  pincode: z.string().optional().nullable(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  listing_type: z.enum(['NEW', 'RESALE']).optional().nullable(),
  ...PropertyPricingFields,
  ...CategoryDetailFields,
});

export type PropertyUpdateInput = z.infer<typeof PropertyUpdateSchema>;

export const PropertyPublicationSchema = z.object({
  property_id: z.number().int().positive(),
  company_id: z.number().int().positive(),
  is_published: z.boolean(),
});

export type PropertyPublicationInput = z.infer<typeof PropertyPublicationSchema>;

export const PropertyTogglePublicationBodySchema = z.object({
  company_id: z.number().int().positive(),
  is_published: z.boolean(),
});

// Reassigning a property's PM as a distinct, reasoned action — mirrors
// ProjectReassignSchema. Wires up PropertyService.reassignProperty, which
// existed but had no route calling it.
export const PropertyReassignSchema = z.object({
  new_pm_id: z.number().int().positive('New assignee ID is required'),
  reason: z.string().min(3, 'Reassignment reason is required'),
});
export type PropertyReassignInput = z.infer<typeof PropertyReassignSchema>;

export const PropertyImageMetadataSchema = z.object({
  alt_text: z.string().optional(),
  sort_order: z.union([z.string().regex(/^\d+$/).transform(Number), z.number().int().nonnegative()]).optional(),
  is_primary: z.union([
    z.string().toLowerCase().transform(v => v === 'true'),
    z.boolean()
  ]).optional(),
});

