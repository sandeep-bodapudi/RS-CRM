"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.can = void 0;
const shared_1 = require("../shared");
const property_policy_1 = require("../policies/property.policy");
const lead_policy_1 = require("../policies/lead.policy");
const siteVisit_policy_1 = require("../policies/siteVisit.policy");
const expenseRefund_policy_1 = require("../policies/expenseRefund.policy");
const task_policy_1 = require("../policies/task.policy");
const project_policy_1 = require("../policies/project.policy");
const kyc_policy_1 = require("../policies/kyc.policy");
/**
 * Centralized Authorization Engine
 *
 * @param user The authenticated user token payload
 * @param action The required action/permission
 * @param resource The specific resource being accessed (optional)
 * @returns boolean indicating if access is granted
 */
const can = (user, action, resource) => {
    // Admin (Technical) is deliberately NOT a blanket bypass — RolePermissionsMatrix
    // curates a specific list for Admin and explicitly withholds some permissions
    // (e.g. "Explicitly NO EMPLOYEES_VIEW_SENSITIVE for ADMIN", no LEADS_* at all).
    // Only Roles.MD is granted ALL_PERMISSIONS, via the matrix itself, not here.
    // 1. Basic Permission Check
    const hasBasePermission = (user.permissions || []).includes(action);
    if (!hasBasePermission) {
        return false;
    }
    // 2. Explicit Policy Evaluation (Fail Closed)
    switch (action) {
        // -- PROJECTS --
        case shared_1.Permissions.PROJECTS_READ:
            if (!resource)
                return true;
            return project_policy_1.ProjectPolicy.canRead(user, resource);
        case shared_1.Permissions.PROJECTS_UPDATE:
            if (!resource)
                return false;
            return project_policy_1.ProjectPolicy.canUpdate(user, resource);
        case shared_1.Permissions.PROJECTS_DELETE:
            if (!resource)
                return false;
            return project_policy_1.ProjectPolicy.canDelete(user, resource);
        // -- PROPERTIES --
        case shared_1.Permissions.PROPERTIES_UPDATE:
            if (!resource)
                return true; // Defer to service layer
            return property_policy_1.PropertyPolicy.canUpdate(user, resource);
        case shared_1.Permissions.PROPERTIES_DELETE:
            if (!resource)
                return true; // Defer to service layer
            return property_policy_1.PropertyPolicy.canDelete(user, resource);
        case shared_1.Permissions.PROPERTIES_VERIFY:
            if (!resource)
                return true; // Defer to service layer
            return property_policy_1.PropertyPolicy.canVerify(user, resource);
        case shared_1.Permissions.PROPERTIES_DM_POLISH:
            if (!resource)
                return true; // Defer to service layer
            return property_policy_1.PropertyPolicy.canDMPolish(user, resource);
        case shared_1.Permissions.PROPERTIES_MD_APPROVE:
            if (!resource)
                return true; // Defer to service layer
            return property_policy_1.PropertyPolicy.canMDApprove(user, resource);
        // -- LEADS --
        case shared_1.Permissions.LEADS_READ:
            if (!resource)
                return true; // Allowed globally if no resource
            return lead_policy_1.LeadPolicy.canView(user, resource);
        case shared_1.Permissions.LEADS_UPDATE:
            if (!resource)
                return true;
            return lead_policy_1.LeadPolicy.canMutate(user, resource);
        case shared_1.Permissions.LEADS_ASSIGN:
            if (!resource)
                return true;
            return lead_policy_1.LeadPolicy.canReassign(user, resource);
        // -- SITE VISITS --
        case shared_1.Permissions.SITE_VISITS_CREATE:
            if (!resource)
                return true;
            return lead_policy_1.LeadPolicy.canView(user, resource);
        case shared_1.Permissions.SITE_VISITS_VERIFY:
            if (!resource)
                return false;
            return siteVisit_policy_1.SiteVisitPolicy.canVerify(user, resource);
        case shared_1.Permissions.SITE_VISITS_COMPLETE:
            if (!resource)
                return false;
            return siteVisit_policy_1.SiteVisitPolicy.canComplete(user, resource);
        case shared_1.Permissions.SITE_VISITS_ASSIGN_AGENT:
            if (!resource)
                return false;
            return siteVisit_policy_1.SiteVisitPolicy.canAssignAgent(user, resource);
        // -- EMPLOYEES --
        case shared_1.Permissions.EMPLOYEES_READ:
        case shared_1.Permissions.EMPLOYEES_UPDATE:
        case shared_1.Permissions.EMPLOYEES_DELETE:
        case shared_1.Permissions.EMPLOYEES_RESET_PASSWORD:
            if (!resource)
                return true;
            if (user.roles.includes(shared_1.Roles.ADMIN))
                return true;
            if (resource.company_id && resource.company_id !== user.companyId)
                return false;
            return true;
        case shared_1.Permissions.EMPLOYEES_VIEW_SENSITIVE:
            if (!resource)
                return false;
            if (user.roles.includes(shared_1.Roles.ADMIN))
                return true;
            if (resource.company_id && resource.company_id !== user.companyId)
                return false;
            return true;
        // -- EXPENSE REFUNDS --
        case shared_1.Permissions.EXPENSES_REVIEW:
            if (!resource)
                return false;
            return expenseRefund_policy_1.ExpenseRefundPolicy.canAccountantReview(user, resource);
        case shared_1.Permissions.EXPENSES_MD_APPROVE:
            if (!resource)
                return false;
            return expenseRefund_policy_1.ExpenseRefundPolicy.canMdReview(user, resource);
        case shared_1.Permissions.EXPENSES_MARK_REFUNDED:
            if (!resource)
                return false;
            return expenseRefund_policy_1.ExpenseRefundPolicy.canMarkRefunded(user, resource);
        // -- TASKS --
        case shared_1.Permissions.TASKS_UPDATE:
            if (!resource)
                return false;
            return task_policy_1.TaskPolicy.canMutateSync(user, resource);
        // -- CUSTOMER KYC --
        case shared_1.Permissions.CUSTOMERS_KYC_WRITE:
            if (!resource)
                return false;
            return kyc_policy_1.KycPolicy.canWrite(user, resource);
        // 3. Default Case - FAIL CLOSED FOR RESOURCES
        default:
            // If the permission is purely global (no resource required), allow it based on base permissions.
            // If a specific permission requires a resource, it MUST be mapped above and explicitly return false if !resource.
            if (!resource)
                return true;
            return false;
    }
};
exports.can = can;
