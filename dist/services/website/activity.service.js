"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebsiteActivityService = void 0;
const prisma_1 = require("../../lib/prisma");
const p = prisma_1.prisma;
class WebsiteActivityService {
    /** Never throws to the caller — client-side tracking must never block the
     * UI (same rule the BFF's own /analytics/track endpoint followed). */
    static async track(companyId, accountId, data) {
        try {
            await p.websiteActivityEvent.create({
                data: {
                    company_id: companyId,
                    account_id: accountId,
                    anonymous_id: accountId ? null : data.anonymous_id || null,
                    event_name: data.event_name,
                    page: data.page || null,
                    property_id: data.property_id || null,
                    project_id: data.project_id || null,
                    search_context: data.search_context || undefined,
                    metadata: data.metadata || undefined,
                },
            });
        }
        catch {
            // swallow — tracking is best-effort
        }
    }
    /** Behavioral signals for the recommendation engine: which property/project
     * ids this visitor has recently viewed, so those get excluded from (or
     * used to seed) their recommendations. Looks up by account when logged in,
     * else by the client-supplied anonymous id. */
    static async recentlyViewedIds(companyId, accountId, anonymousId) {
        if (!accountId && !anonymousId)
            return [];
        const events = await p.websiteActivityEvent.findMany({
            where: {
                company_id: companyId,
                ...(accountId ? { account_id: accountId } : { anonymous_id: anonymousId }),
                event_name: { in: ['property_viewed', 'project_viewed'] },
                created_at: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
            },
            select: { property_id: true, project_id: true },
            orderBy: { created_at: 'desc' },
            take: 50,
        });
        const ids = new Set();
        for (const e of events) {
            if (e.property_id)
                ids.add(e.property_id);
            if (e.project_id)
                ids.add(e.project_id);
        }
        return Array.from(ids);
    }
}
exports.WebsiteActivityService = WebsiteActivityService;
