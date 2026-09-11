"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Phase 4.4 (2026-09-07): split from a single 1028-line file into
// single-responsibility route modules under ./attendance/, composed here at
// the same base path ('/') so every URL, method, and registration order is
// unchanged — server.ts's mount needed no changes.
const express_1 = require("express");
const qr_1 = __importDefault(require("./attendance/qr"));
const proposals_1 = __importDefault(require("./attendance/proposals"));
const reports_1 = __importDefault(require("./attendance/reports"));
const holidays_calendar_1 = __importDefault(require("./attendance/holidays-calendar"));
const router = (0, express_1.Router)();
router.use('/', qr_1.default);
router.use('/', proposals_1.default);
router.use('/', reports_1.default);
router.use('/', holidays_calendar_1.default);
exports.default = router;
