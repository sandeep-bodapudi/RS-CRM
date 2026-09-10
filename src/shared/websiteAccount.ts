import { z } from 'zod';

// Public-website self-service account — see the comment on WebsiteAccount
// in schema.prisma for why this is deliberately separate from the CRM's own
// `Customer`/`Lead` concepts.

export const WebsiteAccountRegisterSchema = z.object({
  full_name: z.string().min(2, 'Name is required'),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});
export type WebsiteAccountRegisterInput = z.infer<typeof WebsiteAccountRegisterSchema>;

export const WebsiteAccountLoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});
export type WebsiteAccountLoginInput = z.infer<typeof WebsiteAccountLoginSchema>;

/** Exactly one of property_id / project_unit_id, matching the XOR the schema
 * enforces via two partial-unique indexes on WebsiteShortlistItem/CompareItem. */
export const WebsiteSavedItemSchema = z
  .object({
    property_id: z.number().int().positive().optional(),
    project_unit_id: z.number().int().positive().optional(),
  })
  .refine((v) => (v.property_id ? 1 : 0) + (v.project_unit_id ? 1 : 0) === 1, {
    message: 'Exactly one of property_id or project_unit_id is required',
  });
export type WebsiteSavedItemInput = z.infer<typeof WebsiteSavedItemSchema>;

export const WebsiteActivityTrackSchema = z.object({
  event_name: z.string().min(1),
  page: z.string().optional(),
  property_id: z.number().int().positive().optional(),
  project_id: z.number().int().positive().optional(),
  anonymous_id: z.string().optional(),
  search_context: z.record(z.any()).optional(),
  metadata: z.record(z.any()).optional(),
});
export type WebsiteActivityTrackInput = z.infer<typeof WebsiteActivityTrackSchema>;
