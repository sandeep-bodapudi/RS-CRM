"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectWorkflow = void 0;
class ProjectWorkflow {
    canTransition(req) {
        const { currentState, action } = req;
        const allowedMap = ProjectWorkflow.validTransitions[currentState];
        if (!allowedMap) {
            return {
                allowed: false,
                reason: `Unknown project state: ${currentState}`,
            };
        }
        const nextState = allowedMap[action];
        if (!nextState) {
            return {
                allowed: false,
                reason: `Invalid project transition: cannot move from ${currentState} to ${action}`,
            };
        }
        return { allowed: true, nextState };
    }
}
exports.ProjectWorkflow = ProjectWorkflow;
ProjectWorkflow.validTransitions = {
    PLANNING: {
        UNDER_CONSTRUCTION: 'UNDER_CONSTRUCTION',
        CANCELLED: 'CANCELLED',
    },
    UNDER_CONSTRUCTION: {
        COMPLETED: 'COMPLETED',
        CANCELLED: 'CANCELLED',
    },
    COMPLETED: {},
    CANCELLED: {},
};
