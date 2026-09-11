"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bookVisit = exports.listVisits = void 0;
const prisma_1 = require("../../lib/prisma");
const shared_1 = require("../../shared");
const authorization_1 = require("../../authz/authorization");
const workflowEngine_1 = require("../../workflows/workflowEngine");
const types_1 = require("../../workflows/types");
const siteVisit_policy_1 = require("../../policies/siteVisit.policy");
const shared_2 = require("./shared");
const notifyEmployee_1 = require("../../utils/notifyEmployee");
const logger_1 = require("../../utils/logger");
const p = prisma_1.prisma;
async function listVisits(user, filters) {
    const whereCondition = siteVisit_policy_1.SiteVisitPolicy.canList(user);
    if (filters.escalated) {
        whereCondition.status = {
            in: ['PENDING_ACCEPTANCE', 'ESCALATED_TO_MARKETING_DIRECTOR']
        };
        whereCondition.OR = [
            { status: 'ESCALATED_TO_MARKETING_DIRECTOR' },
            {
                escalation: {
                    OR: [
                        { marketing_director_notified_at: { not: null } },
                        { managing_director_notified_at: { not: null } }
                    ]
                }
            }
        ];
    }
    else if (filters.status) {
        whereCondition.status = filters.status;
    }
    if (filters.leadId) {
        whereCondition.lead_id = parseInt(filters.leadId, 10);
    }
    const visits = await p.siteVisitBooking.findMany({
        where: whereCondition,
        include: {
            lead: { select: { id: true, lead_code: true, customer_name: true, phone: true, preferred_location: true, company_id: true } },
            telecaller: { select: { id: true, employee_code: true, full_name: true, phone: true } },
            project_manager: { select: { id: true, employee_code: true, full_name: true, phone: true } },
            assigned_agent: { select: { id: true, employee_code: true, full_name: true, phone: true } },
            property: { select: { id: true, property_code: true, title: true, status: true } },
            project: { select: { id: true, project_code: true, name: true, status: true } },
            site_visit_properties: {
                include: { property: { select: { id: true, property_code: true, title: true } } },
            },
            reassignments: {
                orderBy: { created_at: 'asc' },
                include: {
                    from_employee: { select: { id: true, full_name: true } },
                    to_employee: { select: { id: true, full_name: true } },
                },
            },
            escalation: true,
        },
        orderBy: { scheduled_date: 'asc' },
    });
    // §2: reassignment `reason` visibility is restricted to executive-department
    // roles (MD, Admin, HR Manager, Marketing Director, Project Manager per the
    // SiteVisitPolicy.isManagement set). Telecallers/Agents see only who was
    // involved, never the reason behind a reassignment hop.
    if (!siteVisit_policy_1.SiteVisitPolicy.canViewReassignmentReason(user)) {
        for (const v of visits) {
            for (const r of v.reassignments) {
                delete r.reason;
            }
            // Blind Approval: Omit PII for PENDING_ACCEPTANCE visits unless the user is the telecaller who booked it.
            // MDs/Admins bypass this via canViewReassignmentReason.
            if (v.status === 'PENDING_ACCEPTANCE' && v.telecaller?.id !== user.employeeId) {
                if (v.lead) {
                    delete v.lead.customer_name;
                    delete v.lead.phone;
                    delete v.lead.email;
                }
            }
        }
    }
    return visits;
}
exports.listVisits = listVisits;
/** bookVisit: create the booking (REQUESTED) + property links, auto-route to PENDING_ACCEPTANCE. */
async function bookVisit(user, data) {
    const lead = await p.lead.findFirst({ where: { id: data.lead_id, } });
    if (!lead) {
        throw { status: 404, message: 'Lead not found' };
    }
    if (!(0, authorization_1.can)(user, shared_1.Permissions.SITE_VISITS_CREATE, lead)) {
        throw { status: 403, message: 'Forbidden: Missing site_visits.create permission or Lead is not in your company' };
    }
    if (data.opportunity_id) {
        const opportunity = await p.opportunity.findFirst({ where: { id: data.opportunity_id, } });
        if (!opportunity) {
            throw { status: 404, message: 'Opportunity not found' };
        }
        if (opportunity.company_id !== user.companyId) {
            throw { status: 403, message: 'Forbidden: Opportunity belongs to another company' };
        }
        if (opportunity.lead_id !== data.lead_id) {
            throw { status: 400, message: 'Opportunity does not belong to the specified Lead' };
        }
    }
    const propertyIds = Array.isArray(data.property_ids)
        ? data.property_ids
        : (data.property_id ? [data.property_id] : []);
    if (propertyIds.length > 0) {
        const props = await p.property.findMany({ where: { id: { in: propertyIds }, company_id: user.companyId } });
        if (props.length !== propertyIds.length) {
            throw { status: 404, message: 'One or more properties not found' };
        }
        // §2 constraint: same project.
        const projects = new Set(props.map((pr) => pr.project_id).filter(Boolean));
        if (projects.size > 1) {
            throw { status: 400, message: '§2: All properties in a single site visit must belong to the same project.' };
        }
    }
    const { projectId, pmId } = await (0, shared_2.resolveVisitProject)(data, user.companyId || 1);
    return await p.$transaction(async (tx) => {
        const bookingCode = await (0, shared_2.generateNextBookingCode)();
        const bookingData = {
            booking_code: bookingCode,
            lead: { connect: { id: data.lead_id } },
            telecaller: { connect: { id: user.employeeId } },
            scheduled_date: new Date(data.scheduled_date),
            status: 'REQUESTED',
            verification_call_notes: data.notes || 'Site visit booked by telecaller.',
        };
        if (data.opportunity_id)
            bookingData.opportunity = { connect: { id: data.opportunity_id } };
        if (propertyIds.length > 0) {
            // Single property column kept for backward compatibility (first property).
            bookingData.property = { connect: { id: propertyIds[0] } };
        }
        if (projectId) {
            bookingData.project = { connect: { id: projectId } };
        }
        const booking = await tx.siteVisitBooking.create({ data: bookingData });
        // §2 property links (multi-property outcome capture)
        if (propertyIds.length > 0) {
            await tx.siteVisitProperty.createMany({
                data: propertyIds.map((pid) => ({ visit_id: booking.id, property_id: pid })),
            });
        }
        // Auto-route REQUESTED → PENDING_ACCEPTANCE (to the project's assigned PM)
        const route = workflowEngine_1.WorkflowEngine.canTransition({
            domain: types_1.WorkflowDomain.SITE_VISIT,
            currentState: 'REQUESTED',
            action: 'ROUTE',
            actor: user,
            entity: { id: booking.id },
        });
        if (!route.allowed) {
            throw { status: 409, message: route.reason || 'Invalid site visit transition' };
        }
        const updatedBooking = await tx.siteVisitBooking.update({
            where: { id: booking.id },
            data: { status: route.nextState, project_manager_id: pmId ?? undefined },
            include: {
                lead: true,
                property: true,
                project: true,
                telecaller: true,
                project_manager: true,
                assigned_agent: true
            }
        });
        // Activity log
        await tx.leadActivity.create({
            data: {
                lead: { connect: { id: data.lead_id } },
                activity_type: 'SITE_VISIT_REQUESTED',
                notes: `Site visit scheduled. Auto-routed to project PM.`,
                actor: { connect: { id: user.employeeId } },
            },
        });
        // Notifications
        const notifyId = pmId ?? undefined;
        if (notifyId) {
            await tx.notification.create({
                data: {
                    employee_id: notifyId,
                    type: 'TARGET_ASSIGNED',
                    title: 'New Site Visit to Accept',
                    message: `Site visit ${updatedBooking.booking_code} requires your acceptance.`,
                },
            });
            // Web push to PM (outside transaction)
            (0, notifyEmployee_1.notifyEmployee)(notifyId, {
                type: 'TARGET_ASSIGNED',
                title: 'New Site Visit to Accept',
                message: `Site visit ${updatedBooking.booking_code} requires your acceptance.`,
            }, { skipDbNotification: true }).catch(err => logger_1.logger.error('[WebPush] Site visit route PM:', err));
        }
        else {
            // Immediate Escalation Fallback for unmapped PM
            await tx.siteVisitEscalation.create({
                data: {
                    site_visit_booking_id: booking.id,
                    marketing_director_notified_at: new Date()
                }
            });
            const marketingDirectors = await tx.employee.findMany({
                where: { roles: { some: { role: { name: shared_1.Roles.MARKETING_DIRECTOR } } }, status: 'ACTIVE' },
                select: { id: true }
            });
            if (marketingDirectors.length > 0) {
                await tx.notification.createMany({
                    data: marketingDirectors.map((md) => ({
                        employee_id: md.id,
                        type: 'SYSTEM_ALERT',
                        title: 'Unassigned Site Visit',
                        message: `Site visit ${updatedBooking.booking_code} has no active project PM. Please reassign manually.`,
                    }))
                });
                // Web push to marketing directors (outside transaction)
                for (const md of marketingDirectors) {
                    (0, notifyEmployee_1.notifyEmployee)(md.id, {
                        type: 'SYSTEM_ALERT',
                        title: 'Unassigned Site Visit',
                        message: `Site visit ${updatedBooking.booking_code} has no active project PM — please reassign.`,
                    }, { skipDbNotification: true }).catch(err => logger_1.logger.error('[WebPush] Site visit escalation MD:', err));
                }
            }
        }
        return updatedBooking;
    });
}
exports.bookVisit = bookVisit;
