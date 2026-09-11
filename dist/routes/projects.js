"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Composer for /api/v1/projects — split into single-responsibility route
// modules under ./projects/, mirroring routes/properties.ts's Phase 4.4 split.
// Every URL, method, and registration order is preserved so server.ts's
// `app.use('/api/v1/projects', projectRoutes)` needed no change.
const express_1 = require("express");
const core_1 = __importDefault(require("./projects/core"));
const units_1 = __importDefault(require("./projects/units"));
const pricing_1 = __importDefault(require("./projects/pricing"));
const amenities_1 = __importDefault(require("./projects/amenities"));
const router = (0, express_1.Router)();
router.use('/', core_1.default);
router.use('/', units_1.default);
router.use('/', pricing_1.default);
router.use('/', amenities_1.default);
exports.default = router;
