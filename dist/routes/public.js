"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shapePublicProperty = exports.PUBLIC_PROPERTY_SELECT = void 0;
const logger_1 = require("../utils/logger");
const prisma_1 = require("../lib/prisma");
const express_1 = require("express");
const shared_1 = require("../shared");
const validate_1 = require("../middleware/validate");
const rateLimiter_1 = require("../middleware/rateLimiter");
const correlationId_1 = require("../middleware/correlationId");
const publicApiKey_1 = require("../middleware/publicApiKey");
const systemActor_1 = require("../utils/systemActor");
const create_1 = require("../services/lead/create");
const router = (0, express_1.Router)();
const p = prisma_1.prisma;
router.get('/companies', async (req, res) => {
    try {
        const companies = await p.company.findMany({
            select: { id: true, name: true, code: true },
        });
        res.json(companies);
    }
    catch (error) {
        logger_1.logger.error('Failed to fetch companies', error);
        res.status(500).json({ error: 'Failed to fetch companies' });
    }
});
// Public-safe property allowlist (WR-1/WR-2/WR-3/WR-6)
exports.PUBLIC_PROPERTY_SELECT = {
    id: true,
    property_code: true,
    title: true,
    description: true,
    category: true,
    // § Phase 3: Property.price (manually-typed) was removed — final_price is
    // now the only authoritative price. Renamed back to `price` in the JSON
    // response so this public API contract doesn't change for Sonthillu/Radha.
    final_price: true,
    area_sqft: true,
    location: true,
    address: true,
    bedrooms: true,
    bathrooms: true,
    facing: true,
    amenities: true,
    possession_status: true,
    pricing: true,
    plot_details: true,
    apartment_details: true,
    // Rebuild Phase 7: the 5 category-specific detail tables added alongside
    // plot_details/apartment_details (property details.md spec) — without
    // these, a public Villa/House/Commercial Shop/Commercial Office/Farm Land
    // listing would silently drop every one of its category-specific fields
    // (villa number, cabins, private pool, farm infrastructure, ...) even
    // though the internal API now returns them.
    villa_details: true,
    house_details: true,
    commercial_shop_details: true,
    commercial_office_details: true,
    farm_land_details: true,
    seo_title: true,
    seo_keywords: true,
    created_at: true,
    state: true,
    city: true,
    locality: true,
    pincode: true,
    listing_type: true,
    slug: true,
    // GPS intentionally EXCLUDED — internal only
    images: {
        where: { status: 'APPROVED' },
        select: {
            id: true,
            image_url: true,
            is_primary: true,
            alt_text: true,
            sort_order: true,
        },
        orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
    },
};
/** Renames the selected `final_price` column back to `price` for the public
 * JSON response — keeps the external API contract unchanged even though the
 * internal Property model no longer has its own separate `price` column. */
function shapePublicProperty(row) {
    const { final_price, ...rest } = row;
    return { ...rest, price: final_price };
}
exports.shapePublicProperty = shapePublicProperty;
// WR-5/WR-6: Public-safe project allowlist
const PUBLIC_PROJECT_SELECT = {
    id: true,
    project_code: true,
    name: true,
    description: true,
    location: true,
    total_area: true,
    total_units: true,
    launch_date: true,
    project_phase: true,
    rera_number: true,
    status: true,
    amenities: true,
    created_at: true,
    slug: true,
    cover_image_url: true,
    // company_id EXCLUDED — internal
    // assigned_pm_id EXCLUDED — internal
    // branch_id EXCLUDED — internal
};
// Public-safe ProjectUnit allowlist — mapped below (unitToPublicPropertyShape)
// into the same property_code/category/etc. shape the existing public-site
// DTO layer, built against the old Property-based units, already knows how
// to render, so it keeps working unchanged. Units are
// internally-authored inventory (no seller/workflow fields to exclude).
const PUBLIC_PROJECT_UNIT_SELECT = {
    id: true,
    unit_code: true,
    unit_type: true,
    unit_number: true,
    tower: true,
    block: true,
    floor: true,
    bhk: true,
    bedrooms: true,
    bathrooms: true,
    facing: true,
    area_sqft: true,
    final_price: true,
    sales_status: true,
    created_at: true,
    images: {
        select: { id: true, image_url: true, is_primary: true, alt_text: true, sort_order: true },
        orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
    },
};
// WR-5: Project detail extends list with published units (ProjectUnit — see
// the "Deliberately NOT a Property" comment on that model in schema.prisma).
// `properties` intentionally dropped from the public payload: post-rebuild it
// holds only legacy soft-archived rows from the Property -> ProjectUnit
// migration, never live inventory.
const PUBLIC_PROJECT_DETAIL_SELECT = {
    ...PUBLIC_PROJECT_SELECT,
    units: {
        where: { is_published: true },
        select: PUBLIC_PROJECT_UNIT_SELECT,
        orderBy: { created_at: 'desc' },
    },
};
/** Shapes a published ProjectUnit into the Property-like object the public
 * site's DTO layer (toPublicProjectDetail in dto.ts, both frontends) already
 * knows how to render — avoids touching four downstream codebases for a
 * field-name difference. */
