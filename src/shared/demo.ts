import { z } from 'zod';

// Schema for scheduling a demo (used when creating via lead status transition)
// handler_id is optional — if not provided, the backend auto-resolves from the
// lead's project PM (territory-based auto-assign). When territory model exists,
// replace the project-PM lookup with a territory match.
export const DemoScheduleSchema = z.object({
  demo_scheduled_at: z.string().datetime(),
  demo_handler_id: z.number().int().positive().optional(),
});

// Schema for accepting/declining a demo (blind approval)
export const DemoAcceptSchema = z.object({
  notes: z.string().optional(),
});