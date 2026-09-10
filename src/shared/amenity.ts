import { z } from 'zod';
import { UnitTypeEnum, ChargeCalcMethodEnum } from './projectUnit';

// Amenity catalog + per-project amenity configuration (Rebuild Phase 3).
//
// Amenity is a company-wide catalog ("Swimming Pool" is one row, not a string
// retyped per project). ProjectAmenity is how one project offers a catalog
// amenity: INCLUDED (free, informational), CHARGEABLE (adds a charge — wired
// into the pricing engine as a rule, see services/amenity.service.ts and
// pricing.service.ts's getEffectiveRules), or OPTIONAL (available, but no
// automatic charge — a buyer opts in, not modelled as a pricing rule here).

export const AmenityCategoryEnum = z.enum(['SECURITY', 'RECREATION', 'CONVENIENCE', 'ENVIRONMENT', 'SPORTS', 'UTILITY', 'OTHER']);
export const AmenityAvailabilityEnum = z.enum(['INCLUDED', 'OPTIONAL', 'CHARGEABLE']);
export const AmenityApplicabilityEnum = z.enum(['ALL_UNITS', 'SELECTED_UNITS', 'BY_UNIT_TYPE']);

export const AmenityCreateSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  icon: z.string().optional().nullable(),
  category: AmenityCategoryEnum.optional(),
});
export type AmenityCreateInput = z.infer<typeof AmenityCreateSchema>;

export const AmenityUpdateSchema = AmenityCreateSchema.partial().extend({
  is_active: z.boolean().optional(),
});
export type AmenityUpdateInput = z.infer<typeof AmenityUpdateSchema>;

export const ProjectAmenityUpsertSchema = z
  .object({
    availability: AmenityAvailabilityEnum,
    charge_calc_method: ChargeCalcMethodEnum.optional().nullable(),
    charge_amount: z.number().positive().optional().nullable(),
    applicability: AmenityApplicabilityEnum.optional(),
    applicable_unit_type: UnitTypeEnum.optional().nullable(),
    /// Only meaningful when availability=CHARGEABLE and applicability=SELECTED_UNITS —
    /// the specific units this amenity's charge applies to.
    selected_unit_ids: z.array(z.number().int()).optional(),
    notes: z.string().optional().nullable(),
    sort_order: z.number().int().optional(),
  })
  .refine((data) => data.availability !== 'CHARGEABLE' || (!!data.charge_calc_method && data.charge_amount != null), {
    message: 'A calculation method and amount are required for a chargeable amenity',
    path: ['charge_amount'],
  })
  .refine((data) => data.applicability !== 'BY_UNIT_TYPE' || !!data.applicable_unit_type, {
    message: 'Select which unit type this amenity applies to',
    path: ['applicable_unit_type'],
  });
export type ProjectAmenityUpsertInput = z.infer<typeof ProjectAmenityUpsertSchema>;
