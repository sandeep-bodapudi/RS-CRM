"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initJobs = void 0;
const index_1 = require("./index");
const tasks = __importStar(require("./tasks"));
// 1. Lead follow-up reminders (Daily at 8:00 AM)
index_1.jobManager.register({
    name: 'Lead Follow-Up Reminders',
    schedule: '0 8 * * *',
    handler: tasks.leadFollowUpJob,
    envDisableKey: 'DISABLE_JOB_LEAD_FOLLOW_UP',
});
// 2. Stale lead flagging (Daily at 1:00 AM)
index_1.jobManager.register({
    name: 'Stale Lead Flagging',
    schedule: '0 1 * * *',
    handler: tasks.staleLeadFlaggingJob,
    envDisableKey: 'DISABLE_JOB_STALE_LEADS',
});
// 3. Daily attendance rollup (Midnight, IST): force-checkout anyone still
// checked in and escalate a summary notification to HR (falling back to MD
// if the company has no HR_MANAGER employee onboarded).
index_1.jobManager.register({
    name: 'Daily Attendance Rollup',
    schedule: '0 0 * * *',
    handler: tasks.dailyAttendanceRollupJob,
    envDisableKey: 'DISABLE_JOB_ATTENDANCE_ROLLUP',
});
// 4. Expired session cleanup (Daily at 3:00 AM)
index_1.jobManager.register({
    name: 'Expired Session Cleanup',
    schedule: '0 3 * * *',
    handler: tasks.expiredSessionCleanupJob,
    envDisableKey: 'DISABLE_JOB_SESSION_CLEANUP',
});
// 5. Commission calculation batch (Monthly on the 1st at 2:00 AM)
index_1.jobManager.register({
    name: 'Commission Calculation Batch',
    schedule: '0 2 1 * *',
    handler: tasks.commissionCalculationBatchJob,
    envDisableKey: 'DISABLE_JOB_COMMISSION',
});
// 6. Backup verification (Daily at 6:00 AM)
index_1.jobManager.register({
    name: 'Backup Verification',
    schedule: '0 6 * * *',
    handler: tasks.backupVerificationJob,
    envDisableKey: 'DISABLE_JOB_BACKUP_VERIFY',
});
// 7. Report generation (Weekly on Monday at 7:00 AM)
index_1.jobManager.register({
    name: 'Report Generation',
    schedule: '0 7 * * 1',
    handler: tasks.reportGenerationJob,
    envDisableKey: 'DISABLE_JOB_REPORT_GEN',
});
// 8. Site Visit Escalation (Every 15 minutes)
index_1.jobManager.register({
    name: 'Site Visit Escalation',
    schedule: '*/15 * * * *',
    handler: tasks.siteVisitEscalationJob,
    envDisableKey: 'DISABLE_JOB_SITE_VISIT_ESCALATION',
});
// 9. Stale Reschedule Notification (Hourly)
index_1.jobManager.register({
    name: 'Stale Reschedule Sweep',
    schedule: '0 * * * *',
    handler: tasks.staleRescheduleSweepJob,
    envDisableKey: 'DISABLE_JOB_STALE_RESCHEDULE',
});
// 10. Lead Recovery Job (Mechanism 1 Nightly Sweep) (Daily at 2:00 AM)
index_1.jobManager.register({
    name: 'Lead Recovery Sweep',
    schedule: '0 2 * * *',
    handler: tasks.leadRecoveryJob,
    envDisableKey: 'DISABLE_JOB_LEAD_RECOVERY',
});
// 11. Inventory lock/hold expiry sweep (Every 15 minutes) — reclaims expired
// booking locks proactively (matching Site Visit Escalation's cadence, since
// a stale lock produces the same "search and booking disagree" class of bug)
// and clears expired manual HOLDs back to AVAILABLE.
index_1.jobManager.register({
    name: 'Inventory Lock & Hold Expiry Sweep',
    schedule: '*/15 * * * *',
    handler: tasks.inventoryLockAndHoldExpirySweepJob,
    envDisableKey: 'DISABLE_JOB_INVENTORY_EXPIRY',
});
const initJobs = () => {
    index_1.jobManager.startAll();
};
exports.initJobs = initJobs;
