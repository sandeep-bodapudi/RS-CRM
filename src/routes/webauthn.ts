/**
 * § Phase 6 — App Lock (WebAuthn) routes.
 *
 * Registration endpoints require an active session (you set up a lock
 * device while already logged in). The unlock endpoints are deliberately
 * UNAUTHENTICATED: the whole point of the app-lock screen is that it runs
 * when there is NO valid access token in memory (see AuthContext.tsx —
 * locking clears the in-memory token), so there is no Bearer token to check
 * here. The employee is identified by a plain `employeeId` in the body
 * (not a secret — it's already visible in the saved profile the frontend
 * keeps in localStorage even while locked) and the actual security boundary
 * is the WebAuthn signature itself: producing a valid assertion requires the
 * physical authenticator tied to that credential, so knowing someone's
 * employeeId alone proves nothing and grants nothing. Heavily rate-limited
 * per IP regardless (see appLockRateLimiter).
 */
import { logger } from '../utils/logger';
import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { appLockRateLimiter } from '../middleware/rateLimiter';
import { prisma } from '../lib/prisma';
import { WebAuthnService } from '../services/webauthn.service';

const router = Router();
const p = prisma;

// ── Registration (requires an active session) ──────────────────────────────

router.get('/status', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const credentials = await WebAuthnService.listCredentials(req.user!.employeeId);
    res.status(200).json({ enabled: credentials.length > 0, credentials });
  } catch (error: any) {
    logger.error('App-lock status error:', error);
    res.status(500).json({ error: 'Failed to fetch app-lock status' });
  }
});

router.post('/register-options', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const employee = await p.employee.findUnique({ where: { id: req.user!.employeeId }, select: { full_name: true, employee_code: true } });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    const options = await WebAuthnService.startRegistration(req.user!.employeeId, employee.full_name || employee.employee_code);
    res.status(200).json(options);
  } catch (error: any) {
    logger.error('App-lock register-options error:', error);
    if (error.status) return res.status(error.status).json({ error: error.message });
    res.status(500).json({ error: 'Failed to start device registration' });
  }
});

router.post('/register-verify', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { response, deviceLabel } = req.body;
    if (!response) return res.status(400).json({ error: 'Missing WebAuthn response' });
    const result = await WebAuthnService.finishRegistration(req.user!.employeeId, response, deviceLabel);
    res.status(200).json(result);
  } catch (error: any) {
    logger.error('App-lock register-verify error:', error);
    if (error.status) return res.status(error.status).json({ error: error.message });
    res.status(500).json({ error: 'Failed to verify device registration' });
  }
});

router.delete('/credentials/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const credentialId = parseInt(req.params.id, 10);
    const result = await WebAuthnService.deleteCredential(req.user!.employeeId, credentialId);
    res.status(200).json(result);
  } catch (error: any) {
    logger.error('App-lock delete-credential error:', error);
    if (error.status) return res.status(error.status).json({ error: error.message });
    res.status(500).json({ error: 'Failed to remove device' });
  }
});

// ── Unlock (unauthenticated by design — see file header) ───────────────────

router.post('/unlock-options', appLockRateLimiter, async (req, res: Response) => {
  try {
    const employeeId = parseInt(req.body?.employeeId, 10);
    if (!employeeId) return res.status(400).json({ error: 'Missing employeeId' });

    const employee = await p.employee.findFirst({ where: { id: employeeId, status: 'ACTIVE' }, select: { id: true } });
    if (!employee) return res.status(404).json({ error: 'No active app-lock device for this account' });

    const options = await WebAuthnService.startAuthentication(employeeId);
    res.status(200).json(options);
  } catch (error: any) {
    logger.error('App-lock unlock-options error:', error);
    if (error.status) return res.status(error.status).json({ error: error.message });
    res.status(500).json({ error: 'Failed to start unlock' });
  }
});

router.post('/unlock-verify', appLockRateLimiter, async (req, res: Response) => {
  try {
    const employeeId = parseInt(req.body?.employeeId, 10);
    const { response } = req.body;
    if (!employeeId || !response) return res.status(400).json({ error: 'Missing employeeId or response' });

    const employee = await p.employee.findFirst({ where: { id: employeeId, status: 'ACTIVE' } });
    if (!employee) return res.status(404).json({ error: 'Account not found or inactive' });

    const result = await WebAuthnService.finishAuthentication(employeeId, response);
    res.status(200).json(result);
  } catch (error: any) {
    logger.error('App-lock unlock-verify error:', error);
    if (error.status) return res.status(error.status).json({ error: error.message });
    res.status(500).json({ error: 'Failed to verify unlock' });
  }
});

export default router;
