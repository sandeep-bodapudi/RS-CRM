"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PropertyPolicy = void 0;
const shared_1 = require("../shared");
class PropertyPolicy {
    static isManagement(user) {
        return user.roles.some((r) => [
            shared_1.Roles.MD,
            shared_1.Roles.ADMIN,
            shared_1.Roles.HR_MANAGER,
            shared_1.Roles.MARKETING_DIRECTOR,
            shared_1.Roles.DIGITAL_LEAD_OPERATOR,
            shared_1.Roles.DIGITAL_MARKETING_HEAD,
        ].includes(r));
    }
    static canCreate(user) {
        return (user.permissions || []).includes(shared_1.Permissions.PROPERTIES_CREATE);
    }
    /**
     * Determines whether a user may update a specific Property.
     * Mirrors ProjectPolicy.canUpdate. Was previously routed through canVerify
     * in authorization.ts's switch statement — incorrect, since that requires
     * PROPERTIES_VERIFY specifically and assignment-as-PM, which would wrongly
     * block e.g. a DM Executive with PROPERTIES_UPDATE editing SEO fields.
     * (Latent until now: no caller passed a resource for this action.)
     */
    static canUpdate(user, property) {
        if (!(user.permissions || []).includes(shared_1.Permissions.PROPERTIES_UPDATE)) {
            return false;
        }
        // ADMIN bypasses company scoping entirely — matches buildPropertyScope's
        // own `user.roles.includes(Roles.ADMIN) ? {} : ...` and ProjectPolicy's
        // equivalent methods. Was previously an unconditional mismatch check that
        // would 403 an Admin acting on a property outside their own companyId.
        if (!user.roles.includes(shared_1.Roles.ADMIN) && property.company_id !== user.companyId) {
            return false;
        }
        if (user.roles.includes(shared_1.Roles.ADMIN) || this.isManagement(user)) {
            return true;
        }
        if (user.roles.includes(shared_1.Roles.PROJECT_MANAGER)) {
            return property.assigned_pm_id === user.employeeId;
        }
        return false;
    }
    /**
     * Determines whether a user may delete (archive) a specific Property.
     * Same rules as canUpdate.
     */
    static canDelete(user, property) {
        if (!(user.permissions || []).includes(shared_1.Permissions.PROPERTIES_DELETE)) {
            return false;
        }
        if (!user.roles.includes(shared_1.Roles.ADMIN) && property.company_id !== user.companyId) {
            return false;
        }
        if (user.roles.includes(shared_1.Roles.ADMIN) || this.isManagement(user)) {
            return true;
        }
        if (user.roles.includes(shared_1.Roles.PROJECT_MANAGER)) {
            return property.assigned_pm_id === user.employeeId;
        }
        return false;
    }
    static canVerify(user, property) {
        if (!(user.permissions || []).includes(shared_1.Permissions.PROPERTIES_VERIFY)) {
            return false;
        }
        // Same ADMIN-bypass fix as canUpdate/canDelete above — this had the same
        // latent bug (unconditional company mismatch check ahead of the Admin
        // check), just never exercised by a cross-company Admin verify before.
        if (!user.roles.includes(shared_1.Roles.ADMIN) && property.company_id !== user.companyId) {
            return false;
        }
        // MD/Admin can bypass assignment check
        if (user.roles.includes(shared_1.Roles.MD) || user.roles.includes(shared_1.Roles.ADMIN)) {
            return true;
        }
        // Must be explicitly assigned to this PM
        return property.assigned_pm_id === user.employeeId;
    }
    static canDMPolish(user, property) {
        if (!(user.permissions || []).includes(shared_1.Permissions.PROPERTIES_DM_POLISH)) {
            return false;
        }
        return user.roles.includes(shared_1.Roles.ADMIN) || property.company_id === user.companyId;
    }
    static canMDApprove(user, property) {
        if (!(user.permissions || []).includes(shared_1.Permissions.PROPERTIES_MD_APPROVE)) {
            return false;
        }
        return user.roles.includes(shared_1.Roles.ADMIN) || property.company_id === user.companyId;
    }
}
exports.PropertyPolicy = PropertyPolicy;
