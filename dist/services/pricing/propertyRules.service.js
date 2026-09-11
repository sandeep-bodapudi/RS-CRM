"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PropertyPricingRulesService = void 0;
const prisma_1 = require("../../lib/prisma");
const dataScope_1 = require("../../authz/dataScope");
const authorization_1 = require("../../authz/authorization");
const shared_1 = require("../../shared");
const p = prisma_1.prisma;
/** CRUD for a standalone Property's own pricing rules (§ Phase 3) — mirrors
 * PricingRulesService for ProjectPricingRule. Gated on PROPERTIES_UPDATE:
 * rules are part of managing the property's listing, not a separate
 * permission surface. */
class PropertyPricingRulesService {
    static async assertPropertyInScope(user, propertyId) {
        const scope = await (0, dataScope_1.buildPropertyScope)(user);
        const property = await p.property.findFirst({ where: { id: propertyId, ...scope } });
        if (!property)
            throw { status: 404, message: 'Property not found' };
        return property;
    }
    static async listRules(user, propertyId) {
        await this.assertPropertyInScope(user, propertyId);
        return p.propertyPricingRule.findMany({
            where: { property_id: propertyId },
            orderBy: [{ kind: 'asc' }, { sort_order: 'asc' }],
        });
    }
    static async createRule(user, propertyId, data) {
        const property = await this.assertPropertyInScope(user, propertyId);
        if (!(0, authorization_1.can)(user, shared_1.Permissions.PROPERTIES_UPDATE, property)) {
            throw { status: 403, message: 'Forbidden: Missing properties.update permission' };
        }
        return p.propertyPricingRule.create({
            data: { property_id: propertyId, ...data },
        });
    }
    static async updateRule(user, propertyId, ruleId, data) {
        const property = await this.assertPropertyInScope(user, propertyId);
        if (!(0, authorization_1.can)(user, shared_1.Permissions.PROPERTIES_UPDATE, property)) {
            throw { status: 403, message: 'Forbidden: Missing properties.update permission' };
        }
        const rule = await p.propertyPricingRule.findFirst({
            where: { id: ruleId, property_id: propertyId },
        });
        if (!rule)
            throw { status: 404, message: 'Pricing rule not found' };
        return p.propertyPricingRule.update({ where: { id: ruleId }, data });
    }
    static async deleteRule(user, propertyId, ruleId) {
        const property = await this.assertPropertyInScope(user, propertyId);
        if (!(0, authorization_1.can)(user, shared_1.Permissions.PROPERTIES_UPDATE, property)) {
            throw { status: 403, message: 'Forbidden: Missing properties.update permission' };
        }
        const rule = await p.propertyPricingRule.findFirst({
            where: { id: ruleId, property_id: propertyId },
        });
        if (!rule)
            throw { status: 404, message: 'Pricing rule not found' };
        // Soft-deactivate rather than hard delete — PriceLine.property_rule_id
        // (onDelete: SetNull) keeps a past cost sheet legible even after the rule
        // that produced it is retired, same reasoning as ProjectPricingRule.
        await p.propertyPricingRule.update({ where: { id: ruleId }, data: { is_active: false } });
        return { deactivated: true };
    }
}
exports.PropertyPricingRulesService = PropertyPricingRulesService;
