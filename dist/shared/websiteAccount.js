"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebsiteActivityTrackSchema = exports.WebsiteSavedItemSchema = exports.WebsiteAccountLoginSchema = exports.WebsiteAccountRegisterSchema = void 0;
const zod_1 = require("zod");
// Public-website self-service account — see the comment on WebsiteAccount
// in schema.prisma for why this is deliberately separate from the CRM's own
// `Customer`/`Lead` concepts.
exports.WebsiteAccountRegisterSchema = zod_1.z.object({
    full_name: zod_1.z.string().min(2, 'Name is required'),
    email: zod_1.z.string().email('Invalid email address'),
    phone: zod_1.z.string().optional(),
    password: zod_1.z.string().min(8, 'Password must be at least 8 characters'),
});
exports.WebsiteAccountLoginSchema = zod_1.z.object({
    email: zod_1.z.string().email('Invalid email address'),
    password: zod_1.z.string().min(1, 'Password is required'),
});
/** Exactly one of property_id / project_unit_id, matching the XOR the schema
 * enforces via two partial-unique indexes on WebsiteShortlistItem/CompareItem. */
exports.WebsiteSavedItemSchema = zod_1.z
    .object({
    property_id: zod_1.z.number().int().positive().optional(),
    project_unit_id: zod_1.z.number().int().positive().optional(),
})
    .refine((v) => (v.property_id ? 1 : 0) + (v.project_unit_id ? 1 : 0) === 1, {
    message: 'Exactly one of property_id or project_unit_id is required',
});
exports.WebsiteActivityTrackSchema = zod_1.z.object({
    event_name: zod_1.z.string().min(1),
    page: zod_1.z.string().optional(),
    property_id: zod_1.z.number().int().positive().optional(),
    project_id: zod_1.z.number().int().positive().optional(),
    anonymous_id: zod_1.z.string().optional(),
    search_context: zod_1.z.record(zod_1.z.any()).optional(),
    metadata: zod_1.z.record(zod_1.z.any()).optional(),
});
