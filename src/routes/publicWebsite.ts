import { logger } from '../utils/logger';
import { Router, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { correlationId } from '../middleware/correlationId';
import { publicReadLimiter, publicWriteLimiter } from '../middleware/rateLimiter';
import { authenticatePublicKey } from '../middleware/publicApiKey';
import { requireWebsiteAccount, optionalWebsiteAccount } from '../middleware/websiteAuth';
import { validateRequestBody } from '../middleware/validate';
import {
  WebsiteAccountRegisterSchema,
  WebsiteAccountLoginSchema,
  WebsiteSavedItemSchema,
  WebsiteActivityTrackSchema,
} from '../shared';
import { WebsiteAccountService } from '../services/website/account.service';
import { WebsiteSavedItemsService } from '../services/website/savedItems.service';
import { WebsiteActivityService } from '../services/website/activity.service';
import { PUBLIC_PROPERTY_SELECT } from './public';
import { toSearchCandidate } from '../services/search/dto';
import { rankProperties } from '../services/search/engine';
import { determineEmptyState } from '../services/search/emptyState';
import { buildRecommendations } from '../services/search/recommendations';
import { parseNaturalLanguageQuery } from '../services/search/aiParse';

const router = Router();
const p = prisma;

router.use(correlationId);
router.use(publicReadLimiter);
router.use(authenticatePublicKey);

function validBrand(brand: string) {
  return brand.toLowerCase() === 'rrh' || brand.toLowerCase() === 'sonthillu';
}

// ─── Account: register / login / me ─────────────────────────────────────────

router.post('/:brand/account/register', publicWriteLimiter, validateRequestBody(WebsiteAccountRegisterSchema), async (req: any, res: Response) => {
  try {
    if (!validBrand(req.params.brand)) return res.status(400).json({ error: 'Invalid brand specified in URL' });
    const result = await WebsiteAccountService.register(req.apiKeyContext.company_id, req.body);
    res.status(201).json(result);
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    logger.error('Website account register error:', error);
    res.status(500).json({ error: 'Failed to register account' });
  }
});

router.post('/:brand/account/login', publicWriteLimiter, validateRequestBody(WebsiteAccountLoginSchema), async (req: any, res: Response) => {
  try {
    if (!validBrand(req.params.brand)) return res.status(400).json({ error: 'Invalid brand specified in URL' });
    const result = await WebsiteAccountService.login(req.apiKeyContext.company_id, req.body);
    res.status(200).json(result);
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    logger.error('Website account login error:', error);
    res.status(500).json({ error: 'Failed to log in' });
  }
});

router.get('/:brand/account/me', requireWebsiteAccount, async (req: any, res: Response) => {
  if (!validBrand(req.params.brand)) return res.status(400).json({ error: 'Invalid brand specified in URL' });
  res.status(200).json({ account: WebsiteAccountService.me(req.websiteAccount) });
});

// ─── Shortlist / Compare ─────────────────────────────────────────────────────

function savedItemRoutes(kind: 'shortlist' | 'compare') {
  router.get(`/:brand/account/${kind}`, requireWebsiteAccount, async (req: any, res: Response) => {
    if (!validBrand(req.params.brand)) return res.status(400).json({ error: 'Invalid brand specified in URL' });
    const items = await WebsiteSavedItemsService.list(req.websiteAccount.id, kind);
    res.status(200).json({ items });
  });

  router.post(`/:brand/account/${kind}`, requireWebsiteAccount, validateRequestBody(WebsiteSavedItemSchema), async (req: any, res: Response) => {
    if (!validBrand(req.params.brand)) return res.status(400).json({ error: 'Invalid brand specified in URL' });
    const item = await WebsiteSavedItemsService.add(req.websiteAccount.id, kind, req.body);
    res.status(201).json({ item });
  });

  router.delete(`/:brand/account/${kind}`, requireWebsiteAccount, validateRequestBody(WebsiteSavedItemSchema), async (req: any, res: Response) => {
    if (!validBrand(req.params.brand)) return res.status(400).json({ error: 'Invalid brand specified in URL' });
    const result = await WebsiteSavedItemsService.remove(req.websiteAccount.id, kind, req.body);
    res.status(200).json(result);
  });
}
savedItemRoutes('shortlist');
savedItemRoutes('compare');

// ─── Activity tracking ───────────────────────────────────────────────────────

router.post('/:brand/activity/track', publicWriteLimiter, optionalWebsiteAccount, validateRequestBody(WebsiteActivityTrackSchema), async (req: any, res: Response) => {
  if (!validBrand(req.params.brand)) return res.status(400).json({ error: 'Invalid brand specified in URL' });
  // Never fails the caller — see WebsiteActivityService.track.
  await WebsiteActivityService.track(req.apiKeyContext.company_id, req.websiteAccount?.id ?? null, req.body);
  res.status(200).json({ tracked: true });
});

// ─── AI-powered search ───────────────────────────────────────────────────────

router.post('/:brand/search/parse', publicWriteLimiter, async (req: any, res: Response) => {
  try {
    if (!validBrand(req.params.brand)) return res.status(400).json({ error: 'Invalid brand specified in URL' });
    const { query } = req.body || {};
    if (!query || typeof query !== 'string') return res.status(400).json({ error: 'Query string is required' });
    const parsed = await parseNaturalLanguageQuery(query);
    res.status(200).json(parsed);
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    logger.error('AI search parse error:', error);
    res.status(500).json({ error: 'Failed to parse query' });
  }
});

router.get('/:brand/search', optionalWebsiteAccount, async (req: any, res: Response) => {
  try {
    if (!validBrand(req.params.brand)) return res.status(400).json({ error: 'Invalid brand specified in URL' });
    const companyId = req.apiKeyContext.company_id as number;
    const { location, propertyType, listingType, minBudget, maxBudget, possessionStatus, bedrooms, sortBy, anonId } = req.query as Record<string, string | undefined>;

    const query = {
      location: location || undefined,
      propertyType: propertyType || undefined,
      listingType: listingType && listingType !== 'ANY' ? listingType : undefined,
      minBudget: minBudget ? Number(minBudget) : undefined,
      maxBudget: maxBudget ? Number(maxBudget) : undefined,
      possessionStatus: possessionStatus && possessionStatus !== 'ANY' ? possessionStatus : undefined,
    };
    const bedroomsNum = bedrooms ? Number(bedrooms) : undefined;
    const isRelevance = !sortBy || sortBy === 'relevance';

    const publishedIds = await p.propertyPublication.findMany({
      where: { company_id: companyId, is_published: true },
      select: { property_id: true },
    });
    const propertyIds = publishedIds.map((pp) => pp.property_id);

    let primaryError = false;
    let rawProperties: any[] = [];
    if (propertyIds.length > 0) {
      try {
        const where: Prisma.PropertyWhereInput = {
          id: { in: propertyIds },
          OR: [{ status: 'LIVE' }, { status: 'LOCKED', locked_until: { lt: new Date() } }],
        };
        if (query.location) where.location = { contains: query.location };
        if (query.minBudget !== undefined || query.maxBudget !== undefined) {
          where.final_price = {
            ...(query.minBudget !== undefined ? { gte: query.minBudget } : {}),
            ...(query.maxBudget !== undefined ? { lte: query.maxBudget } : {}),
          };
        }
        if (bedroomsNum !== undefined) where.bedrooms = { gte: bedroomsNum, ...(bedroomsNum < 5 ? { lte: bedroomsNum } : {}) };

        rawProperties = await p.property.findMany({ where, select: PUBLIC_PROPERTY_SELECT, take: 300 });
      } catch (err) {
        logger.error('Search primary fetch error:', err);
        primaryError = true;
      }
    }

    const candidates = rawProperties.map(toSearchCandidate);
    let results = candidates;
    if (isRelevance) {
      results = rankProperties(candidates, query).map((r) => r.property);
    } else if (sortBy === 'price_low') {
      results = [...candidates].sort((a, b) => a.price - b.price);
    } else if (sortBy === 'price_high') {
      results = [...candidates].sort((a, b) => b.price - a.price);
    }

    const accountId = req.websiteAccount?.id ?? null;
    const recentlyViewedIds = await WebsiteActivityService.recentlyViewedIds(companyId, accountId, anonId);

    let recommendationPool: any[] = [];
    if (propertyIds.length > 0) {
      try {
        recommendationPool = await p.property.findMany({
          where: {
            id: { in: propertyIds, notIn: results.map((r) => r.id) },
            OR: [{ status: 'LIVE' }, { status: 'LOCKED', locked_until: { lt: new Date() } }],
          },
          select: PUBLIC_PROPERTY_SELECT,
          take: 50,
        });
      } catch {
        // recommendations are best-effort
      }
    }
    const recommendations = buildRecommendations(
      recommendationPool.map(toSearchCandidate),
      query,
      results.map((r) => r.id),
      recentlyViewedIds,
    );

    let anyPropertiesExist = true;
    if (!primaryError && results.length === 0 && Object.values(query).some((v) => v !== undefined)) {
      anyPropertiesExist = propertyIds.length > 0;
    }
    const { error, isGlobalEmpty } = determineEmptyState(
      Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined)),
      results,
      primaryError,
      anyPropertiesExist,
    );

    res.status(200).json({ properties: results, total: results.length, recommendations, error, isGlobalEmpty });
  } catch (error) {
    logger.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

export default router;
