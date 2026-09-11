"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DemoAcceptSchema = exports.DemoScheduleSchema = void 0;
const zod_1 = require("zod");
// Schema for scheduling a demo (used when creating via lead status transition)
// handler_id is optional — if not provided, the backend auto-resolves from the
// lead's project PM (territory-based auto-assign). When territory model exists,
// replace the project-PM lookup with a territory match.
exports.DemoScheduleSchema = zod_1.z.object({
    demo_scheduled_at: zod_1.z.string().datetime(),
    demo_handler_id: zod_1.z.number().int().positive().optional(),
});
// Schema for accepting/declining a demo (blind approval)
exports.DemoAcceptSchema = zod_1.z.object({
    notes: zod_1.z.string().optional(),
});
