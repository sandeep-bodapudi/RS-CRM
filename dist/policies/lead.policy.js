"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LeadPolicy = void 0;
const shared_1 = require("../shared");
/**
 * Phase 3 - Lead Resource Scope Policy
 * Enforces ownership and cross-company boundaries before mutating data.
 */
class LeadPolicy {
    /**
     * Identifies if a user holds a management role with global lead access.
     */
    static isManagement(user) {
        return user.roles.some((r) => [
            shared_1.Roles.MD,
            shared_1.Roles.ADMIN,
            shared_1.Roles.HR_MANAGER,
            shared_1.Roles.MARKETING_DIRECTOR,
            shared_1.Roles.DIGITAL_LEAD_OPERATOR,
            shared_1.Roles.SALES_MANAGER,
        ].includes(r));
    }
    /**
     * Determines if the user is permitted to view the lead.
     * - Must belong to the same company.
     * - Management can view all leads in the company.
     * - Agents/Telecallers can only view leads assigned to them or created by them.
     */
    static canView(user, lead) {
        if (lead.company_id !== user.companyId) {
            return false; // Never allow cross-company access
        }
        if (this.isManagement(user)) {
            return true;
        }
        // Telecallers/Agents: Assigned access only
        return lead.assigned_to_id === user.employeeId || lead.created_by_id === user.employeeId;
    }
    /**
     * Determines if the user is permitted to mutate (update status/properties) the lead.
     * - Applies the same rules as canView.
     */
    static canMutate(user, lead) {
        // Management can mutate any lead in their company
        if (this.isManagement(user)) {
            return lead.company_id === user.companyId;
        }
        // Telecallers/Agents: can ONLY mutate leads currently assigned to their own
        // employeeId. A lead they personally created but that has since gone back
        // to the unassigned pool is still visible to them (canView, for their own
        // tracking) but is view-only until it's actually assigned to someone --
        // it isn't theirs to work just because they introduced it.
        if (lead.assigned_to_id === user.employeeId) {
            return lead.company_id === user.companyId;
        }
        return false;
    }
    /**
     * Determines if the user is permitted to manually reassign a lead to someone else.
     * - Must belong to the same company.
     * - Only Management roles are permitted.
     */
    static canReassign(user, lead) {
        if (lead.company_id !== user.companyId) {
            return false;
        }
        return this.isManagement(user);
    }
}
exports.LeadPolicy = LeadPolicy;
