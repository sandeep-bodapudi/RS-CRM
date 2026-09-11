import { TokenPayload } from '../utils/jwt';
import { Roles } from '../shared';
import { Lead } from '@prisma/client';

/**
 * Phase 3 - Lead Resource Scope Policy
 * Enforces ownership and cross-company boundaries before mutating data.
 */
export class LeadPolicy {
  /**
   * Identifies if a user holds a management role with global lead access.
   */
  private static isManagement(user: TokenPayload): boolean {
    return user.roles.some((r) =>
      [
        Roles.MD,
        Roles.ADMIN,
        Roles.HR_MANAGER,
        Roles.MARKETING_DIRECTOR,
        Roles.DIGITAL_LEAD_OPERATOR,
        Roles.SALES_MANAGER,
      ].includes(r as any),
    );
  }

  /**
   * Determines if the user is permitted to view the lead.
   * - Must belong to the same company.
   * - Management can view all leads in the company.
   * - Agents/Telecallers can only view leads assigned to them or created by them.
   */
  static canView(user: TokenPayload, lead: Lead): boolean {
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
  static canMutate(user: TokenPayload, lead: Lead): boolean {
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
  static canReassign(user: TokenPayload, lead: Lead): boolean {
    if (lead.company_id !== user.companyId) {
      return false;
    }

    return this.isManagement(user);
  }
}
