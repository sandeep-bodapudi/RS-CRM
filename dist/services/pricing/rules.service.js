"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PricingRulesService = void 0;
const prisma_1 = require("../../lib/prisma");
const dataScope_1 = require("../../authz/dataScope");
const authorization_1 = require("../../authz/authorization");
const shared_1 = require("../../shared");
const p = prisma_1.prisma;
/** CRUD for a project's pricing rules — the facing/floor/corner tables and
 * mandatory charges an admin configures once per project (spec sections 16-19).
 * Gated on PROJECTS_UPDATE: rules are part of managing the project, the same
 * way layout images and PM assignment are, not a separate permission surface. */
class PricingRulesService {
    static async assertProjectInScope(user, projectId) {
        const scope = await (0, dataScope_1.buildProjectScope)(user);
        const project = await p.project.findFirst({ where: { id: projectId, ...scope } });
        if (!project)
            throw { status: 404, message: 'Project not found' };
        return project;
    }
    static async listRules(user, projectId) {
        await this.assertProjectInScope(user, projectId);
        return p.projectPricingRule.findMany({
            where: { project_id: projectId },
            orderBy: [{ kind: 'asc' }, { sort_order: 'asc' }],
        });
    }
    static async createRule(user, projectId, data) {
        const project = await this.assertProjectInScope(user, projectId);
        if (!(0, authorization_1.can)(user, shared_1.Permissions.PROJECTS_UPDATE, project)) {
            throw { status: 403, message: 'Forbidden: Missing projects.update permission' };
        }
        return p.projectPricingRule.create({
            data: { project_id: projectId, ...data },
        });
    }
    static async updateRule(user, projectId, ruleId, data) {
        const project = await this.assertProjectInScope(user, projectId);
        if (!(0, authorization_1.can)(user, shared_1.Permissions.PROJECTS_UPDATE, project)) {
            throw { status: 403, message: 'Forbidden: Missing projects.update permission' };
        }
        const rule = await p.projectPricingRule.findFirst({
            where: { id: ruleId, project_id: projectId },
        });
        if (!rule)
            throw { status: 404, message: 'Pricing rule not found' };
        return p.projectPricingRule.update({ where: { id: ruleId }, data });
    }
    static async deleteRule(user, projectId, ruleId) {
        const project = await this.assertProjectInScope(user, projectId);
        if (!(0, authorization_1.can)(user, shared_1.Permissions.PROJECTS_UPDATE, project)) {
            throw { status: 403, message: 'Forbidden: Missing projects.update permission' };
        }
        const rule = await p.projectPricingRule.findFirst({
            where: { id: ruleId, project_id: projectId },
        });
        if (!rule)
            throw { status: 404, message: 'Pricing rule not found' };
        // Soft-deactivate rather than hard delete: PriceLine rows reference rules by
        // id (rule_id, onDelete: SetNull) so a past cost sheet stays legible even
        // after the rule that produced it is retired — hard-deleting would either
        // orphan those lines silently (SetNull) or block the delete outright.
        await p.projectPricingRule.update({ where: { id: ruleId }, data: { is_active: false } });
        return { deactivated: true };
    }
}
exports.PricingRulesService = PricingRulesService;
