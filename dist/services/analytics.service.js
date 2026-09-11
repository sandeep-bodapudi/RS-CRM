"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalyticsService = void 0;
/**
 * analytics.service.ts — Unified Analytics (Phase 16, Packet B).
 *
 * Centralized, company-scoped KPI calculations for the unified analytics API.
 *
 * Design rules enforced here (see PACKET B scope):
 *  - Company scope is ONLY ever derived from an authenticated companyId. The
 *    client can never override tenant scope (no companyId in query/body/params).
 *  - KPIs 1-4, 6, 7 reuse the EXACT semantics previously inlined in
 *    /api/v1/md/executive-metrics (md.ts), extracted here so that the MD route
 *    and the unified analytics route share one source of truth (no duplication).
 *  - KPI 5 (Booking) is a total COUNT(*) WHERE company_id (no status filter).
 *  - KPI 9 (Target Attainment) follows reports.ts "today" semantics (IST calendar
 *    day) and is company-scoped through the owning employee (DailyReport has no
 *    company_id field).
 *  - KPI 8 (Team Performance) reuses the centralized Packet A formula from
 *    `performance-metric.ts` (calculatePerformanceScore) - it is NOT redefined.
 *  - KPI 10 (Integration/Portal event counts) reuses IntegrationService
 *    .getPortalMetrics (Phase 11 Packet 3G).
 *  - Opportunity KPIs reuse OpportunityService (company-scoped via
 *    OpportunityPolicy.canList).
 *
 * BLOCKED KPIs:
 *  - Payment / Collections total - NOT implemented. The repository does not
 *    define a single authoritative "received collections" total: `Payment.amount`
 *    (status PENDING/SUCCESS/FAILED/REFUNDED) and `Installment.received_amount`
 *    (status PENDING/PARTIALLY_RECEIVED/RECEIVED/OVERDUE/CANCELLED) are linked by
 *    `payment.installment_id`, so summing both double-counts; and no existing
 *    helper reconciles them under one "received" definition. Do not guess.
 */
