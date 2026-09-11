"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCustomerScope = exports.buildProjectScope = exports.buildPropertyScope = exports.buildEmployeeScope = exports.buildLeadScope = void 0;
const shared_1 = require("../shared");
const hierarchy_1 = require("../utils/hierarchy");
const prisma_1 = require("../lib/prisma");
const MANAGEMENT_ROLES = [
    shared_1.Roles.MD,
    shared_1.Roles.ADMIN,
    shared_1.Roles.HR_MANAGER,
    shared_1.Roles.MARKETING_DIRECTOR,
    shared_1.Roles.DIGITAL_LEAD_OPERATOR,
    shared_1.Roles.DIGITAL_MARKETING_HEAD,
    shared_1.Roles.SALES_MANAGER,
];
/**
 * Resolves which companies' data this employee may see, via the explicit
 * EmployeeCompanyAccess grant table (Phase 1.2). Radha Real Homes and
 * Sonthillu Constructions currently share one employee base, so employees
 * are granted access to both there; when the employee bases are split
 * apart later, removing a grant row is enough — no code change needed.
 *
 * Falls back to the employee's own `company_id` (their JWT "home" company)
 * if no explicit grant rows exist yet, so an ungranted employee is scoped
 * to at least one company rather than zero or all of them.
 */
async function getAccessibleCompanyIds(user) {
    const grants = await prisma_1.prisma.employeeCompanyAccess.findMany({
        where: { employee_id: user.employeeId },
        select: { company_id: true },
    });
    if (grants.length === 0) {
        return [user.companyId];
    }
    return grants.map((g) => g.company_id);
}
/**
 * Ensures company isolation for all scopes, except for System Admins.
 */
async function getBaseScope(user) {
    const companyIds = await getAccessibleCompanyIds(user);
    return { company_id: { in: companyIds } };
}
/**
 * Builds the read-visibility scope for Leads.
 */
async function buildLeadScope(user) {
    // 1. ADMIN
    if (user.roles.includes(shared_1.Roles.ADMIN)) {
        return {}; // Global access
    }
    const baseScope = await getBaseScope(user);
    // 3. MANAGEMENT
    const isManagement = user.roles.some((r) => MANAGEMENT_ROLES.includes(r));
    if (isManagement) {
        return baseScope; // All companies this employee has been granted access to
    }
    // 4. MANAGERS & TELECALLERS (TEAM / OWN scope)
    const downstreamIds = await (0, hierarchy_1.getDownstreamEmployeeIds)(user.companyId, user.employeeId);
    return {
        ...baseScope,
        OR: [{ assigned_to_id: { in: downstreamIds } }, { created_by_id: { in: downstreamIds } }],
    };
}
exports.buildLeadScope = buildLeadScope;
/**
 * Builds the read-visibility scope for Employees.
 */
async function buildEmployeeScope(user) {
    // 1. ADMIN
    if (user.roles.includes(shared_1.Roles.ADMIN)) {
        return {}; // Global access
    }
    const baseScope = await getBaseScope(user);
    // Hide system/invisible roles for everyone except Admin
    const invisibleFilter = {
        roles: { none: { role: { is_invisible: true } } },
    };
    // 3. MANAGEMENT
    const isManagement = user.roles.some((r) => [shared_1.Roles.MD, shared_1.Roles.HR_MANAGER].includes(r));
    if (isManagement) {
        return {
            ...baseScope,
            ...invisibleFilter,
        };
    }
    // 4. MANAGERS (TEAM scope) & STANDARD EMPLOYEES
    const downstreamIds = await (0, hierarchy_1.getDownstreamEmployeeIds)(user.companyId, user.employeeId);
    return {
        ...baseScope,
        ...invisibleFilter,
        id: { in: downstreamIds },
    };
}
exports.buildEmployeeScope = buildEmployeeScope;
/**
 * Builds the read-visibility scope for Properties.
 */
async function buildPropertyScope(user) {
    // Company-scoped like every other domain (Phase 1.2) — brought in line with
    // Lead/Employee/Project/Customer rather than being locked to the single
    // "home" company_id, since employees currently need both companies' data.
    const propertyBaseScope = user.roles.includes(shared_1.Roles.ADMIN) ? {} : await getBaseScope(user);
    // 1. ADMIN & MANAGEMENT
    const isManagement = user.roles.some((r) => MANAGEMENT_ROLES.includes(r));
    if (user.roles.includes(shared_1.Roles.ADMIN) || isManagement) {
        return propertyBaseScope;
    }
    // 2. PROJECT MANAGER
    if (user.roles.includes(shared_1.Roles.PROJECT_MANAGER)) {
        return {
            ...propertyBaseScope,
            OR: [{ assigned_pm_id: user.employeeId }, { status: 'LIVE' }],
        };
    }
    // 3. TELECALLER, AGENT
    // Default to LIVE properties only within their company.
    return {
        ...propertyBaseScope,
        status: 'LIVE',
    };
}
exports.buildPropertyScope = buildPropertyScope;
/**
 * Builds the read-visibility scope for Projects.
 *
 * Authorization per Phase 5 docs (03-project-level-authorization.md):
 *   ADMIN / MANAGEMENT:  all projects in company_id
 *   PROJECT_MANAGER:     ONLY explicitly assigned projects (assigned_pm_id = user.employeeId)
 *   TELECALLER / AGENT:  non-PLANNING, non-CANCELLED projects (for pitching)
 *   Others:              no access
 */
async function buildProjectScope(user) {
    // 1. ADMIN (global, no company restriction)
    if (user.roles.includes(shared_1.Roles.ADMIN)) {
        return {};
    }
    const baseScope = await getBaseScope(user);
    // 2. MD — sees all projects in their company (any verification_status)
    if (user.roles.includes(shared_1.Roles.MD)) {
        return baseScope;
    }
    // 3. MANAGEMENT — only see VERIFIED projects (no drafts for non-MD)
    const isManagement = user.roles.some((r) => MANAGEMENT_ROLES.includes(r));
    if (isManagement) {
        return { ...baseScope, verification_status: 'VERIFIED' };
    }
    // 4. PROJECT MANAGER - sees all their assigned projects (any verification_status) AND all other VERIFIED projects
    if (user.roles.includes(shared_1.Roles.PROJECT_MANAGER)) {
        return {
            ...baseScope,
            OR: [{ assigned_pm_id: user.employeeId }, { verification_status: 'VERIFIED' }],
        };
    }
    // 5. Everyone else — only see VERIFIED projects
    return {
        ...baseScope,
        verification_status: 'VERIFIED',
    };
}
exports.buildProjectScope = buildProjectScope;
/**
 * Builds the read-visibility scope for Customers.
 */
async function buildCustomerScope(user) {
    if (user.roles.includes(shared_1.Roles.ADMIN)) {
        return {};
    }
    const baseScope = await getBaseScope(user);
    const isManagement = user.roles.some((r) => MANAGEMENT_ROLES.includes(r));
    if (isManagement) {
        return baseScope;
    }
    const isProjectManager = user.roles.includes(shared_1.Roles.PROJECT_MANAGER);
    if (isProjectManager) {
        return baseScope;
    }
    // Telecallers and Agents only see their assigned customers.
    return {
        ...baseScope,
        assigned_to_id: user.employeeId,
    };
}
exports.buildCustomerScope = buildCustomerScope;
