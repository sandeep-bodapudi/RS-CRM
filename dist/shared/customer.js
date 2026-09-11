"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomerUpdateSchema = exports.CustomerCreateSchema = void 0;
const zod_1 = require("zod");
// ─────────────────────────────────────────────────────────────
// CUSTOMER SCHEMAS
// ─────────────────────────────────────────────────────────────
exports.CustomerCreateSchema = zod_1.z.object({
    first_name: zod_1.z.string().min(2),
    last_name: zod_1.z.string().optional(),
    phone: zod_1.z.string().min(10),
    email: zod_1.z.string().email().optional(),
    status: zod_1.z.string().default('ACTIVE'),
    source: zod_1.z.string().default('MANUAL_ENTRY'),
    assigned_to_id: zod_1.z.number().optional(),
});
exports.CustomerUpdateSchema = zod_1.z.object({
    first_name: zod_1.z.string().min(2).optional(),
    last_name: zod_1.z.string().optional(),
    phone: zod_1.z.string().min(10).optional(),
    email: zod_1.z.string().email().optional(),
    status: zod_1.z.string().optional(),
});
