import { logger } from '../utils/logger';
import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { requireAuthz } from '../middleware/authz';
import { Permissions } from '../shared';
import AnalyticsService from '../services/analytics.service';

const router = Router();

/**
 * GET /api/v1/analytics/kpis
 *
 * Unified, company-isolated analytics KPI dashboard (Phase 16, Packet B).
 *
 * Authorization:
 *  - Authenticated via the user JWT (authenticateToken).
 *  - Authorized with the EXISTING Permission.ADMIN_SYSTEM_METRICS, the same
 *    boundary already used by /md/executive-metrics and /integration/metrics for
 *    aggregate metrics. No new permission is introduced.
 *
 * Company isolation (non-negotiable):
 *  - companyId is derived ONLY from the authenticated user
 *    (req.user.companyId). It is NEVER read from query/body/params, so the
 *    client cannot override tenant scope or read another company's KPIs.
 *
 * Implementation:
 *  - All KPI math lives in the centralized AnalyticsService. This route only
 *    authenticates, authorizes, resolves the company, and returns the typed
 *    contract.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
router.get(
  '/kpis',
  authenticateToken,
  requireAuthz(Permissions.ADMIN_SYSTEM_METRICS),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const companyId = req.user!.companyId;
      if (!companyId) return res.status(400).json({ error: 'Company context required' });
      const kpis = await AnalyticsService.getKpis(companyId, req.user!);
      return res.status(200).json(kpis);
    } catch (error: any) {
      logger.error('Fetch analytics KPIs error:', error);
      return res.status(500).json({ error: 'Failed to fetch analytics KPIs' });
    }
  }
);
router.get(
  '/sales-manager',
  authenticateToken,
  requireAuthz(Permissions.REPORTS_READ_TEAM),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const companyId = req.user!.companyId;
      if (!companyId) return res.status(400).json({ error: 'Company context required' });
      const dashboardData = await AnalyticsService.getSalesManagerDashboard(companyId, req.user!);
      return res.status(200).json(dashboardData);
    } catch (error: any) {
      logger.error('Fetch sales manager dashboard error:', error);
      return res.status(500).json({ error: 'Failed to fetch sales manager dashboard' });
    }
  }
);

// GET /api/v1/analytics/hr-overview
//
// Real trend data for HRDashboard's Overview tab (Phase-19 audit #7),
// replacing the previously-hardcoded "+3"/"-1"/"+2.1%" trend badges and the
// permanent-status-based "On Leave Today" count.
router.get(
  '/hr-overview',
  authenticateToken,
  requireAuthz(Permissions.EMPLOYEES_READ),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const companyId = req.user!.companyId;
      if (!companyId) return res.status(400).json({ error: 'Company context required' });
      const overview = await AnalyticsService.getHrOverview(companyId);
      return res.status(200).json(overview);
    } catch (error: any) {
      logger.error('Fetch HR overview error:', error);
      return res.status(500).json({ error: 'Failed to fetch HR overview' });
    }
  }
);

export default router;