const prisma_1 = require("../lib/prisma");
const performance_metric_1 = require("./performance-metric");
const integration_service_1 = require("./integration.service");
const opportunity_service_1 = require("./opportunity.service");
const time_1 = require("../utils/time");
const p = prisma_1.prisma;
class AnalyticsService {
    // ---- shared low-level company-scoped counters ----
    /** COUNT(*) WHERE company_id (KPI 1). */
    static async countLeads(companyId) {
        return await p.lead.count({ where: { company_id: companyId } });
    }
    /** COUNT(*) WHERE company_id AND status='BOOKED' (KPI 2). */
    static async countWonLeads(companyId) {
        return await p.lead.count({ where: { company_id: companyId, status: 'BOOKED' } });
    }
    /** COUNT(*) WHERE company_id AND status='SITE_VISIT_SCHEDULED' (KPI 3). */
    static async countSiteVisitsScheduled(companyId) {
        return await p.lead.count({
            where: { company_id: companyId, status: 'SITE_VISIT_SCHEDULED' },
        });
    }
    /**
     * Dropped-lead count grouped by the status the lead exited from
     * (`Lead.exited_from_status`, snapshotted at drop time — see
     * lead.workflow.ts's DROPPED-transition guard). Backs the Analytics
     * "Pipeline Drop-off Analysis" chart, which previously rendered hardcoded
     * placeholder numbers because this aggregation didn't exist yet — the
     * underlying data was already there, just never queried.
     */
    static async dropOffByStage(companyId) {
        const groups = await p.lead.groupBy({
            by: ['exited_from_status'],
            where: { company_id: companyId, status: 'DROPPED', exited_from_status: { not: null } },
            _count: { _all: true },
        });
        return groups
            .map((g) => ({ stage: g.exited_from_status, dropoffs: g._count._all }))
            .sort((a, b) => b.dropoffs - a.dropoffs);
    }
    /** Generalized lead counter by status, scoped to company */
    static async countLeadsByStatus(companyId, status) {
        return await p.lead.count({
            where: { company_id: companyId, status },
        });
    }
    /** Count ACTIVE customers, scoped to company */
    static async countActiveCustomers(companyId) {
        return await p.customer.count({
            where: { company_id: companyId, status: 'ACTIVE' },
        });
    }
    /**
     * Property status distribution (KPI 4). Preserves md.ts categories exactly:
     * Live, Pending MD, Pending PM. Uses the same CASE/SUM SQL as md.ts so the
     * existing /md/executive-metrics numbers are identical.
     */
    static async propertyDistribution(companyId) {
        const res = await p.$queryRaw `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'LIVE' THEN 1 ELSE 0 END) as liveCount,
        SUM(CASE WHEN status = 'PENDING_MD_APPROVAL' THEN 1 ELSE 0 END) as pendingMDCount,
        SUM(CASE WHEN status = 'PENDING_VERIFICATION' THEN 1 ELSE 0 END) as pendingPMCount
      FROM Property
      WHERE company_id = ${companyId}
    `;
        const row = res[0] || {};
        return {
            total: Number(row.total || 0),
            live: Number(row.liveCount || 0),
            pendingMD: Number(row.pendingMDCount || 0),
            pendingPM: Number(row.pendingPMCount || 0),
        };
    }
    /** COUNT(*) WHERE status='ACTIVE' AND company_id (KPI 6). Preserves md.ts (no deleted_at filter). */
    static async countActiveEmployees(companyId) {
        const res = await p.$queryRaw `SELECT COUNT(*) as count FROM Employee WHERE status = 'ACTIVE' AND company_id = ${companyId}`;
        return Number(res[0]?.count || 0);
    }
    /**
     * Total bookings (KPI 5), scoped to company.
     * No status filtering is applied (the KPI is a total booking count).
     */
    static async countBookings(companyId) {
        return await p.booking.count({ where: { company_id: companyId } });
    }
    /**
     * Total confirmed booking value ("Sales Value" KPI). SUM(agreed_price) for
     * CONFIRMED bookings only, scoped to company — represents closed deal value.
     */
    static async bookingSalesValue(companyId) {
        const res = await p.booking.aggregate({
            _sum: { agreed_price: true },
            where: { company_id: companyId, status: 'CONFIRMED' },
        });
        return res._sum.agreed_price || 0;
    }
    /**
     * Outstanding installment value ("Due Payments" KPI). SUM(expected_amount -
     * received_amount) across non-cancelled, not-yet-fully-received installments,
     * scoped to company via the owning Booking. Deliberately a single-table
     * (Installment) aggregate — never touches Payment, to avoid the double-count
     * hazard documented in this file's header comment.
     */
    static async duePayments(companyId) {
        const res = await p.$queryRaw `
      SELECT COALESCE(SUM(i.expected_amount - i.received_amount), 0) as due
      FROM Installment i
      JOIN Booking b ON b.id = i.booking_id
      WHERE b.company_id = ${companyId}
        AND i.status NOT IN ('CANCELLED', 'RECEIVED')
    `;
        return Number(res[0]?.due || 0);
    }
    /**
     * Attendance exceptions today (KPI 7). Preserves md.ts semantics verbatim:
     *   exceptions = active employees - (exempt employees OR employees with a
     *   check-in AttendanceLog today). "Today" uses the same server startOfDay
     *   (local midnight) window as md.ts executive-metrics.
     */
    static async attendanceExceptionsToday(companyId) {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const res = await p.$queryRaw `
      SELECT COUNT(DISTINCT e.id) as count
      FROM Employee e
      LEFT JOIN AttendanceLog a ON a.employee_id = e.id AND a.check_in_at >= ${startOfDay}
      WHERE e.status = 'ACTIVE'
        AND e.company_id = ${companyId}
        AND (e.attendance_required = false OR a.id IS NOT NULL)
    `;
        const totalExemptOrStamped = Number(res[0]?.count || 0);
        const active = await this.countActiveEmployees(companyId);
        const exceptions = Math.max(0, active - totalExemptOrStamped);
        return { exceptions, active };
    }
    /**
     * Target attainment (KPI 9): met/total for today's company-scoped target/report
     * population. Mirrors reports.ts "today" semantics (IST calendar day) and is
     * company-scoped through the owning employee (DailyReport has no company_id).
     */
    static async targetAttainment(companyId) {
        const { dateString } = (0, time_1.getISTComponents)(new Date());
        const gte = new Date(`${dateString}T00:00:00.000+05:30`);
        const lte = new Date(`${dateString}T23:59:59.999+05:30`);
        const where = {
            submitted_at: { gte, lte },
            employee: { company_id: companyId },
        };
        const [total, met] = await Promise.all([
            p.dailyReport.count({ where }),
            p.dailyReport.count({ where: { ...where, target_met: true } }),
        ]);
        const rate = total > 0 ? (0, performance_metric_1.roundPerformanceScore)((met / total) * 100) : 0;
        return { met, total, rate };
    }
    /**
     * Team performance (KPI 8) - company-wide aggregate reusing the centralized
     * Packet A formula (calculatePerformanceScore). Per-employee inputs mirror the
     * existing /performance/team counting exactly; the FORMULA is not duplicated.
     */
    static async teamPerformance(companyId) {
        const employees = await p.employee.findMany({
            where: {
                company_id: companyId,
                deleted_at: null,
                status: 'ACTIVE',
                roles: { none: { role: { is_invisible: true } } },
            },
        });
        const scores = await Promise.all(employees.map(async (emp) => {
            const [tasksDone, tasksOverdue, reportsDone, belowTargetCount, targetExceededEvents, attendanceLogs, uninformedAbsent, propertyBookingContributions] = await Promise.all([
                p.task.count({ where: { assignee_id: emp.id, status: 'COMPLETED' } }),
                p.task.count({ where: { assignee_id: emp.id, status: 'OVERDUE' } }),
                p.dailyReport.count({ where: { employee_id: emp.id } }),
                p.auditEvent.count({ where: { actor_id: emp.id, action: 'DAILY_REPORT_BELOW_TARGET' } }),
                p.auditEvent.count({ where: { actor_id: emp.id, action: 'DAILY_REPORT_TARGET_EXCEEDED' } }),
                p.attendanceLog.findMany({ where: { employee_id: emp.id }, select: { status: true, check_in_at: true } }),
                p.auditEvent.count({ where: { actor_id: emp.id, action: 'UNINFORMED_ABSENT' } }),
                p.auditEvent.count({ where: { actor_id: emp.id, action: 'PROPERTY_BOOKED_CONTRIBUTION' } }),
            ]);
            let presentCount = 0;
            let lateCount = 0;
            let halfDayCount = 0;
            let attendanceBoost = 0;
            for (const log of attendanceLogs) {
                if (log.status === 'PRESENT' || log.status === 'APPROVED_LATE')
                    presentCount++;
                else if (log.status === 'LATE')
                    lateCount++;
                else if (log.status === 'HALF_DAY')
                    halfDayCount++;
                // Only PRESENT feeds the boost — LATE/HALF_DAY stay penalized via
                // lateCount/halfDayCount below; adding calculateAttendancePoints's
                // -1.0 for those here too would double-count the penalty.
                if (log.status === 'PRESENT') {
                    attendanceBoost += (0, time_1.calculateAttendancePoints)(log.status, log.check_in_at, emp.employment_type || 'FULL_TIME');
                }
            }
            return (0, performance_metric_1.calculatePerformanceScore)({
                completedTasks: tasksDone,
                overdueTasks: tasksOverdue,
                dailyReports: reportsDone,
                belowTargetEvents: belowTargetCount,
                targetExceededEvents,
                uninformedAbsentEvents: uninformedAbsent,
                propertyBookingContributions,
                presentCount,
                attendanceBoost,
                lateCount,
                halfDayCount,
            }).score;
        }));
        const totalEmployees = scores.length;
        const averageScore = totalEmployees
            ? (0, performance_metric_1.roundPerformanceScore)(scores.reduce((a, b) => a + b, 0) / totalEmployees)
            : 0;
        const minScore = totalEmployees ? Math.min(...scores) : 0;
        const maxScore = totalEmployees ? Math.max(...scores) : 0;
        return { averageScore, totalEmployees, minScore, maxScore };
    }
    static async countPendingProposals(companyId) {
        const employees = await p.employee.findMany({
            where: { company_id: companyId },
            select: { id: true },
        });
        const res = await p.attendanceProposal.count({
            where: {
                status: 'PENDING',
                employee_id: { in: employees.map((e) => e.id) },
            }
        });
        return res;
    }
    // ---- public: md.ts executive-metrics (delegated, contract-preserving) ----
    static async getExecutiveMetrics(companyId) {
        const [totalLeadsCount, wonLeads, siteVisitsScheduled, property, attendance, pendingProposals, newLeadsCount, contactedLeadsCount, qualifiedLeadsCount, siteVisitsCompletedCount, bookingInitiatedCount, activeCustomersCount, salesValue, duePayments] = await Promise.all([
            this.countLeads(companyId),
            this.countWonLeads(companyId),
            this.countSiteVisitsScheduled(companyId),
            this.propertyDistribution(companyId),
            this.attendanceExceptionsToday(companyId),
            this.countPendingProposals(companyId),
            this.countLeadsByStatus(companyId, 'NEW'),
            this.countLeadsByStatus(companyId, 'CONTACTED'),
            this.countLeadsByStatus(companyId, 'QUALIFIED'),
            this.countLeadsByStatus(companyId, 'SITE_VISIT_COMPLETED'),
            this.countLeadsByStatus(companyId, 'BOOKING_INITIATED'),
            this.countActiveCustomers(companyId),
            this.bookingSalesValue(companyId),
            this.duePayments(companyId),
        ]);
        return {
            totalLeadsCount,
            totalClosedDeals: wonLeads,
            siteVisitsScheduled,
            totalPropertiesCount: property.total,
            livePropertiesCount: property.live,
            pendingApprovalPropertiesCount: property.pendingMD,
            pendingVerificationPropertiesCount: property.pendingPM,
            totalEmployeesCount: attendance.active,
            attendanceExceptionsCount: attendance.exceptions,
            pendingLeaveRequestsCount: pendingProposals,
            newLeadsCount,
            contactedLeadsCount,
            qualifiedLeadsCount,
            siteVisitsCompletedCount,
            bookingInitiatedCount,
            activeCustomersCount,
            salesValue,
            duePayments,
            leadConversionRate: totalLeadsCount > 0 ? Math.round((wonLeads / totalLeadsCount) * 1000) / 10 : 0,
        };
    }
    /**
     * Portal-wide recent activity feed for the MD dashboard ("what's happening
     * in the entire portal"). Reads directly from the source business tables
     * (Lead/Booking/SiteVisitBooking/Complaint) rather than AuditEvent -- the
     * AuditEvent action-string convention isn't reliably written for every one
     * of these event types (see performance-metric.ts's equivalent caveat), so
     * this needs data guaranteed to exist whenever the underlying event happened.
     */
    static async getRecentActivity(companyId, limit = 15) {
        const perSourceLimit = Math.min(limit, 10);
        const [leads, bookings, completedVisits, complaints] = await Promise.all([
            p.lead.findMany({
                where: { company_id: companyId },
                orderBy: { created_at: 'desc' },
                take: perSourceLimit,
                select: { id: true, lead_code: true, customer_name: true, created_at: true },
            }),
            p.booking.findMany({
                where: { company_id: companyId },
                orderBy: { created_at: 'desc' },
                take: perSourceLimit,
                select: { id: true, booking_code: true, agreed_price: true, status: true, created_at: true },
            }),
            p.siteVisitBooking.findMany({
                where: { status: 'COMPLETED', lead: { company_id: companyId } },
                orderBy: { completed_at: 'desc' },
                take: perSourceLimit,
                select: { id: true, booking_code: true, completed_at: true },
            }),
            p.complaint.findMany({
                where: { company_id: companyId },
                orderBy: { created_at: 'desc' },
                take: perSourceLimit,
                select: { id: true, complaint_code: true, title: true, created_at: true },
            }),
        ]);
        const activity = [
            ...leads.map((l) => ({
                id: `lead-${l.id}`,
                type: 'LEAD_CREATED',
                title: `New lead: ${l.customer_name}`,
                subtitle: l.lead_code,
                timestamp: l.created_at,
                link: '/leads',
            })),
            ...bookings.map((b) => ({
                id: `booking-${b.id}`,
                type: 'BOOKING_CREATED',
                title: `Booking ${b.status === 'CONFIRMED' ? 'confirmed' : 'created'}: ₹${b.agreed_price.toLocaleString()}`,
                subtitle: b.booking_code,
                timestamp: b.created_at,
                link: '/bookings',
            })),
            ...completedVisits.filter((v) => v.completed_at).map((v) => ({
                id: `visit-${v.id}`,
                type: 'SITE_VISIT_COMPLETED',
                title: `Site visit completed: ${v.booking_code}`,
                subtitle: null,
                timestamp: v.completed_at,
                link: '/site-visits',
            })),
            ...complaints.map((c) => ({
                id: `complaint-${c.id}`,
                type: 'COMPLAINT_FILED',
                title: `Complaint filed: ${c.title}`,
                subtitle: c.complaint_code,
                timestamp: c.created_at,
                link: '/complaints',
            })),
        ];
        activity.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        return activity.slice(0, limit);
    }
    // ---- public: unified analytics KPI contract ----
    static async getKpis(companyId, user) {
        const [totalLeads, wonLeads, siteVisitsScheduled, dropOffByStage, property, totalBookings, attendance, teamPerf, targets, marketing,] = await Promise.all([
            this.countLeads(companyId),
            this.countWonLeads(companyId),
            this.countSiteVisitsScheduled(companyId),
            this.dropOffByStage(companyId),
            this.propertyDistribution(companyId),
            this.countBookings(companyId),
            this.attendanceExceptionsToday(companyId),
            this.teamPerformance(companyId),
            this.targetAttainment(companyId),
            integration_service_1.IntegrationService.getPortalMetrics(companyId, {}),
        ]);
        // Opportunity KPIs reuse the existing service (company-scoped by policy).
        // For management roles (MD/Admin) OpportunityPolicy.canList scopes to the
        // user's whole company; the authenticated user is already ADMIN_SYSTEM_METRICS
        // gated, so this never crosses tenant boundaries.
        const [pipelineMetrics] = await Promise.all([
            opportunity_service_1.OpportunityService.getPipelineMetrics(user),
        ]);
        return {
            companyId,
            generatedAt: new Date().toISOString(),
            crm: { totalLeads, wonLeads, siteVisitsScheduled, dropOffByStage },
            property,
            opportunity: { pipelineMetrics },
            booking: { totalBookings },
            hr: { activeEmployees: attendance.active, attendanceExceptionsToday: attendance.exceptions },
            performance: { teamPerformance: teamPerf },
            targets: { targetAttainment: targets },
            marketing,
        };
    }
    static async getSalesManagerDashboard(companyId, user) {
        const today = new Date();
        const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        const allLeads = await p.lead.findMany({
            where: { company_id: companyId },
            select: {
                id: true,
                status: true,
                assigned_to_id: true,
                created_by_id: true,
                last_contacted_at: true,
                created_at: true,
            }
        });
        const kpis = {
            totalLeads: allLeads.length,
            newLeads: allLeads.filter((l) => l.status === 'NEW').length,
            unassignedLeads: allLeads.filter((l) => !l.assigned_to_id).length,
            contacted: allLeads.filter((l) => l.status === 'CONTACTED').length,
            qualified: allLeads.filter((l) => l.status === 'QUALIFIED').length,
            siteVisits: allLeads.filter((l) => l.status === 'SITE_VISIT_SCHEDULED').length,
            won: allLeads.filter((l) => l.status === 'BOOKED').length,
            conversionRate: allLeads.length > 0 ? (allLeads.filter((l) => l.status === 'BOOKED').length / allLeads.length) * 100 : 0
        };
        const pipelineCounts = allLeads.reduce((acc, lead) => {
            acc[lead.status] = (acc[lead.status] || 0) + 1;
            return acc;
        }, {});
        const statuses = ['NEW', 'ASSIGNED', 'CONTACTED', 'QUALIFIED', 'DEMO_SCHEDULED', 'DEMO_COMPLETED', 'SITE_VISIT_SCHEDULED', 'SITE_VISIT_COMPLETED', 'NEGOTIATION', 'BOOKING_INITIATED', 'BOOKED', 'DROPPED', 'RECOVERED_TO_POOL'];
        const pipeline = statuses.map(status => ({
            status,
            count: pipelineCounts[status] || 0
        }));
        const stalledLeadsQuery = await p.lead.findMany({
            where: {
                company_id: companyId,
                status: { notIn: ['BOOKED', 'DROPPED'] },
                OR: [
                    { last_contacted_at: { lt: sevenDaysAgo } },
                    { last_contacted_at: null, created_at: { lt: sevenDaysAgo } }
                ]
            },
            include: {
                assigned_to: { select: { id: true, full_name: true, employee_code: true } }
            },
            orderBy: { last_contacted_at: 'asc' },
            take: 20
        });
        const recoveredUnassignedLeadsQuery = await p.lead.findMany({
            where: {
                company_id: companyId,
                status: 'RECOVERED_TO_POOL',
                assigned_to_id: null
            },
            include: {
                assigned_to: { select: { id: true, full_name: true, employee_code: true } }
            },
            orderBy: { created_at: 'desc' },
            take: 20
        });
        const overdueTasksQuery = await p.task.findMany({
            where: {
                status: 'PENDING',
                target_date: { lt: today },
                assignee: { company_id: companyId }
            },
            include: {
                assignee: { select: { id: true, full_name: true, employee_code: true } },
                lead: { select: { id: true, customer_name: true } },
                opportunity: { select: { id: true, opportunity_code: true } }
            },
            orderBy: { target_date: 'asc' },
            take: 20
        });
        const siteVisitsQuery = await p.siteVisitBooking.groupBy({
            by: ['status'],
            where: { lead: { company_id: companyId } },
            _count: { id: true }
        });
        const siteVisits = siteVisitsQuery.reduce((acc, item) => {
            acc[item.status] = item._count.id;
            return acc;
        }, {});
        const targets = await this.targetAttainment(companyId);
        const employeeIds = new Set();
        allLeads.forEach((l) => {
            if (l.assigned_to_id)
                employeeIds.add(l.assigned_to_id);
            if (l.created_by_id)
                employeeIds.add(l.created_by_id);
        });
        const employees = await p.employee.findMany({
            where: { id: { in: Array.from(employeeIds) }, company_id: companyId },
            select: { id: true, full_name: true, employee_code: true }
        });
        const teamPerformance = [];
        const leadAttribution = [];
        employees.forEach((emp) => {
            const assigned = allLeads.filter((l) => l.assigned_to_id === emp.id);
            if (assigned.length > 0) {
                teamPerformance.push({
                    employee: emp,
                    assignedLeads: assigned.length,
                    contacted: assigned.filter((l) => l.status === 'CONTACTED').length,
                    qualified: assigned.filter((l) => l.status === 'QUALIFIED').length,
                    siteVisits: assigned.filter((l) => l.status === 'SITE_VISIT_SCHEDULED').length,
                    won: assigned.filter((l) => l.status === 'BOOKED').length,
                    conversionRate: (assigned.filter((l) => l.status === 'BOOKED').length / assigned.length) * 100
                });
            }
            const introduced = allLeads.filter((l) => l.created_by_id === emp.id);
            if (introduced.length > 0) {
                leadAttribution.push({
                    employee: emp,
                    leadsIntroduced: introduced.length,
                    qualified: introduced.filter((l) => l.status === 'QUALIFIED').length,
                    siteVisits: introduced.filter((l) => l.status === 'SITE_VISIT_SCHEDULED').length,
                    won: introduced.filter((l) => l.status === 'BOOKED').length,
                    conversionRate: (introduced.filter((l) => l.status === 'BOOKED').length / introduced.length) * 100
                });
            }
        });
        leadAttribution.sort((a, b) => b.leadsIntroduced - a.leadsIntroduced);
        teamPerformance.sort((a, b) => b.assignedLeads - a.assignedLeads);
        return {
            kpis,
            pipeline,
            teamPerformance,
            leadAttribution,
            stalledLeads: stalledLeadsQuery,
            recoveredUnassignedLeads: recoveredUnassignedLeadsQuery,
            overdueTasks: overdueTasksQuery,
            siteVisits,
            targets
        };
    }
    /**
     * Real replacement for HRDashboard's previously-hardcoded trend badges
     * (Phase-19 audit #7): headcount + new-hires-this-month, an actual
     * day-specific "on leave today" count (sourced from approved LEAVE
     * AttendanceProposal rows rather than an employee's permanent status
     * field, which never changes back after the leave day passes), and
     * this-month vs last-month lead conversion.
     */
    static async getHrOverview(companyId) {
        const now = new Date();
        const { dateString: todayStr } = (0, time_1.getISTComponents)(now);
        const { dateString: yesterdayStr } = (0, time_1.getISTComponents)(new Date(now.getTime() - 24 * 60 * 60 * 1000));
        const [year, month] = todayStr.split('-').map(Number);
        const { startOfMonth, endOfMonth } = (0, time_1.getISTMonthRange)(year, month);
        const { dateString: prevMonthAnchorStr } = (0, time_1.getISTComponents)(new Date(startOfMonth.getTime() - 1));
        const [prevYear, prevMonth] = prevMonthAnchorStr.split('-').map(Number);
        const { startOfMonth: startOfPrevMonth, endOfMonth: endOfPrevMonth } = (0, time_1.getISTMonthRange)(prevYear, prevMonth);
        // AttendanceProposal has no Prisma relation to Employee (just a raw
        // employee_id column), so company scoping has to go through an explicit
        // employee-id lookup rather than a nested relation filter.
        const companyEmployeeIds = (await p.employee.findMany({ where: { company_id: companyId }, select: { id: true } })).map((e) => e.id);
        const [headcount, newHiresThisMonth, onLeaveToday, onLeaveYesterday, leadsThisMonth, leadsLastMonth,] = await Promise.all([
            p.employee.count({ where: { company_id: companyId, status: 'ACTIVE' } }),
            p.employee.count({ where: { company_id: companyId, created_at: { gte: startOfMonth, lte: endOfMonth } } }),
            p.attendanceProposal.count({
                where: { type: 'LEAVE', status: 'APPROVED', target_date: (0, time_1.getISTMidnightInstant)(todayStr), employee_id: { in: companyEmployeeIds } },
            }),
            p.attendanceProposal.count({
                where: { type: 'LEAVE', status: 'APPROVED', target_date: (0, time_1.getISTMidnightInstant)(yesterdayStr), employee_id: { in: companyEmployeeIds } },
            }),
            p.lead.findMany({ where: { company_id: companyId, created_at: { gte: startOfMonth, lte: endOfMonth } }, select: { status: true } }),
            p.lead.findMany({ where: { company_id: companyId, created_at: { gte: startOfPrevMonth, lte: endOfPrevMonth } }, select: { status: true } }),
        ]);
        const conversionRate = (leads) => leads.length > 0 ? (leads.filter((l) => l.status === 'BOOKED').length / leads.length) * 100 : 0;
        return {
            headcount,
            newHiresThisMonth,
            onLeaveToday,
            onLeaveYesterday,
            conversionThisMonth: conversionRate(leadsThisMonth),
            conversionLastMonth: conversionRate(leadsLastMonth),
        };
    }
}
exports.AnalyticsService = AnalyticsService;
exports.default = AnalyticsService;
