"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Phase 4.4 (2026-09-07): split from a single 722-line file into
// single-responsibility route modules under ./properties/, composed here at
// the same base path ('/') so every URL, method, and registration order is
// unchanged — server.ts's `app.use('/api/v1/properties', propertyRoutes)`
// needed no changes.
const express_1 = require("express");
const crud_1 = __importDefault(require("./properties/crud"));
const workflow_1 = __importDefault(require("./properties/workflow"));
const publications_1 = __importDefault(require("./properties/publications"));
const images_1 = __importDefault(require("./properties/images"));
const pricing_1 = __importDefault(require("./properties/pricing"));
const router = (0, express_1.Router)();
router.use('/', crud_1.default);
router.use('/', workflow_1.default);
router.use('/', publications_1.default);
router.use('/', images_1.default);
router.use('/', pricing_1.default);
exports.default = router;
