"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectService = void 0;
const prisma_1 = require("../lib/prisma");
const client_1 = require("@prisma/client");
const dataScope_1 = require("../authz/dataScope");
const shared_1 = require("../shared");
const authorization_1 = require("../authz/authorization");
const slugify_1 = require("../utils/slugify");
const cache_1 = require("../utils/cache");
const storage_service_1 = require("./storage.service");
const logger_1 = require("../utils/logger");
const notifyEmployee_1 = require("../utils/notifyEmployee");
const workflowEngine_1 = require("../workflows/workflowEngine");
const types_1 = require("../workflows/types");
const p = prisma_1.prisma;
// Fields common to ProjectCreateInput/ProjectUpdateInput beyond the original
// (Phase <2.5) set — see ProjectCommonFields in shared/project.ts. Shared by
// createProject/updateProject so both use identical mapping. Only keys
// present in `data` are included (matching the "?? null" style already used
// for the original fields) — safe for both a full create payload (an omitted
// field simply stores NULL, which is the correct default for every one of
// these nullable columns) and a partial update (an omitted field is left
// untouched by not appearing in the returned object at all).
function mapCommonProjectFields(data) {
    const out = {};
    const passthroughKeys = [
        'project_type', 'developer_name', 'state', 'district', 'city', 'mandal', 'village',
        'locality', 'address', 'pincode', 'latitude', 'longitude', 'maps_link',
        'total_area_value', 'towers_count', 'blocks_count', 'floors_count',
        'rera_status', 'approval_authority', 'approval_number', 'lp_number',
        'default_price_basis', 'default_area_unit', 'total_area_unit', 'cover_image_url',
    ];
    for (const key of passthroughKeys) {
        if (data[key] !== undefined)
            out[key] = data[key];
    }
    if (data.completion_date !== undefined) {
        out.completion_date = data.completion_date ? new Date(data.completion_date) : null;
    }
    return out;
}
class ProjectService {
    static async generateNextProjectCode() {
        const currentYear = new Date().getFullYear();
        const count = await p.project.count();
        const seq = (count + 1).toString().padStart(4, '0');
        return `RRH-PJ-${currentYear}-${seq}`;
    }
    static async listProjects(user, filters, take = 50, skip = 0) {
        const whereCondition = await (0, dataScope_1.buildProjectScope)(user);
        if (filters.status) {
            whereCondition.status = filters.status;
        }
        const cacheKey = `projects_${user.employeeId}_${JSON.stringify(filters)}_${take}_${skip}`;
        return await (0, cache_1.fetchWithCache)(cacheKey, async () => {
            return await p.project.findMany({
                where: whereCondition,
                take,
                skip,
                include: {
                    assigned_pm: { select: { id: true, employee_code: true, full_name: true, phone: true } },
                },
                orderBy: { created_at: 'desc' },
            });
        });
    }
    static async getProject(user, projectId) {
        const whereCondition = await (0, dataScope_1.buildProjectScope)(user);
        const project = await p.project.findFirst({
            where: {
                id: projectId,
                ...whereCondition,
            },
            include: {
                assigned_pm: { select: { id: true, employee_code: true, full_name: true, phone: true } },
                properties: {
                    select: {
                        id: true,
                        property_code: true,
                        title: true,
                        status: true,
                    }
                }
            }
        });
        if (!project)
            throw { status: 404, message: 'Project not found or unauthorized' };
        return project;
    }
    static async createProject(user, data) {
        const companyId = user.companyId || 1;
        const branchId = user.branchId || null;
        if (data.assigned_pm_id) {
            const pm = await p.employee.findFirst({
                where: { id: data.assigned_pm_id, company_id: companyId }
            });
            if (!pm)
                throw { status: 400, message: 'Invalid assigned_pm_id or does not belong to your company' };
        }
        const baseSlug = (0, slugify_1.slugify)(`${data.name} ${data.location}`);
        const slug = await (0, slugify_1.generateUniqueSlug)(baseSlug, companyId, async (s, cId) => {
            const existing = await p.project.findFirst({ where: { slug: s, company_id: cId } });
            return !!existing;
        });
        const MAX_RETRIES = 3;
        let retries = 0;
        while (retries < MAX_RETRIES) {
            try {
                const projectCode = await this.generateNextProjectCode();
                const project = await p.project.create({
                    data: {
                        project_code: projectCode,
                        company_id: companyId,
                        branch_id: branchId,
                        name: data.name,
                        description: data.description || null,
                        location: data.location,
                        total_area: data.total_area || null,
                        total_units: data.total_units || null,
                        launch_date: data.launch_date ? new Date(data.launch_date) : null,
                        project_phase: data.project_phase || null,
                        rera_number: data.rera_number || null,
                        amenities: data.amenities || null,
                        assigned_pm_id: data.assigned_pm_id || null,
                        status: 'PLANNING',
                        slug,
                        ...mapCommonProjectFields(data),
                    },
                });
                // Notify the assigned PM if one was set
                if (data.assigned_pm_id) {
                    await p.notification.create({
                        data: {
                            employee_id: data.assigned_pm_id,
                            type: 'PROJECT_ASSIGNED',
                            title: `New Project Assigned: ${projectCode}`,
                            message: `Project "${data.name}" (${projectCode}) has been created and assigned to you.`,
                        },
                    });
                    // Web push to assigned PM (outside transaction)
                    (0, notifyEmployee_1.notifyEmployee)(data.assigned_pm_id, {
                        type: 'PROJECT_ASSIGNED',
                        title: `New Project Assigned: ${projectCode}`,
                        message: `Project "${data.name}" (${projectCode}) has been created and assigned to you.`,
                    }, { skipDbNotification: true }).catch(err => logger_1.logger.error('[WebPush] Create project PM notify:', err));
                }
                return project;
            }
            catch (error) {
                if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                    // Unique constraint violation (likely project_code collision due to concurrency)
                    const target = error.meta?.target;
                    if (target && target.includes('project_code')) {
                        retries++;
                        continue; // Retry with a new code
                    }
                }
                // If it's a different error or not a project_code collision, throw it
                throw error;
            }
        }
        throw { status: 500, message: 'Failed to generate unique project code after multiple retries' };
    }
    static async updateProject(user, projectId, data) {
        const whereCondition = await (0, dataScope_1.buildProjectScope)(user);
        const project = await p.project.findFirst({
            where: {
                id: projectId,
                ...whereCondition,
            }
        });
        if (!project)
            throw { status: 404, message: 'Project not found or unauthorized' };
        // Core fields are locked while a project is PENDING_VERIFICATION (awaiting MD review).
        // PM can still update media, documents, and images via separate endpoints.
        const CORE_LOCKED_FIELDS = ['name', 'description', 'location', 'total_area', 'total_units',
            'launch_date', 'project_phase', 'rera_number', 'assigned_pm_id', 'project_type', 'developer_name', 'status'];
        if (project.status === 'PENDING_VERIFICATION') {
            const attemptedCoreChange = CORE_LOCKED_FIELDS.some((f) => data[f] !== undefined);
            if (attemptedCoreChange) {
                throw { status: 409, message: 'Core project details are locked while pending MD verification. Only media and documents may be updated.' };
            }
        }
        if (data.assigned_pm_id && data.assigned_pm_id !== project.assigned_pm_id) {
            const pm = await p.employee.findFirst({
                where: { id: data.assigned_pm_id, company_id: user.companyId }
            });
            if (!pm)
                throw { status: 400, message: 'Invalid assigned_pm_id or does not belong to your company' };
        }
        // Explicit safe-fields whitelist — status is handled separately below via
        // the workflow engine (Phase 2.5), mirroring PropertyService.updateProperty's
        // "safe-fields + separate status path" pattern, instead of accepting any
        // status enum value unconditionally.
        const updateData = {};
        if (data.name !== undefined)
            updateData.name = data.name;
        if (data.description !== undefined)
            updateData.description = data.description;
        if (data.location !== undefined)
            updateData.location = data.location;
        if (data.total_area !== undefined)
            updateData.total_area = data.total_area;
        if (data.total_units !== undefined)
            updateData.total_units = data.total_units;
        if (data.launch_date !== undefined)
            updateData.launch_date = data.launch_date ? new Date(data.launch_date) : null;
        if (data.project_phase !== undefined)
            updateData.project_phase = data.project_phase;
        if (data.rera_number !== undefined)
            updateData.rera_number = data.rera_number;
        if (data.amenities !== undefined)
            updateData.amenities = data.amenities;
        if (data.assigned_pm_id !== undefined)
            updateData.assigned_pm_id = data.assigned_pm_id;
        Object.assign(updateData, mapCommonProjectFields(data));
        // No UI sends an abstract action verb for Project (unlike Lead/Property) —
        // the existing edit form has always sent the desired target status directly,
        // so the workflow engine's "action" here is literally that target status.
        // A resubmission with the project's current, unchanged status is a no-op,
        // not a transition, and skips the check entirely.
        if (data.status !== undefined && data.status !== project.status) {
            const transition = workflowEngine_1.WorkflowEngine.canTransition({
                domain: types_1.WorkflowDomain.PROJECT,
                currentState: project.status,
                action: data.status,
                actor: user,
                entity: project,
            });
            if (!transition.allowed) {
                throw { status: 409, message: transition.reason || 'Invalid state transition' };
            }
            updateData.status = transition.nextState;
            return await p.$transaction(async (tx) => {
                const updated = await tx.project.update({ where: { id: projectId }, data: updateData });
                await tx.auditEvent.create({
                    data: {
                        actor_id: user.employeeId,
                        action: 'STATUS_CHANGE',
                        entity_type: 'PROJECT',
                        entity_id: projectId,
                        old_value: project.status,
                        new_value: transition.nextState,
                    },
                });
                return updated;
            });
        }
        // Handle PM reassignment via the general edit form (PUT /projects/:id)
        let finalProject = null;
        if (data.assigned_pm_id !== undefined && data.assigned_pm_id !== project.assigned_pm_id) {
            const newPmId = data.assigned_pm_id;
            const oldPmId = project.assigned_pm_id;
            finalProject = await p.$transaction(async (tx) => {
                const updated = await tx.project.update({
                    where: { id: projectId },
                    data: { assigned_pm_id: newPmId },
                });
                // Notify the new PM
                if (newPmId) {
                    await tx.notification.create({
                        data: {
                            employee_id: newPmId,
                            type: 'PROJECT_ASSIGNED',
                            title: `Project Assigned to You: ${updated.project_code}`,
                            message: `Project "${updated.name}" (${updated.project_code}) has been assigned to you.`,
                        },
                    });
                    // Web push to new PM (outside transaction)
                    (0, notifyEmployee_1.notifyEmployee)(newPmId, {
                        type: 'PROJECT_ASSIGNED',
                        title: `Project Assigned to You: ${updated.project_code}`,
                        message: `Project "${updated.name}" (${updated.project_code}) has been assigned to you.`,
                    }, { skipDbNotification: true }).catch(err => logger_1.logger.error('[WebPush] Project PM changed new PM:', err));
                }
                // Notify the old PM (if exists)
                if (oldPmId) {
                    await tx.notification.create({
                        data: {
                            employee_id: oldPmId,
                            type: 'PROJECT_REASSIGNED',
                            title: `Project Reassigned: ${updated.project_code}`,
                            message: `Project "${updated.name}" (${updated.project_code}) has been reassigned from you.`,
                        },
                    });
                    // Web push to old PM (outside transaction)
                    (0, notifyEmployee_1.notifyEmployee)(oldPmId, {
                        type: 'PROJECT_REASSIGNED',
                        title: `Project Reassigned: ${updated.project_code}`,
                        message: `Project "${updated.name}" (${updated.project_code}) has been reassigned from you.`,
                    }, { skipDbNotification: true }).catch(err => logger_1.logger.error('[WebPush] Project PM changed old PM:', err));
                }
                return updated;
            });
        }
        if (finalProject) {
            return finalProject;
        }
        return await p.project.update({
            where: { id: projectId },
            data: updateData,
        });
    }
    static async deleteProject(user, projectId) {
        const whereCondition = await (0, dataScope_1.buildProjectScope)(user);
        const project = await p.project.findFirst({
            where: {
                id: projectId,
                ...whereCondition,
            }
        });
        if (!project)
            throw { status: 404, message: 'Project not found or unauthorized' };
        // Deleting an already-cancelled project is a no-op success (DELETE should
        // be idempotent), not a workflow error.
        if (project.status === 'CANCELLED')
            return project;
        const transition = workflowEngine_1.WorkflowEngine.canTransition({
            domain: types_1.WorkflowDomain.PROJECT,
            currentState: project.status,
            action: 'CANCELLED',
            actor: user,
            entity: project,
        });
        if (!transition.allowed) {
            throw { status: 409, message: transition.reason || 'Invalid state transition' };
        }
        // Phase 2.10: hard block cancellation while any unit underneath is still
        // active inventory. Chosen over a "cancel anyway" confirmation step
        // because a customer with a live booking on a "cancelled" project is a
        // real data-integrity problem, not just a UX nicety — resolving or moving
        // those units is a deliberate action a PM/MD should take explicitly
        // first, not something to bypass with a single extra click.
        const activePropertyCount = await p.property.count({
            where: { project_id: projectId, status: { in: ['LIVE', 'LOCKED', 'BOOKED'] } },
        });
        // Same guard, extended to ProjectUnit: any unit that is still sellable or
        // already committed to a customer (AVAILABLE/HOLD/RESERVED/BOOKED/SOLD)
        // blocks cancellation. BLOCKED/UNAVAILABLE units have already been
        // administratively taken off the table and do not block.
        const activeUnitCount = await p.projectUnit.count({
            where: { project_id: projectId, sales_status: { in: ['AVAILABLE', 'HOLD', 'RESERVED', 'BOOKED', 'SOLD'] } },
        });
        if (activePropertyCount > 0 || activeUnitCount > 0) {
            throw {
                status: 409,
                message: `Cannot cancel project: ${activePropertyCount + activeUnitCount} unit(s) underneath are still active inventory. Resolve or reassign them first.`,
            };
        }
        return await p.$transaction(async (tx) => {
            const updated = await tx.project.update({
                where: { id: projectId },
                data: { status: transition.nextState },
            });
            await tx.auditEvent.create({
                data: {
                    actor_id: user.employeeId,
                    action: 'STATUS_CHANGE',
                    entity_type: 'PROJECT',
                    entity_id: projectId,
                    old_value: project.status,
                    new_value: transition.nextState,
                    reason: 'Project cancelled via DELETE /projects/:id',
                },
            });
            return updated;
        });
    }
    /**
     * Phase 2.7: was previously unreachable — no route ever called it, and its
     * own `can(user, PROJECTS_UPDATE)` check (no resource passed) always
     * returned false for everyone except ADMIN (`authorization.ts`'s
     * PROJECTS_UPDATE case fails closed with no resource, unlike some other
     * permissions that "defer to service layer"). Fixed by fetching the project
     * first and passing it to `can()`, and by scoping via `buildProjectScope`
     * (not a flat `company_id: user.companyId` match) so cross-company access
     * granted via Phase 1.2's `EmployeeCompanyAccess` works here too — the same
     * class of bug found and fixed in `bulkCreateUnitsForProject` (2.20).
     */
    static async reassignProject(user, projectId, newPmId, reason) {
        if (!reason || reason.trim() === '') {
            throw { status: 400, message: 'Reassignment reason is mandatory' };
        }
        const scope = await (0, dataScope_1.buildProjectScope)(user);
        const project = await p.project.findFirst({ where: { id: projectId, ...scope } });
        if (!project)
            throw { status: 404, message: 'Project not found or unauthorized' };
        if (!(0, authorization_1.can)(user, shared_1.Permissions.PROJECTS_UPDATE, project)) {
            throw { status: 403, message: 'Forbidden: Missing permission to reassign this project' };
        }
        if (newPmId === project.assigned_pm_id) {
            throw { status: 400, message: 'Project is already assigned to this PM' };
        }
        // The new PM must belong to the PROJECT's own company, not necessarily the
        // acting user's — same reasoning as the 2.20 company-inheritance fix.
        const newPm = await p.employee.findFirst({
            where: { id: newPmId, company_id: project.company_id, status: 'ACTIVE' }
        });
        if (!newPm)
            throw { status: 400, message: 'New assignee not found or unauthorized' };
        const oldPmId = project.assigned_pm_id;
        return await p.$transaction(async (tx) => {
            const updated = await tx.project.update({
                where: { id: projectId },
                data: { assigned_pm_id: newPmId }
            });
            await tx.auditEvent.create({
                data: {
                    actor_id: user.employeeId,
                    action: 'REASSIGNMENT',
                    entity_type: 'PROJECT',
                    entity_id: projectId,
                    old_value: oldPmId ? oldPmId.toString() : 'UNASSIGNED',
                    new_value: newPmId.toString(),
                    reason: reason
                }
            });
            // Notify the new PM that they've been assigned a project
            await tx.notification.create({
                data: {
                    employee_id: newPmId,
                    type: 'PROJECT_ASSIGNED',
                    title: `Project Assigned to You: ${updated.project_code}`,
                    message: `Project "${updated.name}" (${updated.project_code}) has been assigned to you${reason ? `. Reason: ${reason}` : ''}.`,
                },
            });
            // Web push to new PM (outside transaction)
            (0, notifyEmployee_1.notifyEmployee)(newPmId, {
                type: 'PROJECT_ASSIGNED',
                title: `Project Assigned to You: ${updated.project_code}`,
                message: `Project "${updated.name}" (${updated.project_code}) has been assigned to you${reason ? `. Reason: ${reason}` : ''}.`,
            }, { skipDbNotification: true }).catch(err => logger_1.logger.error('[WebPush] ReassignProject new PM:', err));
            // Notify the old PM (if exists) that the project was reassigned away
            if (oldPmId && oldPmId !== newPmId) {
                await tx.notification.create({
                    data: {
                        employee_id: oldPmId,
                        type: 'PROJECT_REASSIGNED',
                        title: `Project Reassigned: ${updated.project_code}`,
                        message: `Project "${updated.name}" (${updated.project_code}) has been reassigned from you to ${newPm.full_name || newPm.employee_code} by ${user.employeeId}.`,
                    },
                });
                // Web push to old PM (outside transaction)
                (0, notifyEmployee_1.notifyEmployee)(oldPmId, {
                    type: 'PROJECT_REASSIGNED',
                    title: `Project Reassigned: ${updated.project_code}`,
                    message: `Project "${updated.name}" (${updated.project_code}) has been reassigned from you.`,
                }, { skipDbNotification: true }).catch(err => logger_1.logger.error('[WebPush] Project reassign old PM:', err));
            }
            // Web push to new PM (outside transaction)
            (0, notifyEmployee_1.notifyEmployee)(newPmId, {
                type: 'PROJECT_ASSIGNED',
                title: `Project Assigned to You: ${updated.project_code}`,
                message: `Project "${updated.name}" (${updated.project_code}) has been assigned to you${reason ? `. Reason: ${reason}` : ''}.`,
            }, { skipDbNotification: true }).catch(err => logger_1.logger.error('[WebPush] Project reassign new PM:', err));
            return updated;
        });
    }
    // ─────────────────────────────────────────────────────────────
    // Phase 2.23: Layout images & unit-position regions
    // ─────────────────────────────────────────────────────────────
    static async assertProjectInScope(user, projectId) {
        const scope = await (0, dataScope_1.buildProjectScope)(user);
        const project = await p.project.findFirst({ where: { id: projectId, ...scope } });
        if (!project)
            throw { status: 404, message: 'Project not found' };
        return project;
    }
    static async uploadLayoutImage(user, projectId, file, title) {
        // can() needs the actual project row to evaluate PROJECTS_UPDATE (it's
        // resource-scoped — always false with no resource), so fetch-in-scope
        // must run before the permission check, not after.
        const project = await this.assertProjectInScope(user, projectId);
        if (!(0, authorization_1.can)(user, shared_1.Permissions.PROJECTS_UPDATE, project)) {
            throw { status: 403, message: 'Forbidden: Missing projects.update permission' };
        }
        const { processedBuffer, filename } = await (0, storage_service_1.processImageBuffer)(file.buffer);
        const imageUrl = await (0, storage_service_1.getStorageService)('projects-layout').upload(processedBuffer, filename, 'image/webp');
        return await p.$transaction(async (tx) => {
            const isFirstImage = (await tx.projectLayoutImage.count({ where: { project_id: projectId } })) === 0;
            return await tx.projectLayoutImage.create({
                data: {
                    project_id: projectId,
                    image_url: imageUrl,
                    title: title || null,
                    is_primary: isFirstImage, // first upload for a project becomes primary by default
                    uploaded_by_id: user.employeeId,
                },
            });
        });
    }
    static async listLayoutImages(user, projectId) {
        await this.assertProjectInScope(user, projectId);
        return await p.projectLayoutImage.findMany({
            where: { project_id: projectId },
            orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
            include: {
                regions: {
                    include: {
                        property: {
                            select: { id: true, property_code: true, title: true, status: true, final_price: true, category: true },
                        },
                    },
                },
            },
        });
    }
    static async deleteLayoutImage(user, projectId, imageId) {
        const project = await this.assertProjectInScope(user, projectId);
        if (!(0, authorization_1.can)(user, shared_1.Permissions.PROJECTS_UPDATE, project)) {
            throw { status: 403, message: 'Forbidden: Missing projects.update permission' };
        }
        const image = await p.projectLayoutImage.findFirst({ where: { id: imageId, project_id: projectId } });
        if (!image)
            throw { status: 404, message: 'Layout image not found' };
        await p.projectLayoutImage.delete({ where: { id: imageId } });
        try {
            await (0, storage_service_1.getStorageService)('projects-layout').delete(image.image_url);
        }
        catch (err) {
            // Non-fatal: the DB record (and its regions, via cascade) is already gone;
            // an orphaned file on disk is a hygiene issue, not a correctness one.
            logger_1.logger.warn(`Failed to delete layout image file for image ${imageId}`, err);
        }
        return { deleted: true };
    }
    static async upsertLayoutRegions(user, projectId, imageId, regions) {
        const project = await this.assertProjectInScope(user, projectId);
        if (!(0, authorization_1.can)(user, shared_1.Permissions.PROJECTS_UPDATE, project)) {
            throw { status: 403, message: 'Forbidden: Missing projects.update permission' };
        }
        const image = await p.projectLayoutImage.findFirst({ where: { id: imageId, project_id: projectId } });
        if (!image)
            throw { status: 404, message: 'Layout image not found' };
        const failed = [];
        let saved = 0;
        await p.$transaction(async (tx) => {
            for (let i = 0; i < regions.length; i++) {
                const region = regions[i];
                try {
                    if (!(region.x >= 0 && region.x <= 1) || !(region.y >= 0 && region.y <= 1)) {
                        throw new Error('x and y must be fractional coordinates between 0 and 1');
                    }
                    const unit = await tx.property.findFirst({ where: { id: region.property_id, project_id: projectId } });
                    if (!unit)
                        throw new Error(`Property ${region.property_id} is not a unit of this project`);
                    await tx.propertyLayoutRegion.upsert({
                        where: { layout_image_id_property_id: { layout_image_id: imageId, property_id: region.property_id } },
                        update: { x: region.x, y: region.y },
                        create: {
                            layout_image_id: imageId,
                            property_id: region.property_id,
                            x: region.x,
                            y: region.y,
                            created_by_id: user.employeeId,
                        },
                    });
                    saved++;
                }
                catch (err) {
                    failed.push({ index: i, error: err?.message || 'Unknown error saving this region' });
                }
            }
        });
        return { saved, total: regions.length, failed };
    }
    static async deleteLayoutRegion(user, regionId) {
        const region = await p.propertyLayoutRegion.findUnique({
            where: { id: regionId },
            include: { layout_image: { select: { project_id: true } } },
        });
        if (!region)
            throw { status: 404, message: 'Region not found' };
        const project = await this.assertProjectInScope(user, region.layout_image.project_id);
        if (!(0, authorization_1.can)(user, shared_1.Permissions.PROJECTS_UPDATE, project)) {
            throw { status: 403, message: 'Forbidden: Missing projects.update permission' };
        }
        await p.propertyLayoutRegion.delete({ where: { id: regionId } });
        return { deleted: true };
    }
    static async uploadMedia(user, projectId, file, kind, title) {
        const project = await this.assertProjectInScope(user, projectId);
        if (!(0, authorization_1.can)(user, shared_1.Permissions.PROJECTS_UPDATE, project)) {
            throw { status: 403, message: 'Forbidden: Missing projects.update permission' };
        }
        const { processedBuffer, filename } = await (0, storage_service_1.processImageBuffer)(file.buffer);
        const url = await (0, storage_service_1.getStorageService)('projects-media').upload(processedBuffer, filename, 'image/webp');
        const media = await p.projectMedia.create({
            data: { project_id: projectId, kind: kind, url, title: title || null, uploaded_by_id: user.employeeId },
        });
        if (kind === 'COVER') {
            await p.project.update({ where: { id: projectId }, data: { cover_image_url: url } });
        }
        return media;
    }
    static async listMedia(user, projectId) {
        await this.assertProjectInScope(user, projectId);
        return await p.projectMedia.findMany({
            where: { project_id: projectId },
            orderBy: [{ kind: 'asc' }, { sort_order: 'asc' }, { created_at: 'asc' }],
        });
    }
    static async deleteMedia(user, projectId, mediaId) {
        const project = await this.assertProjectInScope(user, projectId);
        if (!(0, authorization_1.can)(user, shared_1.Permissions.PROJECTS_UPDATE, project)) {
            throw { status: 403, message: 'Forbidden: Missing projects.update permission' };
        }
        const media = await p.projectMedia.findFirst({ where: { id: mediaId, project_id: projectId } });
        if (!media)
            throw { status: 404, message: 'Media not found' };
        await p.projectMedia.delete({ where: { id: mediaId } });
        if (project.cover_image_url === media.url) {
            await p.project.update({ where: { id: projectId }, data: { cover_image_url: null } });
        }
        try {
            await (0, storage_service_1.getStorageService)('projects-media').delete(media.url);
        }
        catch (err) {
            logger_1.logger.warn({ err, mediaId }, 'Failed to delete project media file from storage');
        }
        return { deleted: true };
    }
    static async uploadDocument(user, projectId, file, kind, title) {
        const project = await this.assertProjectInScope(user, projectId);
        if (!(0, authorization_1.can)(user, shared_1.Permissions.PROJECTS_UPDATE, project)) {
            throw { status: 403, message: 'Forbidden: Missing projects.update permission' };
        }
        const ext = (file.originalname.split('.').pop() || 'pdf').toLowerCase();
        const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const url = await (0, storage_service_1.getStorageService)('projects-documents').upload(file.buffer, filename, file.mimetype);
        return await p.projectDocument.create({
            data: { project_id: projectId, kind: kind, url, title: title || file.originalname, uploaded_by_id: user.employeeId },
        });
    }
    static async listDocuments(user, projectId) {
        await this.assertProjectInScope(user, projectId);
        return await p.projectDocument.findMany({
            where: { project_id: projectId },
            orderBy: [{ kind: 'asc' }, { created_at: 'asc' }],
        });
    }
    static async deleteDocument(user, projectId, documentId) {
        const project = await this.assertProjectInScope(user, projectId);
        if (!(0, authorization_1.can)(user, shared_1.Permissions.PROJECTS_UPDATE, project)) {
            throw { status: 403, message: 'Forbidden: Missing projects.update permission' };
        }
        const doc = await p.projectDocument.findFirst({ where: { id: documentId, project_id: projectId } });
        if (!doc)
            throw { status: 404, message: 'Document not found' };
        await p.projectDocument.delete({ where: { id: documentId } });
        try {
            await (0, storage_service_1.getStorageService)('projects-documents').delete(doc.url);
        }
        catch (err) {
            logger_1.logger.warn({ err, documentId }, 'Failed to delete project document file from storage');
        }
        return { deleted: true };
    }
    /** Mirrors ProjectUnitService.listActivity — surfaces AuditEvent rows already written by updateProject/deleteProject/reassignProject. */
    static async listActivity(user, projectId) {
        await this.assertProjectInScope(user, projectId);
        const events = await p.auditEvent.findMany({
            where: { entity_type: 'PROJECT', entity_id: projectId },
            orderBy: { created_at: 'desc' },
        });
        const actorIds = [...new Set(events.map((e) => e.actor_id))];
        const actors = await p.employee.findMany({ where: { id: { in: actorIds } }, select: { id: true, full_name: true } });
        const nameById = new Map(actors.map((a) => [a.id, a.full_name]));
        return events.map((e) => ({ ...e, actor_name: nameById.get(e.actor_id) || null }));
    }
}
exports.ProjectService = ProjectService;
