"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Phase 4.4 (2026-09-07): split from a single 991-line file into
// single-responsibility route modules under ./employees/, composed here at
// the same base path ('/') so every URL, method, and registration order is
// unchanged — server.ts's mount needed no changes.
const express_1 = require("express");
const self_1 = __importDefault(require("./employees/self"));
const list_1 = __importDefault(require("./employees/list"));
const create_1 = __importDefault(require("./employees/create"));
const update_1 = __importDefault(require("./employees/update"));
const admin_actions_1 = __importDefault(require("./employees/admin-actions"));
const lifecycle_1 = __importDefault(require("./employees/lifecycle"));
const router = (0, express_1.Router)();
router.use('/', self_1.default);
router.use('/', list_1.default);
router.use('/', create_1.default);
router.use('/', update_1.default);
router.use('/', admin_actions_1.default);
router.use('/', lifecycle_1.default);
exports.default = router;
