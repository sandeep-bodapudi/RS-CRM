import { logger } from '../../utils/logger';
import { Router, Response, NextFunction } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../../middleware/auth';
import { requirePermission } from '../../middleware/authz';
import { Permissions } from '../../shared';
import { validateRequestBody } from '../../middleware/validate';
import { DemoService } from '../../services/demo.service';
import { DemoScheduleSchema, DemoAcceptSchema } from '../../shared';

const router = Router();

// GET /api/v1/demos - List demos (for PM's pending demo requests queue)
router.get(
  '/',
  authenticateToken,
  requirePermission([Permissions.DEMOS_READ]),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { status, handler_id, leadId } = req.query;
      const filters = {
        status: status as string,
        handler_id: handler_id as string,
        leadId: leadId as string,
      };
      const demos = await DemoService.listDemos(req.user!, filters);
      return res.status(200).json({ demos });
    } catch (error: any) {
      logger.error('Fetch demos error:', error);
      next(error);
    }
  }
);

// GET /api/v1/demos/:id - Get single demo
router.get(
  '/:id',
  authenticateToken,
  requirePermission([Permissions.DEMOS_READ]),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const demoId = parseInt(req.params.id, 10);
      if (isNaN(demoId)) return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
      const demo = await DemoService.getDemo(req.user!, demoId);
      return res.status(200).json({ demo });
    } catch (error: any) {
      logger.error('Fetch demo error:', error);
      next(error);
    }
  }
);

// POST /api/v1/demos/:id/accept - Handler accepts the demo (blind approval: reveals customer info)
router.post(
  '/:id/accept',
  authenticateToken,
  requirePermission([Permissions.DEMOS_ACCEPT]),
  validateRequestBody(DemoAcceptSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const demoId = parseInt(req.params.id, 10);
      if (isNaN(demoId)) return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
      const { notes } = req.body;
      const demo = await DemoService.acceptDemo(req.user!, demoId, notes);
      return res.status(200).json({
        message: `Demo ${demo.id} accepted! Customer details are now visible.`,
        demo,
      });
    } catch (error: any) {
      logger.error('Accept demo error:', error);
      next(error);
    }
  }
);

// POST /api/v1/demos/:id/decline - Handler declines the demo
router.post(
  '/:id/decline',
  authenticateToken,
  requirePermission([Permissions.DEMOS_ACCEPT]),
  validateRequestBody(DemoAcceptSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const demoId = parseInt(req.params.id, 10);
      if (isNaN(demoId)) return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
      const { notes } = req.body;
      const demo = await DemoService.declineDemo(req.user!, demoId, notes);
      return res.status(200).json({
        message: `Demo ${demo.id} declined.`,
        demo,
      });
    } catch (error: any) {
      logger.error('Decline demo error:', error);
      next(error);
    }
  }
);

// POST /api/v1/demos/:id/complete - Handler completes the demo
router.post(
  '/:id/complete',
  authenticateToken,
  requirePermission([Permissions.DEMOS_COMPLETE]),
  validateRequestBody(DemoAcceptSchema), // Reuse schema since it just takes optional notes
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const demoId = parseInt(req.params.id, 10);
      if (isNaN(demoId)) return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
      const { notes } = req.body;
      const demo = await DemoService.completeDemo(req.user!, demoId, notes);
      return res.status(200).json({
        message: `Demo ${demo.id} marked as completed.`,
        demo,
      });
    } catch (error: any) {
      logger.error('Complete demo error:', error);
      next(error);
    }
  }
);

// POST /api/v1/demos/:id/cancel - Handler cancels the demo
router.post(
  '/:id/cancel',
  authenticateToken,
  requirePermission([Permissions.DEMOS_COMPLETE]),
  validateRequestBody(DemoAcceptSchema), // Reuse schema
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const demoId = parseInt(req.params.id, 10);
      if (isNaN(demoId)) return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
      const { notes } = req.body;
      const demo = await DemoService.cancelDemo(req.user!, demoId, notes);
      return res.status(200).json({
        message: `Demo ${demo.id} cancelled.`,
        demo,
      });
    } catch (error: any) {
      logger.error('Cancel demo error:', error);
      next(error);
    }
  }
);

// POST /api/v1/demos/:id/reassign - Route demo to a different handler
router.post(
  '/:id/reassign',
  authenticateToken,
  requirePermission([Permissions.DEMOS_ASSIGN_AGENT]),
  validateRequestBody(DemoAcceptSchema), // Reuse schema — body: { handler_id, reason }
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const demoId = parseInt(req.params.id, 10);
      if (isNaN(demoId)) return next({ name: 'AppError', statusCode: 400, message: 'Invalid ID format' });
      const { handler_id, reason } = req.body;
      const demo = await DemoService.reassignDemo(req.user!, demoId, handler_id, reason);
      return res.status(200).json({
        message: `Demo ${demo.id} reassigned to handler ${demo.handler_id}.`,
        demo,
      });
    } catch (error: any) {
      logger.error('Reassign demo error:', error);
      next(error);
    }
  }
);

export default router;