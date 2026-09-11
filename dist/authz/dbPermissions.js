"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkDbPermission = exports.setRolePermissionOverrideCacheDirty = void 0;
const shared_1 = require("../shared");
const prisma_1 = require("../lib/prisma");
// ─── DB-Backed Permission Overrides ─────────────────────────────────────────
// In-memory cache of role→permission overrides. Populated on first use and
// invalidated via setRolePermissionOverrideCacheDirty() whenever the admin
// permissions API writes to the DB.
// ─────────────────────────────────────────────────────────────────────────────
let _overrideCache = null;
let _overrideCacheAt = 0;
const _overrideTtlMs = 30000; // 30-second TTL
function setRolePermissionOverrideCacheDirty() {
    _overrideCache = null;
    _overrideCacheAt = 0;
}
exports.setRolePermissionOverrideCacheDirty = setRolePermissionOverrideCacheDirty;
/**
 * Build the full cache of all roles' DB permissions in one query.
 * Returns null on any error (falls back to token-based permissions).
 */
async function buildCache() {
    try {
        const allRolePerms = await prisma_1.prisma.rolePermission.findMany({
            where: {
                permission: { name: { in: Object.values(shared_1.Permissions) } },
            },
            select: {
                role: { select: { name: true } },
                permission: { select: { name: true } },
            },
        });
        const cache = new Map();
        for (const rp of allRolePerms) {
            const roleName = rp.role.name;
            if (!cache.has(roleName)) {
                cache.set(roleName, new Set());
            }
            cache.get(roleName).add(rp.permission.name);
        }
        return cache;
    }
    catch (e) {
        console.error('[Authorization] DB permission lookup failed:', e);
        return null;
    }
}
/**
 * Check if a user's roles have a specific permission in the DB overrides.
 * Returns true if granted via DB, false if explicitly checked and not found,
 * or null if DB data is unavailable (fall back to token-based check).
 */
async function checkDbPermission(user, action) {
    if (!user.roles || user.roles.length === 0)
        return null;
    // Refresh cache if stale or empty
    const now = Date.now();
    if (!_overrideCache || now - _overrideCacheAt >= _overrideTtlMs) {
        _overrideCache = await buildCache();
        _overrideCacheAt = now;
    }
    // If cache build failed, fall back to token-based
    if (!_overrideCache)
        return null;
    // Check if any of the user's roles have this permission in the DB overrides
    for (const roleName of user.roles) {
        const dbPerms = _overrideCache.get(roleName);
        if (dbPerms && dbPerms.has(action)) {
            return true;
        }
    }
    // DB overrides only ADD permissions — if the permission isn't in the DB
    // override list, the role's default (token-baked) permissions still apply.
    // Return null so the caller falls through to the token-based check.
    return null;
}
exports.checkDbPermission = checkDbPermission;
