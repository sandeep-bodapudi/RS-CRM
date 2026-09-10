import { z } from 'zod';

// ─────────────────────────────────────────────────────────────
// CUSTOMER SCHEMAS
// ─────────────────────────────────────────────────────────────

export const CustomerCreateSchema = z.object({
  first_name: z.string().min(2),
  last_name: z.string().optional(),
  phone: z.string().min(10),
  email: z.string().email().optional(),
  status: z.string().default('ACTIVE'),
  source: z.string().default('MANUAL_ENTRY'),
  assigned_to_id: z.number().optional(),
});

export const CustomerUpdateSchema = z.object({
  first_name: z.string().min(2).optional(),
  last_name: z.string().optional(),
  phone: z.string().min(10).optional(),
  email: z.string().email().optional(),
  status: z.string().optional(),
});
