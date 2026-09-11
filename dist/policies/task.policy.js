"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskPolicy = void 0;
const hierarchy_1 = require("../utils/hierarchy");
const shared_1 = require("../shared");
class TaskPolicy {
    static async canMutate(user, task) {
        // A user can always mutate their own task
        if (task.assignee_id === user.employeeId) {
            return true;
        }
        // A creator can mutate a task they created (unless it's strictly isolated)
        if (task.created_by === user.employeeId) {
            return true;
        }
        // Must be in the same company
        if (task.assignee?.company_id && task.assignee.company_id !== user.companyId) {
            if (!user.roles.includes(shared_1.Roles.ADMIN)) {
                return false;
            }
        }
        // Managers can mutate tasks of their subordinates
        const isManagement = user.roles.some((r) => [shared_1.Roles.MD, shared_1.Roles.ADMIN, shared_1.Roles.HR_MANAGER, shared_1.Roles.MARKETING_DIRECTOR].includes(r));
        if (isManagement) {
            if (user.roles.includes(shared_1.Roles.ADMIN) || user.roles.includes(shared_1.Roles.MD)) {
                return true; // Global managers within the company
            }
            // For middle management, check hierarchy
            const managerOf = await (0, hierarchy_1.isManagerOf)(user.employeeId, task.assignee_id);
            if (managerOf)
                return true;
        }
        return false;
    }
    static canMutateSync(user, task) {
        // Task has no company_id column of its own -- company lives on its assignee.
        // Checking task.company_id here always no-ops (always undefined), silently
        // skipping this cross-company guard entirely.
        const taskCompanyId = task.assignee?.company_id ?? task.company_id;
        if (taskCompanyId && taskCompanyId !== user.companyId) {
            if (!user.roles.includes(shared_1.Roles.ADMIN))
                return false;
        }
        if (task.assignee_id === user.employeeId)
            return true;
        if (task.created_by === user.employeeId)
            return true;
        if (task._isSubordinate)
            return true;
        if (user.roles.includes(shared_1.Roles.ADMIN) || user.roles.includes(shared_1.Roles.MD))
            return true;
        return false;
    }
}
exports.TaskPolicy = TaskPolicy;
