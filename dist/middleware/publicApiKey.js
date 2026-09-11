"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticatePublicKey = void 0;
const logger_1 = require("../utils/logger");
const prisma_1 = require("../lib/prisma");
const p = prisma_1.prisma;
/** Extracted from routes/public.ts so the new public-website route files
 * (account/search/activity) can share the same API-key gate instead of
 * duplicating it. */
const authenticatePublicKey = async (req, res, next) => {
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
    }
    catch (err) {
        logger_1.logger.error('API Key Auth error:', err);
        res.status(500).json({ error: 'Internal server error during authentication' });
    }
};
exports.authenticatePublicKey = authenticatePublicKey;
