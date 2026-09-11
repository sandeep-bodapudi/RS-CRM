"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.determineEmptyState = void 0;
function determineEmptyState(primaryFilters, publicProperties, primaryError, anyPropertiesExist) {
    const hasFilters = Object.keys(primaryFilters).length > 0;
    let isGlobalEmpty = false;
    if (!primaryError && publicProperties.length === 0) {
        if (!hasFilters) {
            isGlobalEmpty = true;
        }
        else if (!anyPropertiesExist) {
            isGlobalEmpty = true;
        }
    }
    const error = primaryError ? 'SEARCH_UNAVAILABLE' : null;
    return { error, isGlobalEmpty };
}
exports.determineEmptyState = determineEmptyState;
