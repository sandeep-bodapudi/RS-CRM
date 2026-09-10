import { logger } from '../utils/logger';
import { Response } from 'express';
import { prisma } from '../lib/prisma';

const p = prisma;

/** Extracted from routes/public.ts so the new public-website route files
 * (account/search/activity) can share the same API-key gate instead of
 * duplicating it. */
export const authenticatePublicKey = async (req: any, res: Response, next: any) => {
  const apiKey = req.header('x-api-key');
  if (!apiKey) {
    return res.status(401).json({ error: 'API Key missing' });
  }

  try {
    const validKey = await p.publicApiKey.findUnique({
      where: { api_key: apiKey },
      include: { company: true },
    });

    if (!validKey || !validKey.is_active) {
      return res.status(401).json({ error: 'Invalid or inactive API Key' });
    }

    req.apiKeyContext = validKey;
    next();
  } catch (err) {
    logger.error('API Key Auth error:', err);
    res.status(500).json({ error: 'Internal server error during authentication' });
  }
};
