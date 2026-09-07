import { TokenPayload } from '../utils/jwt';
import { Permission, Permissions, Roles } from '../shared';
import { PropertyPolicy } from '../policies/property.policy';
import { LeadPolicy } from '../policies/lead.policy';
import { SiteVisitPolicy } from '../policies/siteVisit.policy';
import { ExpenseRefundPolicy } from '../policies/expenseRefund.policy';
import { TaskPolicy } from '../policies/task.policy';
import { ProjectPolicy } from '../policies/project.policy';
import { KycPolicy } from '../policies/kyc.policy';

/**
 * Centralized Authorization Engine
 *
 * @param user The authenticated user token payload
 * @param action The required action/permission
 * @param resource The specific resource being accessed (optional)
 * @returns boolean indicating if access is granted
 */
export const can = (user: TokenPayload, action: Permission, resource?: any): boolean => {
  // Admin (Technical) is deliberately NOT a blanket bypass -- RolePermissionsMatrix
  // curates a specific list for Admin and explicitly withholds some permissions
  // (e.g. no EMPLOYEES_VIEW_SENSITIVE, no LEADS_* at all). Only Roles.MD is
  // granted ALL_PERMISSIONS, via the matrix itself, not here.

  // 1. Basic Permission Check
  const hasBasePermission = (user.permissions || []).includes(action);

  if (!hasBasePermission) {
    return false;
  }

  // 2. Explicit Policy Evaluation (Fail Closed)
  switch (action) {
    // -- PROJECTS --
    case Permissions.PROJECTS_READ:
      if (!resource) return true;
      return ProjectPolicy.canRead(user, resource);

    case Permissions.PROJECTS_UPDATE:
      if (!resource) return false;
      return ProjectPolicy.canUpdate(user, resource);

    case Permissions.PROJECTS_DELETE:
      if (!resource) return false;
      return ProjectPolicy.canDelete(user, resource);

    // -- PROPERTIES --
    case Permissions.PROPERTIES_UPDATE:
    case Permissions.PROPERTIES_DELETE:
    case Permissions.PROPERTIES_VERIFY:
      if (!resource) return true; // Defer to service layer
      return PropertyPolicy.canVerify(user, resource);

    case Permissions.PROPERTIES_DM_POLISH:
      if (!resource) return true; // Defer to service layer
      return PropertyPolicy.canDMPolish(user, resource);

    case Permissions.PROPERTIES_MD_APPROVE:
      if (!resource) return true; // Defer to service layer
      return PropertyPolicy.canMDApprove(user, resource);

    // -- LEADS --
    case Permissions.LEADS_READ:
      if (!resource) return true; // Allowed globally if no resource
      return LeadPolicy.canView(user, resource);

    case Permissions.LEADS_UPDATE:
      if (!resource) return true;
      return LeadPolicy.canMutate(user, resource);

    case Permissions.LEADS_ASSIGN:
      if (!resource) return true;
      return LeadPolicy.canReassign(user, resource);

    // -- SITE VISITS --
    case Permissions.SITE_VISITS_CREATE:
      if (!resource) return true;
      return LeadPolicy.canView(user, resource);

    case Permissions.SITE_VISITS_VERIFY:
      if (!resource) return false;
      return SiteVisitPolicy.canVerify(user, resource);

    case Permissions.SITE_VISITS_COMPLETE:
      if (!resource) return false;
      return SiteVisitPolicy.canComplete(user, resource);

    case Permissions.SITE_VISITS_ASSIGN_AGENT:
      if (!resource) return false;
      return SiteVisitPolicy.canAssignAgent(user, resource);

    // -- EMPLOYEES --
    case Permissions.EMPLOYEES_READ:
    case Permissions.EMPLOYEES_UPDATE:
    case Permissions.EMPLOYEES_DELETE:
    case Permissions.EMPLOYEES_RESET_PASSWORD:
      if (!resource) return true;
      if (user.roles.includes(Roles.ADMIN)) return true;
      if (resource.company_id && resource.company_id !== user.companyId) return false;
      return true;

    case Permissions.EMPLOYEES_VIEW_SENSITIVE:
      if (!resource) return false;
      if (user.roles.includes(Roles.ADMIN)) return true;
      if (resource.company_id && resource.company_id !== user.companyId) return false;
      return true;

    // -- EXPENSE REFUNDS --
    case Permissions.EXPENSES_REVIEW:
      if (!resource) return false;
      return ExpenseRefundPolicy.canAccountantReview(user, resource);

    case Permissions.EXPENSES_MD_APPROVE:
      if (!resource) return false;
      return ExpenseRefundPolicy.canMdReview(user, resource);

    case Permissions.EXPENSES_MARK_REFUNDED:
      if (!resource) return false;
      return ExpenseRefundPolicy.canMarkRefunded(user, resource);

    // -- TASKS --
    case Permissions.TASKS_UPDATE:
      if (!resource) return false;
      return TaskPolicy.canMutateSync(user, resource);

    // -- CUSTOMER KYC --
    case Permissions.CUSTOMERS_KYC_WRITE:
      if (!resource) return false;
      return KycPolicy.canWrite(user, resource);

    // 3. Default Case - FAIL CLOSED FOR RESOURCES
    default:
      // If the permission is purely global (no resource required), allow it based on base permissions.
      // If a specific permission requires a resource, it MUST be mapped above and explicitly return false if !resource.
      if (!resource) return true;
      return false;
  }
};
