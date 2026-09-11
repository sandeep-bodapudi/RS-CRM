"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyTransition = exports.resolveVisitProject = exports.generateNextBookingCode = void 0;
const prisma_1 = require("../../lib/prisma");
const workflowEngine_1 = require("../../workflows/workflowEngine");
const types_1 = require("../../workflows/types");
const p = prisma_1.prisma;
async function generateNextBookingCode() {
    const currentYear = new Date().getFullYear();
    const prefix = `RRH-SV-${currentYear}-`;
    const count = await p.siteVisitBooking.count();
    let seq = count + 1;
    for (;;) {
        const candidate = `${prefix}${String(seq).padStart(4, '0')}`;
        const existing = await p.siteVisitBooking.findUnique({ where: { booking_code: candidate } });
        if (!existing) {
            return candidate;
        }
        seq++;
    }
}
exports.generateNextBookingCode = generateNextBookingCode;
/**
 * Resolve the authoritative project PM for the given property list.
 * §2 constraint: all properties in a single booking must belong to the SAME
 * project, so we validate that and take that project's assigned_pm_id.
 */
async function resolveVisitProject(data, companyId) {
    // Determine project from an explicit project_id or from the properties.
    let projectId = data.project_id ?? null;
    const propertyIds = data.property_ids && Array.isArray(data.property_ids)
        ? data.property_ids
        : (data.property_id ? [data.property_id] : []);
    if (propertyIds.length > 0) {
        const properties = await p.property.findMany({
            where: { id: { in: propertyIds }, company_id: companyId },
        });
        const projects = new Set(properties.map((pr) => pr.project_id).filter(Boolean));
        if (projects.size > 1) {
            throw { status: 400, message: '§2: All properties in a single site visit must belong to the same project.' };
        }
        if (projects.size === 1) {
            projectId = [...projects][0];
        }
    }
    if (!projectId) {
        return { projectId: 0, pmId: null };
    }
    const project = await p.project.findFirst({ where: { id: projectId } });
    return { projectId, pmId: project?.assigned_pm_id ?? null };
}
exports.resolveVisitProject = resolveVisitProject;
/** Helper: run an action through the workflow engine and persist the next status. */
async function applyTransition(user, visitId, action, extraData = {}, activityType, activityNotes) {
    const visit = await p.siteVisitBooking.findFirst({
        where: { id: visitId, lead: {} },
        include: { lead: true },
    });
    if (!visit) {
        throw { status: 404, message: 'Site visit booking not found' };
    }
    const transition = workflowEngine_1.WorkflowEngine.canTransition({
        domain: types_1.WorkflowDomain.SITE_VISIT,
        currentState: visit.status,
        action,
        actor: user,
        entity: visit,
    });
    if (!transition.allowed) {
        throw { status: 409, message: transition.reason || 'Invalid state transition' };
    }
    return await p.$transaction(async (tx) => {
        const updated = await tx.siteVisitBooking.update({
            where: { id: visitId },
            data: { status: transition.nextState, ...extraData },
        });
        await tx.leadActivity.create({
            data: {
                lead: { connect: { id: visit.lead_id } },
                actor: { connect: { id: user.employeeId } },
                activity_type: activityType,
                notes: activityNotes,
            },
        });
        return updated;
    });
}
exports.applyTransition = applyTransition;
