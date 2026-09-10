/**
 * § Phase 7 — Customer feedback for a completed site visit.
 *
 * GET/POST /:token are deliberately UNAUTHENTICATED: the customer reaches
 * this via a WhatsApp link with no CRM account of their own. The token is a
 * random UUID whose hash is the only thing stored (see feedback.service.ts),
 * so knowing it is the entire security boundary — same "unauthenticated but
 * rate-limited" shape as the app-lock unlock endpoints (routes/webauthn.ts).
 *
 * GET /team is the authenticated side: a manager or MD viewing feedback for
 * people who report to them.
 */
import { logger } from '../utils/logger';
import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { feedbackRateLimiter } from '../middleware/rateLimiter';
import * as FeedbackService from '../services/feedback.service';

const router = Router();

router.get('/team', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const items = await FeedbackService.listFeedback({
      employeeId: req.user!.employeeId,
      roles: req.user!.roles || [],
      companyId: req.user!.companyId,
    });
    res.status(200).json({ items });
  } catch (error: any) {
    logger.error('Feedback list error:', error);
    res.status(500).json({ error: 'Failed to fetch feedback' });
  }
});

router.get('/:token', feedbackRateLimiter, async (req, res: Response) => {
  try {
    const info = await FeedbackService.getPublicFeedbackInfo(req.params.token);
    res.status(200).json(info);
  } catch (error: any) {
    logger.error('Public feedback info error:', error);
    if (error.status) return res.status(error.status).json({ error: error.message });
    res.status(500).json({ error: 'Failed to load feedback form' });
  }
});

router.post('/:token', feedbackRateLimiter, async (req, res: Response) => {
  try {
    const { rating, onTime, answeredQuestions, propertyAsDescribed, comment } = req.body || {};
    await FeedbackService.submitFeedback(req.params.token, {
      rating: Number(rating),
      onTime: !!onTime,
      answeredQuestions: !!answeredQuestions,
      propertyAsDescribed: !!propertyAsDescribed,
      comment: typeof comment === 'string' ? comment.slice(0, 2000) : undefined,
    });
    res.status(200).json({ message: 'Thank you for your feedback!' });
  } catch (error: any) {
    logger.error('Feedback submission error:', error);
    if (error.status) return res.status(error.status).json({ error: error.message });
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

export default router;
