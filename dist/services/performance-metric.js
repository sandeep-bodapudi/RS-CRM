"use strict";
/**
 * performance-metric.ts — Pure performance score calculation.
 *
 * Centralizes the base-50.0 event-aggregated performance score used by the
 * /performance routes. Follows the repository's pure-calculation pattern
 * (see task-sla.status.ts): no HTTP, no Express, no DB writes, deterministic,
 * and unit-testable.
 *
 * NOTES ON THE EXISTING FORMULAS:
 *  - /performance/my-score and /performance/team share the FULL formula
 *    (calculatePerformanceScore below).
 *  - § Phase 4: attendance scoring is no longer a flat presentCount * weight —
 *    see PerformanceScoreInputs.attendanceBoost and utils/time.ts's
 *    calculateAttendancePoints() for the time-of-day gradient this replaced.
 *  - The ranked leaderboard view is served by GET /performance/achievements
 *    (?employeeId=ALL), which ranks by deals closed / assisted conversions /
 *    site visits executed — a different, deal-outcome-based ranking, not a
 *    variant of this score formula. There is no separate
 *    calculateLeaderboardScore function; an earlier design called for one,
 *    but it was superseded by the achievements-based ranking.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculatePerformanceScore = exports.roundPerformanceScore = exports.PERFORMANCE_WEIGHTS = exports.PERFORMANCE_BASE_SCORE = void 0;
exports.PERFORMANCE_BASE_SCORE = 50.0;
exports.PERFORMANCE_WEIGHTS = {
    completedTaskBoost: 2.0,
    dailyReportBoost: 0.5,
    propertyBookingBoost: 10.0,
    targetExceededBoost: 0.5,
    latePenalty: 1.0,
    halfDayPenalty: 1.0,
    belowTargetPenalty: 1.0,
    overduePenalty: 1.0,
    uninformedAbsentPenalty: 2.0,
};
const ZERO_BREAKDOWN = {
    baseScore: exports.PERFORMANCE_BASE_SCORE,
    completedTasks: 0,
    taskBoost: 0,
    dailyReports: 0,
    reportBoost: 0,
    presentCount: 0,
    presentBoost: 0,
    propertyBookingContributions: 0,
    propertyBookingBoost: 0,
    lateCount: 0,
    latePenalty: 0,
    halfDayCount: 0,
    halfDayPenalty: 0,
    belowTargetEvents: 0,
    belowTargetPenalty: 0,
    targetExceededEvents: 0,
    targetExceededBoost: 0,
    overdueTasks: 0,
    overduePenalty: 0,
    uninformedAbsentEvents: 0,
    uninformedAbsentPenalty: 0,
};
/** Round a raw score to one decimal place and clamp to 0 (lower bound). */
function roundPerformanceScore(rawScore) {
    return Math.max(0, Math.round(rawScore * 10) / 10);
}
exports.roundPerformanceScore = roundPerformanceScore;
/**
 * Full performance score — shared by /performance/my-score and /performance/team.
 * Pure: does not mutate the input and performs no database access.
 */
function calculatePerformanceScore(inputs) {
    const breakdown = {
        ...ZERO_BREAKDOWN,
        completedTasks: inputs.completedTasks,
        taskBoost: inputs.completedTasks * exports.PERFORMANCE_WEIGHTS.completedTaskBoost,
        dailyReports: inputs.dailyReports,
        reportBoost: inputs.dailyReports * exports.PERFORMANCE_WEIGHTS.dailyReportBoost,
        presentCount: inputs.presentCount,
        presentBoost: inputs.attendanceBoost,
        propertyBookingContributions: inputs.propertyBookingContributions,
        propertyBookingBoost: inputs.propertyBookingContributions * exports.PERFORMANCE_WEIGHTS.propertyBookingBoost,
        lateCount: inputs.lateCount,
        latePenalty: inputs.lateCount * exports.PERFORMANCE_WEIGHTS.latePenalty,
        halfDayCount: inputs.halfDayCount,
        halfDayPenalty: inputs.halfDayCount * exports.PERFORMANCE_WEIGHTS.halfDayPenalty,
        belowTargetEvents: inputs.belowTargetEvents,
        belowTargetPenalty: inputs.belowTargetEvents * exports.PERFORMANCE_WEIGHTS.belowTargetPenalty,
        targetExceededEvents: inputs.targetExceededEvents,
        targetExceededBoost: inputs.targetExceededEvents * exports.PERFORMANCE_WEIGHTS.targetExceededBoost,
        overdueTasks: inputs.overdueTasks,
        overduePenalty: inputs.overdueTasks * exports.PERFORMANCE_WEIGHTS.overduePenalty,
        uninformedAbsentEvents: inputs.uninformedAbsentEvents,
        uninformedAbsentPenalty: inputs.uninformedAbsentEvents * exports.PERFORMANCE_WEIGHTS.uninformedAbsentPenalty,
    };
    const rawScore = exports.PERFORMANCE_BASE_SCORE
        + breakdown.taskBoost
        + breakdown.reportBoost
        + breakdown.presentBoost
        + breakdown.propertyBookingBoost
        + breakdown.targetExceededBoost
        - breakdown.latePenalty
        - breakdown.halfDayPenalty
        - breakdown.belowTargetPenalty
        - breakdown.overduePenalty
        - breakdown.uninformedAbsentPenalty;
    return {
        score: roundPerformanceScore(rawScore),
        breakdown,
    };
}
exports.calculatePerformanceScore = calculatePerformanceScore;
