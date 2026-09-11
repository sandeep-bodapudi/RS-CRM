"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpportunityService = void 0;
const prisma_1 = require("../lib/prisma");
const opportunity_policy_1 = require("../policies/opportunity.policy");
const lead_service_1 = require("./lead.service"); // Resuse AppError
const workflowEngine_1 = require("../workflows/workflowEngine");
const customer_service_1 = require("./customer.service");
const booking_service_1 = require("./booking.service");
class OpportunityService {
    /**
     * 1. Create an Opportunity from a Lead.
     */
    static async createFromLead(user, data) {
        const { lead_id, project_id, property_id, ...opportunityData } = data;
        const owner_id = data.owner_id || user.employeeId;
        // 1. Validate Lead and Company Association
        const lead = await prisma_1.prisma.lead.findFirst({
            where: { id: lead_id, company_id: user.companyId },
        });
        if (!lead) {
            throw new lead_service_1.AppError(404, 'Lead not found');
        }
        // Check if user has permission to mutate this Lead
        // Typically verified by LeadPolicy, but for now we enforce company boundary strictly
        // 2. Validate Owner (Employee)
        const owner = await prisma_1.prisma.employee.findFirst({
            where: { id: owner_id, company_id: user.companyId },
        });
        if (!owner) {
            throw new lead_service_1.AppError(400, 'Owner assignment not allowed or not found');
        }
        // 3. Validate Project (if provided)
        if (project_id) {
            const project = await prisma_1.prisma.project.findFirst({
                where: { id: project_id, company_id: user.companyId },
            });
            if (!project) {
                throw new lead_service_1.AppError(404, 'Project not found');
            }
        }
        // 4. Validate Property (if provided)
        if (property_id) {
            const property = await prisma_1.prisma.property.findFirst({
                where: { id: property_id, company_id: user.companyId },
                include: { project: true },
            });
            if (!property) {
                throw new lead_service_1.AppError(404, 'Property not found');
            }
            // Ensure property and project match if both are provided
            if (project_id && property.project_id !== project_id) {
                throw new lead_service_1.AppError(400, 'Property does not belong to the specified Project');
            }
        }
        // Proceed to create Opportunity within a transaction to also update Lead status and create History
        const result = await prisma_1.prisma.$transaction(async (tx) => {
            const opportunity = await tx.opportunity.create({
                data: {
                    company_id: user.companyId || 1,
                    opportunity_code: `OPP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                    lead_id: lead_id,
                    source: lead.source,
                    campaign: lead.campaign,
                    utm_source: lead.utm_source,
                    utm_medium: lead.utm_medium,
                    utm_campaign: lead.utm_campaign,
                    owner_id: owner_id || 1,
                    project_id: project_id,
                    property_id: property_id,
                    budget_min: opportunityData.budget_min,
                    budget_max: opportunityData.budget_max,
                    expected_value: opportunityData.expected_value,
                    probability: opportunityData.probability,
                },
            });
            // §4: the Opportunity is a subordinate commercial record, not a competing
            // pipeline. Per §1, the lead enters NEGOTIATION from SITE_VISIT_COMPLETED
            // when an interested outcome exists. We advance it through the workflow
            // engine (the only authority allowed to write Lead.status) rather than a
            // raw update. OPPORTUNITY_OPEN no longer exists.
            if (lead.status === 'SITE_VISIT_COMPLETED') {
                await workflowEngine_1.WorkflowEngine.transitionLead(tx, lead_id, 'NEGOTIATION', {
                    actor: user,
                    entity: { ...lead, opportunities: [opportunity] },
                });
            }
            return opportunity;
        });
        return result;
    }
    /**
     * §4 (transaction-scoped): auto-create an Opportunity when a Lead enters
     * NEGOTIATION, inside the caller's existing Prisma transaction.
     *
     * Unlike the public `createFromLead` (which is a standalone route handler),
     * this is invoked by LeadService.updateLeadStatus after the workflow engine
     * has approved the SITE_VISIT_COMPLETED → NEGOTIATION transition. Opportunity
     * is a subordinate commercial record (spec §0): Lead.status stays the only
     * macro-status source of truth.
     */
    static async createFromLeadTx(tx, lead, actingEmployeeId, interestedPropertyId) {
        // Avoid duplicates if an Opportunity was already created for this lead.
        const existing = await tx.opportunity.findFirst({ where: { lead_id: lead.id } });
        if (existing)
            return existing;
        const property = interestedPropertyId
            ? await tx.property.findFirst({ where: { id: interestedPropertyId } })
            : null;
        const currentYear = new Date().getFullYear();
        const seq = await tx.opportunity.count({
            where: { company_id: lead.company_id, created_at: { gte: new Date(`${currentYear}-01-01`) } },
        });
        return await tx.opportunity.create({
            data: {
                opportunity_code: `RRH-OPP-${currentYear}-${(seq + 1).toString().padStart(4, '0')}`,
                company_id: lead.company_id,
                lead_id: lead.id,
                owner_id: actingEmployeeId,
                expected_value: property?.final_price ?? null,
                probability: 30,
                expected_close_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                source: lead.source ?? null,
                campaign: lead.campaign ?? null,
                utm_source: lead.utm_source ?? null,
                utm_medium: lead.utm_medium ?? null,
                utm_campaign: lead.utm_campaign ?? null,
                ...(interestedPropertyId ? { property_id: interestedPropertyId } : {}),
            },
        });
    }
    /**
     * 2. Update Opportunity Commercial Fields
     */
    static async updateOpportunity(user, id, data) {
        const opp = await prisma_1.prisma.opportunity.findFirst({ where: { id, company_id: user.companyId } });
        if (!opp)
            throw new lead_service_1.AppError(404, 'Opportunity not found');
        if (!opportunity_policy_1.OpportunityPolicy.canMutate(user, opp)) {
            throw new lead_service_1.AppError(403, 'Unauthorized to update this Opportunity');
        }
        // Validate Project
        if (data.project_id) {
            const project = await prisma_1.prisma.project.findFirst({
                where: { id: data.project_id, company_id: user.companyId },
            });
            if (!project) {
                throw new lead_service_1.AppError(404, 'Project not found');
            }
        }
        // Validate Property
        if (data.property_id) {
            const property = await prisma_1.prisma.property.findFirst({
                where: { id: data.property_id, company_id: user.companyId },
            });
            if (!property) {
                throw new lead_service_1.AppError(404, 'Property not found');
            }
        }
        return await prisma_1.prisma.opportunity.update({
            where: { id },
            data: {
                project_id: data.project_id,
                property_id: data.property_id,
                expected_value: data.expected_value,
                probability: data.probability,
                budget_min: data.budget_min,
                budget_max: data.budget_max,
                expected_close_date: data.expected_close_date,
            },
        });
    }
    /**
     * Get all Opportunities for a given Lead, enforcing company isolation.
     */
    static async getOpportunitiesByLead(user, lead_id) {
        const opps = await prisma_1.prisma.opportunity.findMany({
            where: {
                lead_id,
                company_id: user.companyId,
            },
            include: {
                project: { select: { id: true, name: true } },
                property: { select: { id: true, title: true, property_code: true } },
                owner: { select: { id: true, full_name: true, employee_code: true } },
            },
            orderBy: { created_at: 'desc' },
        });
        // Check visibility via OpportunityPolicy
        return opps.filter((opp) => opportunity_policy_1.OpportunityPolicy.canView(user, opp));
    }
    /**
     * 4. List Opportunities with Company Scope, Filtering, Sorting, and Pagination
     */
    static async getOpportunities(user, filters = {}) {
        const policyWhere = opportunity_policy_1.OpportunityPolicy.canList(user);
        const where = {
            AND: [policyWhere],
        };
        if (filters.owner_id)
            where.AND.push({ owner_id: Number(filters.owner_id) });
        if (filters.project_id)
            where.AND.push({ project_id: Number(filters.project_id) });
        if (filters.property_id)
            where.AND.push({ property_id: Number(filters.property_id) });
        // Date range filters
        if (filters.date_from || filters.date_to) {
            const dateFilter = {};
            if (filters.date_from)
                dateFilter.gte = new Date(filters.date_from);
            if (filters.date_to)
                dateFilter.lte = new Date(filters.date_to);
            where.AND.push({ created_at: dateFilter });
        }
        if (filters.expected_close_from || filters.expected_close_to) {
            const closeFilter = {};
            if (filters.expected_close_from)
                closeFilter.gte = new Date(filters.expected_close_from);
            if (filters.expected_close_to)
                closeFilter.lte = new Date(filters.expected_close_to);
            where.AND.push({ expected_close_date: closeFilter });
        }
        // Sorting
        const allowedSortFields = [
            'created_at',
            'updated_at',
            'expected_value',
            'probability',
            'expected_close_date',
        ];
        const sortBy = allowedSortFields.includes(filters.sort_by || '')
            ? filters.sort_by
            : 'updated_at';
        const sortOrder = filters.sort_order === 'asc' ? 'asc' : 'desc';
        // Pagination
        const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
        const offset = Math.max(Number(filters.offset) || 0, 0);
        const [opportunities, total] = await Promise.all([
            prisma_1.prisma.opportunity.findMany({
                where,
                include: {
                    lead: { select: { id: true, customer_name: true, phone: true } },
                    owner: { select: { id: true, full_name: true, employee_code: true } },
                    project: { select: { id: true, name: true } },
                    property: { select: { id: true, title: true, property_code: true } },
                },
                orderBy: { [sortBy]: sortOrder },
                take: limit,
                skip: offset,
            }),
            prisma_1.prisma.opportunity.count({ where }),
        ]);
        return { opportunities, total, limit, offset };
    }
    /**
     * 5. Get Single Opportunity Dossier
     */
    static async getOpportunityById(user, id) {
        const opp = await prisma_1.prisma.opportunity.findFirst({
            where: { id, company_id: user.companyId },
            include: {
                lead: true,
                owner: { select: { id: true, full_name: true, employee_code: true } },
                project: true,
                property: true,
                tasks: true,
                site_visits: true,
            },
        });
        if (!opp || opp.company_id !== user.companyId)
            throw new lead_service_1.AppError(404, 'Opportunity not found');
        if (!opportunity_policy_1.OpportunityPolicy.canView(user, opp)) {
            throw new lead_service_1.AppError(403, 'Unauthorized to view this Opportunity');
        }
        return opp;
    }
    /**
     * 6. Comprehensive Pipeline Metrics (Company + Policy Scoped)
     */
    static async getPipelineMetrics(user) {
        const policyWhere = opportunity_policy_1.OpportunityPolicy.canList(user);
        // Fetch all opportunities the user can see (scoped at DB level)
        const allOpps = await prisma_1.prisma.opportunity.findMany({
            where: policyWhere,
            select: {
                id: true,
                lead: { select: { status: true } },
                expected_value: true,
                probability: true,
                drop_reason: true,
                owner_id: true,
                project_id: true,
                property_id: true,
                created_at: true,
                owner: { select: { id: true, full_name: true } },
                project: { select: { id: true, name: true } },
                property: { select: { id: true, title: true } },
            },
        });
        const TERMINAL_STAGES = ['BOOKED', 'DROPPED'];
        const activeOpps = allOpps.filter((o) => !TERMINAL_STAGES.includes(o.lead?.status || ''));
        const now = Date.now();
        // --- Count by stage ---
        const countByStage = {};
        allOpps.forEach((o) => {
            const stage = o.lead?.status || 'UNKNOWN';
            countByStage[stage] = (countByStage[stage] || 0) + 1;
        });
        // --- Pipeline values ---
        let totalExpectedValue = 0;
        let totalWeightedValue = 0;
        activeOpps.forEach((o) => {
            const val = Number(o.expected_value || 0);
            const prob = Number(o.probability || 0);
            totalExpectedValue += val;
            totalWeightedValue += val * (prob / 100);
        });
        // --- Owner segmentation ---
        const ownerMap = new Map();
        activeOpps.forEach((o) => {
            const entry = ownerMap.get(o.owner_id) || {
                name: o.owner?.full_name || 'Unknown',
                count: 0,
                value: 0,
                weighted: 0,
            };
            entry.count++;
            entry.value += Number(o.expected_value || 0);
            entry.weighted += (Number(o.expected_value || 0) * Number(o.probability || 0)) / 100;
            ownerMap.set(o.owner_id, entry);
        });
        // --- Project segmentation ---
        const projectMap = new Map();
        activeOpps
            .filter((o) => o.project_id)
            .forEach((o) => {
            const entry = projectMap.get(o.project_id) || {
                name: o.project?.name || 'Unknown',
                count: 0,
                value: 0,
            };
            entry.count++;
            entry.value += Number(o.expected_value || 0);
            projectMap.set(o.project_id, entry);
        });
        // --- Property segmentation ---
        const propertyMap = new Map();
        activeOpps
            .filter((o) => o.property_id)
            .forEach((o) => {
            const entry = propertyMap.get(o.property_id) || {
                title: o.property?.title || 'Unknown',
                count: 0,
                value: 0,
            };
            entry.count++;
            entry.value += Number(o.expected_value || 0);
            propertyMap.set(o.property_id, entry);
        });
        // --- Terminal states ---
        const droppedOpps = allOpps.filter((o) => o.lead?.status === 'DROPPED');
        const droppedReasons = {};
        droppedOpps.forEach((o) => {
            const reason = o.drop_reason || 'No reason provided';
            droppedReasons[reason] = (droppedReasons[reason] || 0) + 1;
        });
        const bookingInitiatedCount = allOpps.filter((o) => o.lead?.status === 'BOOKING_INITIATED').length;
        const bookedCount = allOpps.filter((o) => o.lead?.status === 'BOOKED').length;
        // --- Opportunity age ---
        const ages = activeOpps.map((o) => Math.round((now - new Date(o.created_at).getTime()) / 86400000));
        const avgAgeDays = ages.length > 0 ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : 0;
        return {
            activeCount: activeOpps.length,
            totalCount: allOpps.length,
            totalExpectedValue,
            totalWeightedValue,
            countByStage,
            byOwner: Array.from(ownerMap.entries()).map(([id, d]) => ({ owner_id: id, ...d })),
            byProject: Array.from(projectMap.entries()).map(([id, d]) => ({ project_id: id, ...d })),
            byProperty: Array.from(propertyMap.entries()).map(([id, d]) => ({ property_id: id, ...d })),
            droppedCount: droppedOpps.length,
            droppedReasons,
            bookingInitiatedCount,
            bookedCount,
            avgAgeDays,
        };
    }
    /**
     * Phase 9 Packet 3 - Opportunity -> Customer -> Booking Integration
     * Convert an Opportunity into a Booking atomically.
     */
    static async convertToBooking(user, opportunityId, dto) {
        // 1. Verify Opportunity exists and is accessible
        const opp = await prisma_1.prisma.opportunity.findFirst({
            where: { id: opportunityId, company_id: user.companyId },
            include: { property: true, lead: true },
        });
        if (!opp) {
            throw new lead_service_1.AppError(404, 'Opportunity not found or access denied');
        }
        if (!opportunity_policy_1.OpportunityPolicy.canMutate(user, opp)) {
            throw new lead_service_1.AppError(403, 'Unauthorized to convert this Opportunity');
        }
        // 2. Validate Stage (via Lead)
        if (opp.lead.status !== 'BOOKING_INITIATED') {
            throw new lead_service_1.AppError(400, 'Lead must be in BOOKING_INITIATED status to convert Opportunity to booking');
        }
        // 3. Check existing booking (Idempotency)
        if (opp.booking_id) {
            const existingBooking = await booking_service_1.BookingService.getBookingById(user, opp.booking_id);
            return existingBooking; // safely return existing booking
        }
        if (!opp.property_id) {
            throw new lead_service_1.AppError(400, 'Opportunity must have a property assigned before booking');
        }
        // 4. Atomic Transaction Envelope
        return await prisma_1.prisma.$transaction(async (tx) => {
            // Step A: Resolve Customer
            const customer = await customer_service_1.CustomerService.upsertFromLead(user, opp.lead_id, tx);
            // Step B: Create Booking (with Packet 2 property lock)
            const bookingDto = {
                ...dto,
                customer_id: customer.id,
                property_id: opp.property_id,
                // Phase 12-1: propagate the Opportunity's attribution onto the Booking
                // (DTO overrides if explicitly provided, else inherit from the Opportunity).
                source: dto.source ?? opp.source ?? null,
                campaign: dto.campaign ?? opp.campaign ?? null,
                utm_source: dto.utm_source ?? opp.utm_source ?? null,
                utm_medium: dto.utm_medium ?? opp.utm_medium ?? null,
                utm_campaign: dto.utm_campaign ?? opp.utm_campaign ?? null,
                // Override any provided amounts with the agreed opportunity value if needed,
                // but typically DTO provides exact booking token/agreed price.
            };
            const booking = await booking_service_1.BookingService.createBooking(user, bookingDto, tx);
            // Step C: Atomically link Booking to Opportunity
            const oppUpdate = await tx.opportunity.updateMany({
                where: { id: opportunityId, booking_id: null },
                data: { booking_id: booking.id },
            });
            if (oppUpdate.count === 0) {
                // Another concurrent request beat us to it
                throw new lead_service_1.AppError(409, 'Opportunity has already been converted to a booking');
            }
            return booking;
        });
    }
}
exports.OpportunityService = OpportunityService;