function unitToPublicPropertyShape(unit) {
    const categoryMap = {
        FLAT: 'APARTMENT',
        PLOT: 'PLOT',
        VILLA: 'VILLA',
        HOUSE: 'INDEPENDENT_HOUSE',
        COMMERCIAL: 'COMMERCIAL',
        OTHER: 'OTHER',
    };
    const label = [unit.tower, unit.block, unit.unit_number].filter(Boolean).join(' ') || unit.unit_code;
    return {
        id: unit.id,
        title: `${unit.bhk ? unit.bhk + ' ' : ''}${categoryMap[unit.unit_type] === 'APARTMENT' ? 'Flat' : unit.unit_type} ${label}`.trim(),
        property_code: unit.unit_code,
        category: categoryMap[unit.unit_type] || unit.unit_type,
        listing_type: 'NEW',
        price: unit.final_price,
        area_sqft: unit.area_sqft,
        location: undefined, // inherited from the project itself, not repeated per unit
        bedrooms: unit.bedrooms,
        bathrooms: unit.bathrooms,
        facing: unit.facing,
        possession_status: null,
        images: unit.images || [],
        amenities: '[]',
        created_at: unit.created_at,
    };
}
// Property detail adds a minimal project subset (WR-5 extends this pattern)
const PUBLIC_PROPERTY_DETAIL_SELECT = {
    ...exports.PUBLIC_PROPERTY_SELECT,
    project: {
        select: {
            id: true,
            project_code: true,
            name: true,
            location: true,
            status: true,
        },
    },
};
router.use(correlationId_1.correlationId);
router.use(rateLimiter_1.publicReadLimiter);
router.use(publicApiKey_1.authenticatePublicKey);
// GET /api/v1/public/:brand/properties
router.get('/:brand/properties', async (req, res) => {
    try {
        const { brand } = req.params;
        const { city, locality, location, listing_type, category, price_min, price_max, bedrooms, bedrooms_min, bedrooms_max, bathrooms, area_min, area_max, sort, } = req.query;
        let companyId = null;
        if (brand.toLowerCase() === 'rrh') {
            companyId = req.apiKeyContext.company_id;
        }
        else if (brand.toLowerCase() === 'sonthillu') {
            companyId = req.apiKeyContext.company_id;
        }
        else {
            return res.status(400).json({ error: 'Invalid brand specified in URL' });
        }
        // Helper: safely convert query param to number, returns undefined for invalid
        const toNum = (v) => {
            if (v === null || v === undefined || v === '')
                return undefined;
            const n = Number(v);
            if (n !== n || !isFinite(n))
                return undefined; // NaN or Infinity
            return n;
        };
        const priceMin = toNum(price_min);
        const priceMax = toNum(price_max);
        const bedRooms = toNum(bedrooms);
        const bedRoomsMin = toNum(bedrooms_min);
        const bedRoomsMax = toNum(bedrooms_max);
        const bathRooms = toNum(bathrooms);
        const areaMin = toNum(area_min);
        const areaMax = toNum(area_max);
        const sortIn = sort;
        const pageNum = toNum(req.query.page);
        const limitNum = toNum(req.query.limit);
        // WR-7: Validation — min <= max for price and area (only when both provided)
        if (priceMin !== undefined && priceMax !== undefined && priceMin > priceMax) {
            return res.status(400).json({ error: 'price_min must be <= price_max' });
        }
        if (areaMin !== undefined && areaMax !== undefined && areaMin > areaMax) {
            return res.status(400).json({ error: 'area_min must be <= area_max' });
        }
        // WR-7: Validation — invalid numeric inputs → 400 (only when param provided in URL)
        // toNum returns undefined for both "not provided" and "invalid value"
        // Check raw query param to distinguish: if provided but invalid → 400
        const hasPriceMin = price_min !== undefined;
        const hasPriceMax = price_max !== undefined;
        const hasAreaMin = area_min !== undefined;
        const hasAreaMax = area_max !== undefined;
        const hasPage = req.query.page !== undefined;
        const hasLimit = req.query.limit !== undefined;
        if (hasPriceMin && priceMin === undefined) {
            return res.status(400).json({ error: 'Invalid price_min value' });
        }
        if (hasPriceMax && priceMax === undefined) {
            return res.status(400).json({ error: 'Invalid price_max value' });
        }
        if (hasAreaMin && areaMin === undefined) {
            return res.status(400).json({ error: 'Invalid area_min value' });
        }
        if (hasAreaMax && areaMax === undefined) {
            return res.status(400).json({ error: 'Invalid area_max value' });
        }
        if (hasPage && pageNum === undefined) {
            return res.status(400).json({ error: 'Invalid page value' });
        }
        if (hasLimit && limitNum === undefined) {
            return res.status(400).json({ error: 'Invalid limit value' });
        }
        // WR-7: Validation — page >= 1, limit >= 1, max limit 50
        const page = pageNum !== undefined && pageNum >= 1 ? pageNum : 1;
        let limit = limitNum !== undefined && limitNum >= 1 ? limitNum : 20;
        if (limit > 50) {
            return res.status(400).json({ error: 'Limit must not exceed 50' });
        }
        limit = Math.min(limit, 50);
        // Brand / publication / availability foundation (unchanged)
        const publishedPropertyIds = await p.propertyPublication.findMany({
            where: {
                company_id: companyId,
                is_published: true,
            },
            select: { property_id: true },
        });
        const propertyIds = publishedPropertyIds.map((pp) => pp.property_id);
        if (propertyIds.length === 0) {
            return res.status(200).json([]);
        }
        // Build where condition with mandatory public restrictions
        const whereCondition = {
            id: { in: propertyIds },
            OR: [
                { status: 'LIVE' },
                {
                    status: 'LOCKED',
                    locked_until: { lt: new Date() },
                },
            ],
        };
        // WR-7: Price range filter (price >= priceMin AND price <= priceMax)
        if (priceMin !== undefined && priceMax !== undefined) {
            whereCondition.final_price = { gte: priceMin, lte: priceMax };
        }
        else if (priceMin !== undefined) {
            whereCondition.final_price = { gte: priceMin };
        }
        else if (priceMax !== undefined) {
            whereCondition.final_price = { lte: priceMax };
        }
        // WR-7: Bedrooms filter
        let finalBedroomsMin = undefined;
        if (bedRooms !== undefined && bedRooms >= 0) {
            finalBedroomsMin = bedRooms;
        }
        if (bedRoomsMin !== undefined && bedRoomsMin >= 0) {
            if (finalBedroomsMin !== undefined) {
                finalBedroomsMin = Math.max(finalBedroomsMin, bedRoomsMin);
            }
            else {
                finalBedroomsMin = bedRoomsMin;
            }
        }
        if (finalBedroomsMin !== undefined &&
            bedRoomsMax !== undefined &&
            finalBedroomsMin > bedRoomsMax) {
            return res.status(400).json({ error: 'effective bedrooms minimum must be <= bedrooms_max' });
        }
        if (finalBedroomsMin !== undefined || (bedRoomsMax !== undefined && bedRoomsMax >= 0)) {
            whereCondition.bedrooms = {};
            if (finalBedroomsMin !== undefined) {
                whereCondition.bedrooms.gte = finalBedroomsMin;
            }
            if (bedRoomsMax !== undefined && bedRoomsMax >= 0) {
                whereCondition.bedrooms.lte = bedRoomsMax;
            }
        }
        // New string filters
        if (city !== undefined && typeof city === 'string' && city.trim() !== '') {
            whereCondition.city = city.trim();
        }
        if (locality !== undefined && typeof locality === 'string' && locality.trim() !== '') {
            whereCondition.locality = locality.trim();
        }
        // Phase 3: Location search (tokenized OR search across city/locality)
        if (location !== undefined && typeof location === 'string' && location.trim() !== '') {
            const tokens = location
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean);
            const uniqueTokens = [];
            const seenLower = new Set();
            for (const t of tokens) {
                const lower = t.toLowerCase();
                if (!seenLower.has(lower)) {
                    seenLower.add(lower);
                    uniqueTokens.push(t);
                }
            }
            if (uniqueTokens.length > 2) {
                return res
                    .status(400)
                    .json({ error: 'Location search supports a maximum of 2 tokens (e.g., Locality, City)' });
            }
            if (uniqueTokens.length > 0) {
                whereCondition.AND = whereCondition.AND || [];
                for (const token of uniqueTokens) {
                    whereCondition.AND.push({
                        OR: [{ city: { equals: token } }, { locality: { equals: token } }],
                    });
                }
            }
        }
        if (category !== undefined && typeof category === 'string' && category.trim() !== '') {
            whereCondition.category = category.trim();
        }
        if (listing_type !== undefined &&
            typeof listing_type === 'string' &&
            listing_type.trim() !== '') {
            whereCondition.listing_type = listing_type.trim();
        }
        // WR-7: Bathrooms filter (bathrooms >= requested value)
        if (bathRooms !== undefined && bathRooms >= 0) {
            whereCondition.bathrooms = { gte: bathRooms };
        }
        // WR-7: Area range filter using area_sqft
        if (areaMin !== undefined && areaMax !== undefined) {
            whereCondition.area_sqft = { gte: areaMin, lte: areaMax };
        }
        else if (areaMin !== undefined) {
            whereCondition.area_sqft = { gte: areaMin };
        }
        else if (areaMax !== undefined) {
            whereCondition.area_sqft = { lte: areaMax };
        }
        // WR-7: Sorting — only validated deterministic values
        const sortValues = ['newest', 'price-asc', 'price-desc'];
        // If sort is omitted (undefined), default to newest.
        // If sort is provided but not in the validated list, return 400.
        let sortBy;
        if (sortIn === undefined) {
            sortBy = 'newest';
        }
        else if (sortValues.includes(sortIn)) {
            sortBy = sortIn;
        }
        else {
            return res.status(400).json({ error: 'Invalid sort value' });
        }
        const orderBy = {};
        if (sortBy === 'newest') {
            orderBy.created_at = 'desc';
        }
        else if (sortBy === 'price-asc') {
            orderBy.final_price = 'asc';
        }
        else if (sortBy === 'price-desc') {
            orderBy.final_price = 'desc';
        }
        // WR-7: Pagination — page and limit with defaults and max
        const skip = (page - 1) * limit;
        const take = limit;
        // Count total for pagination metadata (after all filters applied to published set)
        const total = await p.property.count({
            where: whereCondition,
        });
        const properties = await p.property.findMany({
            where: whereCondition,
            select: exports.PUBLIC_PROPERTY_SELECT,
            orderBy: orderBy,
            skip: skip,
            take: take,
        });
        res.status(200).json(properties.map(shapePublicProperty));
    }
    catch (error) {
        logger_1.logger.error('Fetch public properties error:', error);
        res.status(500).json({ error: 'Failed to fetch properties' });
    }
});
// GET /api/v1/public/:brand/properties/:id — public property detail
// Re-checks publication and availability on every request (never trusts list-state).
router.get('/:brand/properties/:id', async (req, res) => {
    try {
        const { brand, id } = req.params;
        if (brand.toLowerCase() !== 'rrh' && brand.toLowerCase() !== 'sonthillu') {
            return res.status(400).json({ error: 'Invalid brand specified in URL' });
        }
        const propertyId = Number(id);
        if (!Number.isInteger(propertyId) || propertyId <= 0) {
            return res.status(404).json({ error: 'Property not found or not available' });
        }
        const companyId = req.apiKeyContext.company_id;
        // Publication re-check: must be published to THIS company's brand feed.
        const publication = await p.propertyPublication.findFirst({
            where: {
                property_id: propertyId,
                company_id: companyId,
                is_published: true,
            },
        });
        if (!publication) {
            return res.status(404).json({ error: 'Property not found or not available' });
        }
        // Availability re-check: only LIVE or expired-LOCKED records are publicly visible.
        const property = await p.property.findFirst({
            where: {
                id: propertyId,
                OR: [
                    { status: 'LIVE' },
                    {
                        status: 'LOCKED',
                        locked_until: { lt: new Date() },
                    },
                ],
            },
            select: PUBLIC_PROPERTY_DETAIL_SELECT,
        });
        if (!property) {
            return res.status(404).json({ error: 'Property not found or not available' });
        }
        res.status(200).json(shapePublicProperty(property));
    }
    catch (error) {
        logger_1.logger.error('Fetch public property detail error:', error);
        res.status(500).json({ error: 'Failed to fetch property detail' });
    }
});
// ─── WR-5: Public Project Endpoints ──────────────────────────────────────────
// Rebuilt against the ProjectUnit split (a project's saleable inventory is no
// longer Property rows with project_id set — see schema.prisma's comment on
// ProjectUnit). Visibility is company-scoped via the API key already
// (PublicApiKey has no brand/category column of its own), plus Project's own
// `is_published` flag; `:brand` in the URL is kept only for path
// compatibility with the sites already calling it.
// Helper: derive inventory summary from a project's ProjectUnit rows.
// Counts every unit regardless of is_published (an unpublished unit is still
// real inventory a buyer shouldn't see priced-out-of-existence), excluding
// only BLOCKED/UNAVAILABLE from the public total the same way the internal
// dashboard's tiles do.
function deriveUnitInventorySummary(units) {
    let total = 0;
    let available = 0;
    let reserved = 0;
    let sold = 0;
    for (const unit of units) {
        if (unit.sales_status === 'BLOCKED' || unit.sales_status === 'UNAVAILABLE')
            continue;
        total++;
        if (unit.sales_status === 'AVAILABLE')
            available++;
        else if (unit.sales_status === 'HOLD' || unit.sales_status === 'RESERVED')
            reserved++;
        else if (unit.sales_status === 'BOOKED' || unit.sales_status === 'SOLD')
            sold++;
    }
    return { total, available, reserved, sold };
}
// GET /api/v1/public/:brand/projects — list published projects for this company
router.get('/:brand/projects', async (req, res) => {
    try {
        const { brand } = req.params;
        const brandLower = brand.toLowerCase();
        if (brandLower !== 'rrh' && brandLower !== 'sonthillu') {
            return res.status(400).json({ error: 'Invalid brand specified in URL' });
        }
        const companyId = req.apiKeyContext.company_id;
        const projects = await p.project.findMany({
            where: {
                company_id: companyId,
                is_published: true,
                status: { not: 'CANCELLED' },
            },
            select: PUBLIC_PROJECT_SELECT,
            orderBy: { created_at: 'desc' },
        });
        if (projects.length === 0) {
            return res.status(200).json([]);
        }
        // One batched query for every project's units rather than N+1.
        const units = await p.projectUnit.findMany({
            where: { project_id: { in: projects.map((pr) => pr.id) } },
            select: { project_id: true, sales_status: true },
        });
        const unitsByProject = new Map();
        for (const unit of units) {
            const list = unitsByProject.get(unit.project_id) || [];
            list.push(unit);
            unitsByProject.set(unit.project_id, list);
        }
        const projectsWithInventory = projects.map((project) => ({
            ...project,
            inventory_summary: deriveUnitInventorySummary(unitsByProject.get(project.id) || []),
        }));
        res.status(200).json(projectsWithInventory);
    }
    catch (error) {
        logger_1.logger.error('Fetch public projects error:', error);
        res.status(500).json({ error: 'Failed to fetch projects' });
    }
});
// GET /api/v1/public/:brand/projects/:id — public project detail
// Returns 404 when the project does not exist, isn't published, or belongs
// to a different company than the one this API key is scoped to.
router.get('/:brand/projects/:id', async (req, res) => {
    try {
        const { brand, id } = req.params;
        const brandLower = brand.toLowerCase();
        if (brandLower !== 'rrh' && brandLower !== 'sonthillu') {
            return res.status(400).json({ error: 'Invalid brand specified in URL' });
        }
        const projectId = Number(id);
        if (!Number.isInteger(projectId) || projectId <= 0) {
            return res.status(404).json({ error: 'Project not found or not available' });
        }
        const companyId = req.apiKeyContext.company_id;
        const project = await p.project.findFirst({
            where: { id: projectId, company_id: companyId, is_published: true },
            select: PUBLIC_PROJECT_DETAIL_SELECT,
        });
        if (!project) {
            return res.status(404).json({ error: 'Project not found or not available' });
        }
        // Inventory summary counts every unit (published or not — see
        // deriveUnitInventorySummary), while `units` above was already filtered
        // to is_published:true for display, so re-fetch unfiltered for the count.
        const allUnits = await p.projectUnit.findMany({
            where: { project_id: projectId },
            select: { sales_status: true },
        });
        const inventory_summary = deriveUnitInventorySummary(allUnits);
        const { units, ...projectFields } = project;
        res.status(200).json({
            ...projectFields,
            properties: (units || []).map(unitToPublicPropertyShape),
            inventory_summary,
        });
    }
    catch (error) {
        logger_1.logger.error('Fetch public project detail error:', error);
        res.status(500).json({ error: 'Failed to fetch project detail' });
    }
});
// POST /api/v1/public/:brand/leads
// Website leads used to be a bare, unchecked insert — no duplicate
// detection, no scoring, no SLA timer, and (critically) no auto-distribution
// to a telecaller, unlike every internal lead-creation path. This now
// routes through the exact same createLead() pipeline internal leads use,
// via a per-company non-login "system" employee (see utils/systemActor.ts)
// so the required LeadActivity.actor_id FK has something real to point at,
// while attribution (created_by_id) correctly stays null — a website lead
// has no employee creator.
router.post('/:brand/leads', rateLimiter_1.publicWriteLimiter, (0, validate_1.validateRequestBody)(shared_1.PublicLeadCreateSchema), async (req, res) => {
    try {
        const { brand } = req.params;
        const companyId = req.apiKeyContext.company_id;
        if (brand.toLowerCase() !== 'rrh' && brand.toLowerCase() !== 'sonthillu') {
            return res.status(400).json({ error: 'Invalid brand specified in URL' });
        }
        const systemEmployee = await (0, systemActor_1.getOrCreateSystemEmployee)(companyId);
        const systemUser = {
            employeeId: systemEmployee.id,
            employeeCode: systemEmployee.employee_code,
            companyId,
            branchId: null,
            roles: [],
            permissions: [],
        };
        const { lead } = await (0, create_1.createLead)(systemUser, { ...req.body, source: 'WEBSITE' }, { isPublicSubmission: true });
        res.status(201).json({ message: 'Lead captured successfully', leadId: lead.id });
    }
    catch (error) {
        if (error.statusCode)
            return res.status(error.statusCode).json({ error: error.message });
        logger_1.logger.error('Public lead creation error:', error);
        res.status(500).json({ error: 'Failed to create lead' });
    }
});
exports.default = router;
