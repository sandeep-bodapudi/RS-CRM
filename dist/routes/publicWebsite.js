"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("../utils/logger");
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
const correlationId_1 = require("../middleware/correlationId");
const rateLimiter_1 = require("../middleware/rateLimiter");
const publicApiKey_1 = require("../middleware/publicApiKey");
const websiteAuth_1 = require("../middleware/websiteAuth");
const validate_1 = require("../middleware/validate");
const shared_1 = require("../shared");
const account_service_1 = require("../services/website/account.service");
const savedItems_service_1 = require("../services/website/savedItems.service");
const activity_service_1 = require("../services/website/activity.service");
const public_1 = require("./public");
const dto_1 = require("../services/search/dto");
const engine_1 = require("../services/search/engine");
const emptyState_1 = require("../services/search/emptyState");
const recommendations_1 = require("../services/search/recommendations");
const aiParse_1 = require("../services/search/aiParse");
const router = (0, express_1.Router)();
const p = prisma_1.prisma;
router.use(correlationId_1.correlationId);
router.use(rateLimiter_1.publicReadLimiter);
router.use(publicApiKey_1.authenticatePublicKey);
function validBrand(brand) {
    return brand.toLowerCase() === 'rrh' || brand.toLowerCase() === 'sonthillu';
}
// ─── Account: register / login / me ─────────────────────────────────────────
router.post('/:brand/account/register', rateLimiter_1.publicWriteLimiter, (0, validate_1.validateRequestBody)(shared_1.WebsiteAccountRegisterSchema), async (req, res) => {
    try {
        if (!validBrand(req.params.brand))
            return res.status(400).json({ error: 'Invalid brand specified in URL' });
        const result = await account_service_1.WebsiteAccountService.register(req.apiKeyContext.company_id, req.body);
        res.status(201).json(result);
    }
    catch (error) {
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        logger_1.logger.error('Website account register error:', error);
        res.status(500).json({ error: 'Failed to register account' });
    }
});
router.post('/:brand/account/login', rateLimiter_1.publicWriteLimiter, (0, validate_1.validateRequestBody)(shared_1.WebsiteAccountLoginSchema), async (req, res) => {
    try {
        if (!validBrand(req.params.brand))
            return res.status(400).json({ error: 'Invalid brand specified in URL' });
        const result = await account_service_1.WebsiteAccountService.login(req.apiKeyContext.company_id, req.body);
        res.status(200).json(result);
    }
    catch (error) {
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        logger_1.logger.error('Website account login error:', error);
        res.status(500).json({ error: 'Failed to log in' });
    }
});
router.get('/:brand/account/me', websiteAuth_1.requireWebsiteAccount, async (req, res) => {
    if (!validBrand(req.params.brand))
        return res.status(400).json({ error: 'Invalid brand specified in URL' });
    res.status(200).json({ account: account_service_1.WebsiteAccountService.me(req.websiteAccount) });
});
// ─── Shortlist / Compare ─────────────────────────────────────────────────────
function savedItemRoutes(kind) {
    router.get(`/:brand/account/${kind}`, websiteAuth_1.requireWebsiteAccount, async (req, res) => {
        if (!validBrand(req.params.brand))
            return res.status(400).json({ error: 'Invalid brand specified in URL' });
        const items = await savedItems_service_1.WebsiteSavedItemsService.list(req.websiteAccount.id, kind);
        res.status(200).json({ items });
    });
    router.post(`/:brand/account/${kind}`, websiteAuth_1.requireWebsiteAccount, (0, validate_1.validateRequestBody)(shared_1.WebsiteSavedItemSchema), async (req, res) => {
        if (!validBrand(req.params.brand))
            return res.status(400).json({ error: 'Invalid brand specified in URL' });
        const item = await savedItems_service_1.WebsiteSavedItemsService.add(req.websiteAccount.id, kind, req.body);
        res.status(201).json({ item });
    });
    router.delete(`/:brand/account/${kind}`, websiteAuth_1.requireWebsiteAccount, (0, validate_1.validateRequestBody)(shared_1.WebsiteSavedItemSchema), async (req, res) => {
        if (!validBrand(req.params.brand))
            return res.status(400).json({ error: 'Invalid brand specified in URL' });
        const result = await savedItems_service_1.WebsiteSavedItemsService.remove(req.websiteAccount.id, kind, req.body);
        res.status(200).json(result);
    });
}
savedItemRoutes('shortlist');
savedItemRoutes('compare');
// ─── Activity tracking ───────────────────────────────────────────────────────
router.post('/:brand/activity/track', rateLimiter_1.publicWriteLimiter, websiteAuth_1.optionalWebsiteAccount, (0, validate_1.validateRequestBody)(shared_1.WebsiteActivityTrackSchema), async (req, res) => {
    if (!validBrand(req.params.brand))
        return res.status(400).json({ error: 'Invalid brand specified in URL' });
    // Never fails the caller — see WebsiteActivityService.track.
    await activity_service_1.WebsiteActivityService.track(req.apiKeyContext.company_id, req.websiteAccount?.id ?? null, req.body);
    res.status(200).json({ tracked: true });
});
// ─── AI-powered search ───────────────────────────────────────────────────────
router.post('/:brand/search/parse', rateLimiter_1.publicWriteLimiter, async (req, res) => {
    try {
        if (!validBrand(req.params.brand))
            return res.status(400).json({ error: 'Invalid brand specified in URL' });
        const { query } = req.body || {};
        if (!query || typeof query !== 'string')
            return res.status(400).json({ error: 'Query string is required' });
        const parsed = await (0, aiParse_1.parseNaturalLanguageQuery)(query);
        res.status(200).json(parsed);
    }
    catch (error) {
        if (error.status)
            return res.status(error.status).json({ error: error.message });
        logger_1.logger.error('AI search parse error:', error);
        res.status(500).json({ error: 'Failed to parse query' });
    }
});
router.get('/:brand/search', websiteAuth_1.optionalWebsiteAccount, async (req, res) => {
    try {
        if (!validBrand(req.params.brand))
            return res.status(400).json({ error: 'Invalid brand specified in URL' });
        const companyId = req.apiKeyContext.company_id;
        const { location, propertyType, listingType, minBudget, maxBudget, possessionStatus, bedrooms, sortBy, anonId, } = req.query;
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
        let rawProperties = [];
        if (propertyIds.length > 0) {
            try {
                const where = {
                    id: { in: propertyIds },
                    OR: [{ status: 'LIVE' }, { status: 'LOCKED', locked_until: { lt: new Date() } }],
                };
                if (query.location)
                    where.location = { contains: query.location };
                if (query.minBudget !== undefined || query.maxBudget !== undefined) {
                    where.final_price = {
                        ...(query.minBudget !== undefined ? { gte: query.minBudget } : {}),
                        ...(query.maxBudget !== undefined ? { lte: query.maxBudget } : {}),
                    };
                }
                if (bedroomsNum !== undefined)
                    where.bedrooms = { gte: bedroomsNum, ...(bedroomsNum < 5 ? { lte: bedroomsNum } : {}) };
                rawProperties = await p.property.findMany({
                    where,
                    select: public_1.PUBLIC_PROPERTY_SELECT,
                    take: 300,
                });
            }
            catch (err) {
                logger_1.logger.error('Search primary fetch error:', err);
                primaryError = true;
            }
        }
        const candidates = rawProperties.map(dto_1.toSearchCandidate);
        let results = candidates;
        if (isRelevance) {
            results = (0, engine_1.rankProperties)(candidates, query).map((r) => r.property);
        }
        else if (sortBy === 'price_low') {
            results = [...candidates].sort((a, b) => a.price - b.price);
        }
        else if (sortBy === 'price_high') {
            results = [...candidates].sort((a, b) => b.price - a.price);
        }
        const accountId = req.websiteAccount?.id ?? null;
        const recentlyViewedIds = await activity_service_1.WebsiteActivityService.recentlyViewedIds(companyId, accountId, anonId);
        let recommendationPool = [];
        if (propertyIds.length > 0) {
            try {
                recommendationPool = await p.property.findMany({
                    where: {
                        id: { in: propertyIds, notIn: results.map((r) => r.id) },
                        OR: [{ status: 'LIVE' }, { status: 'LOCKED', locked_until: { lt: new Date() } }],
                    },
                    select: public_1.PUBLIC_PROPERTY_SELECT,
                    take: 50,
                });
            }
            catch {
                // recommendations are best-effort
            }
        }
        const recommendations = (0, recommendations_1.buildRecommendations)(recommendationPool.map(dto_1.toSearchCandidate), query, results.map((r) => r.id), recentlyViewedIds);
        let anyPropertiesExist = true;
        if (!primaryError &&
            results.length === 0 &&
            Object.values(query).some((v) => v !== undefined)) {
            anyPropertiesExist = propertyIds.length > 0;
        }
        const { error, isGlobalEmpty } = (0, emptyState_1.determineEmptyState)(Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined)), results, primaryError, anyPropertiesExist);
        res
            .status(200)
            .json({ properties: results, total: results.length, recommendations, error, isGlobalEmpty });
    }
    catch (error) {
        logger_1.logger.error('Search error:', error);
        res.status(500).json({ error: 'Search failed' });
    }
});
exports.default = router;
