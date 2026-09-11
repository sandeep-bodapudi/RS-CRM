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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
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
const logger_1 = require("../utils/logger");
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const rateLimiter_1 = require("../middleware/rateLimiter");
const FeedbackService = __importStar(require("../services/feedback.service"));
const router = (0, express_1.Router)();
router.get('/team', auth_1.authenticateToken, async (req, res) => {
    try {
        const items = await FeedbackService.listFeedback({
            employeeId: req.user.employeeId,
            roles: req.user.roles || [],
            companyId: req.user.companyId,
        });
        res.status(200).json({ items });
    }
    catch (error) {
        logger_1.logger.error('Feedback list error:', error);
        res.status(500).json({ error: 'Failed to fetch feedback' });
    }
});
router.get('/:token', rateLimiter_1.feedbackRateLimiter, async (req, res) => {
    try {
        const info = await FeedbackService.getPublicFeedbackInfo(req.params.token);
        res.status(200).json(info);
    }
    catch (error) {
        logger_1.logger.error('Public feedback info error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        res.status(500).json({ error: 'Failed to load feedback form' });
    }
});
router.post('/:token', rateLimiter_1.feedbackRateLimiter, async (req, res) => {
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
    }
    catch (error) {
        logger_1.logger.error('Feedback submission error:', error);
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        res.status(500).json({ error: 'Failed to submit feedback' });
    }
});
exports.default = router;
