import { prisma } from '../../lib/prisma';
import { TokenPayload } from '../../utils/jwt';
import { buildPropertyScope } from '../../authz/dataScope';
import { can } from '../../authz/authorization';
import { Permissions } from '../../shared';
import { PropertyPricingRuleCreateInput, PropertyPricingRuleUpdateInput } from '../../shared/property';

const p = prisma;

/** CRUD for a standalone Property's own pricing rules (§ Phase 3) — mirrors
 * PricingRulesService for ProjectPricingRule. Gated on PROPERTIES_UPDATE:
 * rules are part of managing the property's listing, not a separate
 * permission surface. */
export class PropertyPricingRulesService {
  private static async assertPropertyInScope(user: TokenPayload, propertyId: number) {
    const scope = await buildPropertyScope(user);
    const property = await p.property.findFirst({ where: { id: propertyId, ...scope } });
    if (!property) throw { status: 404, message: 'Property not found' };
    return property;
  }

  static async listRules(user: TokenPayload, propertyId: number) {
    await this.assertPropertyInScope(user, propertyId);
    return p.propertyPricingRule.findMany({
      where: { property_id: propertyId },
      orderBy: [{ kind: 'asc' }, { sort_order: 'asc' }],
    });
  }

  static async createRule(user: TokenPayload, propertyId: number, data: PropertyPricingRuleCreateInput) {
    const property = await this.assertPropertyInScope(user, propertyId);
    if (!can(user, Permissions.PROPERTIES_UPDATE, property)) {
      throw { status: 403, message: 'Forbidden: Missing properties.update permission' };
    }
    return p.propertyPricingRule.create({
      data: { property_id: propertyId, ...data },
    });
  }

  static async updateRule(user: TokenPayload, propertyId: number, ruleId: number, data: PropertyPricingRuleUpdateInput) {
    const property = await this.assertPropertyInScope(user, propertyId);
    if (!can(user, Permissions.PROPERTIES_UPDATE, property)) {
      throw { status: 403, message: 'Forbidden: Missing properties.update permission' };
    }
    const rule = await p.propertyPricingRule.findFirst({ where: { id: ruleId, property_id: propertyId } });
    if (!rule) throw { status: 404, message: 'Pricing rule not found' };
    return p.propertyPricingRule.update({ where: { id: ruleId }, data });
  }

  static async deleteRule(user: TokenPayload, propertyId: number, ruleId: number) {
    const property = await this.assertPropertyInScope(user, propertyId);
    if (!can(user, Permissions.PROPERTIES_UPDATE, property)) {
      throw { status: 403, message: 'Forbidden: Missing properties.update permission' };
    }
    const rule = await p.propertyPricingRule.findFirst({ where: { id: ruleId, property_id: propertyId } });
    if (!rule) throw { status: 404, message: 'Pricing rule not found' };
    // Soft-deactivate rather than hard delete — PriceLine.property_rule_id
    // (onDelete: SetNull) keeps a past cost sheet legible even after the rule
    // that produced it is retired, same reasoning as ProjectPricingRule.
    await p.propertyPricingRule.update({ where: { id: ruleId }, data: { is_active: false } });
    return { deactivated: true };
  }
}
