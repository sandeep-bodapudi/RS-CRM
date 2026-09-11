"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuthz = void 0;
const authorization_1 = require("../authz/authorization");
const dbPermissions_1 = require("../authz/dbPermissions");
/**
 * requireAuthz Middleware — v2
 * First checks DB-backed permission overrides (takes effect immediately,
 * no re-login needed), then falls back to the static token-based `can()` engine.
 */
const requireAuthz = (action, getResource) => {
    return async (req, res, next) => {
        try {
            if (!req.user) {
                return res.status(401).json({ error: 'Unauthenticated', code: 'UNAUTHORIZED' });
            }
            let resource = undefined;
            if (getResource) {
                resource = await getResource(req);
                if (!resource) {
                    return res.status(404).json({ error: 'Resource not found', code: 'NOT_FOUND' });
                }
            }
            // 1. Check DB-backed permission overrides (grants) — immediate effect
            const dbResult = await (0, dbPermissions_1.checkDbPermission)(req.user, action);
            if (dbResult === true) {
                return next();
            }
            // 2. Fall back to static token-based authorization
            const isAuthorized = (0, authorization_1.can)(req.user, action, resource);
            if (!isAuthorized) {
                return res.status(403).json({ error: 'Forbidden: Insufficient access or out of scope', code: 'FORBIDDEN' });
            }
            if (resource) {
                req.authorizedResource = resource;
            }
            next();
        }
        catch (err) {
            next(err);
        }
    };
};
exports.requireAuthz = requireAuthz;
