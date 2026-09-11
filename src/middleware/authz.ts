import { Request, Response, NextFunction } from 'express';
import { can } from '../authz/authorization';
import { checkDbPermission } from '../authz/dbPermissions';
import { AuthenticatedRequest } from './auth';
import { Permission } from '../shared';

/**
 * requireAuthz Middleware — v2
 * First checks DB-backed permission overrides (takes effect immediately,
 * no re-login needed), then falls back to the static token-based `can()` engine.
 */
export const requireAuthz = (
  action: Permission,
  getResource?: (req: AuthenticatedRequest) => Promise<any>,
) => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
      const dbResult = await checkDbPermission(req.user, action);
      if (dbResult === true) {
        return next();
      }

      // 2. Fall back to static token-based authorization
      const isAuthorized = can(req.user, action, resource);
      if (!isAuthorized) {
        return res
          .status(403)
          .json({ error: 'Forbidden: Insufficient access or out of scope', code: 'FORBIDDEN' });
      }

      if (resource) {
        (req as any).authorizedResource = resource;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};
