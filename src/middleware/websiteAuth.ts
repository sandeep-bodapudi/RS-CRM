import { Response, NextFunction } from 'express';
import { verifyWebsiteAccessToken, WebsiteTokenPayload } from '../utils/websiteJwt';
import { prisma } from '../lib/prisma';

const p = prisma;

function extractToken(req: any): string | null {
  const header = req.header('authorization') || req.header('Authorization');
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

/** Attaches req.websiteAccount when a valid, current (token_version-matching)
 * bearer token is present; 401s otherwise. Bearer token in localStorage, not
 * a cookie — the frontend is a cross-origin static export, so cookie
 * SameSite/CORS-credential handling would be unnecessary complexity here. */
export async function requireWebsiteAccount(req: any, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });

  let payload: WebsiteTokenPayload;
  try {
    payload = verifyWebsiteAccessToken(token);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const account = await p.websiteAccount.findUnique({ where: { id: payload.accountId } });
  if (!account || account.token_version !== payload.tokenVersion) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  if (account.company_id !== req.apiKeyContext?.company_id) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.websiteAccount = account;
  next();
}

/** Same verification, but a missing/invalid token is not an error — used by
 * endpoints (search, activity tracking) that personalize for logged-in
 * visitors but work fine for anonymous ones too. */
export async function optionalWebsiteAccount(req: any, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) return next();

  try {
    const payload = verifyWebsiteAccessToken(token);
    const account = await p.websiteAccount.findUnique({ where: { id: payload.accountId } });
    if (account && account.token_version === payload.tokenVersion && account.company_id === req.apiKeyContext?.company_id) {
      req.websiteAccount = account;
    }
  } catch {
    // Not logged in / expired token — proceed as a guest.
  }
  next();
}
