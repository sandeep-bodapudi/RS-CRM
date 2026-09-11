"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectAmenityUpsertSchema = exports.AmenityUpdateSchema = exports.AmenityCreateSchema = exports.AmenityApplicabilityEnum = exports.AmenityAvailabilityEnum = exports.AmenityCategoryEnum = void 0;
const zod_1 = require("zod");
const projectUnit_1 = require("./projectUnit");
// Amenity catalog + per-project amenity configuration (Rebuild Phase 3).
//
// Amenity is a company-wide catalog ("Swimming Pool" is one row, not a string
// retyped per project). ProjectAmenity is how one project offers a catalog
// amenity: INCLUDED (free, informational), CHARGEABLE (adds a charge — wired
// into the pricing engine as a rule, see services/amenity.service.ts and
// pricing.service.ts's getEffectiveRules), or OPTIONAL (available, but no
// automatic charge — a buyer opts in, not modelled as a pricing rule here).
exports.AmenityCategoryEnum = zod_1.z.enum(['SECURITY', 'RECREATION', 'CONVENIENCE', 'ENVIRONMENT', 'SPORTS', 'UTILITY', 'OTHER']);
exports.AmenityAvailabilityEnum = zod_1.z.enum(['INCLUDED', 'OPTIONAL', 'CHARGEABLE']);
exports.AmenityApplicabilityEnum = zod_1.z.enum(['ALL_UNITS', 'SELECTED_UNITS', 'BY_UNIT_TYPE']);
exports.AmenityCreateSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, 'Name is required'),
    icon: zod_1.z.string().optional().nullable(),
    category: exports.AmenityCategoryEnum.optional(),
});
exports.AmenityUpdateSchema = exports.AmenityCreateSchema.partial().extend({
    is_active: zod_1.z.boolean().optional(),
});
exports.ProjectAmenityUpsertSchema = zod_1.z
    .object({
    availability: exports.AmenityAvailabilityEnum,
    charge_calc_method: projectUnit_1.ChargeCalcMethodEnum.optional().nullable(),
    charge_amount: zod_1.z.number().positive().optional().nullable(),
    applicability: exports.AmenityApplicabilityEnum.optional(),
    applicable_unit_type: projectUnit_1.UnitTypeEnum.optional().nullable(),
    /// Only meaningful when availability=CHARGEABLE and applicability=SELECTED_UNITS —
    /// the specific units this amenity's charge applies to.
    selected_unit_ids: zod_1.z.array(zod_1.z.number().int()).optional(),
    notes: zod_1.z.string().optional().nullable(),
    sort_order: zod_1.z.number().int().optional(),
})
    .refine((data) => data.availability !== 'CHARGEABLE' || (!!data.charge_calc_method && data.charge_amount != null), {
    message: 'A calculation method and amount are required for a chargeable amenity',
    path: ['charge_amount'],
})
    .refine((data) => data.applicability !== 'BY_UNIT_TYPE' || !!data.applicable_unit_type, {
    message: 'Select which unit type this amenity applies to',
    path: ['applicable_unit_type'],
});
