"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
// Phase 4.4 (2026-09-07): split from a single ~1575-line file into
// single-responsibility modules by domain. This barrel re-exports everything
// under its original name so no import site anywhere in the codebase
// (`from '../shared'`, `from '@rrh-ems/shared'`) needed to change.
__exportStar(require("./auth"), exports);
__exportStar(require("./attendance"), exports);
__exportStar(require("./task"), exports);
__exportStar(require("./lead"), exports);
__exportStar(require("./project"), exports);
__exportStar(require("./property"), exports);
__exportStar(require("./projectUnit"), exports);
__exportStar(require("./amenity"), exports);
__exportStar(require("./expenseRefund"), exports);
__exportStar(require("./customer"), exports);
__exportStar(require("./document"), exports);
__exportStar(require("./portal"), exports);
__exportStar(require("./siteVisit"), exports);
__exportStar(require("./messageTemplate"), exports);
__exportStar(require("./employee"), exports);
__exportStar(require("./websiteAccount"), exports);
