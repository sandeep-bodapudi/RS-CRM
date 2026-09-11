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
exports.inventoryLockAndHoldExpirySweepJob = exports.leadRecoveryJob = exports.staleRescheduleSweepJob = exports.siteVisitEscalationJob = exports.reportGenerationJob = exports.backupVerificationJob = exports.commissionCalculationBatchJob = exports.expiredSessionCleanupJob = exports.dailyAttendanceRollupJob = exports.staleLeadFlaggingJob = exports.leadFollowUpJob = void 0;
const logger_1 = require("../utils/logger");
const prisma_1 = require("../lib/prisma");
const notifyEmployee_1 = require("../utils/notifyEmployee");
const shared_1 = require("../shared");
const time_1 = require("../utils/time");
const child_process_1 = require("child_process");
const util_1 = require("util");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
// Mock state for idempotency testing
const jobState = {};
// Statuses where a lead is "done" one way or another — neither job below
// should nag about a lead that's already dropped, booked, or in the
// negotiation/booking tail end (spec: only active, still-being-worked leads
// count for follow-up/staleness).
const LEAD_INACTIVE_TERMINAL_STATUSES = ['DROPPED', 'BOOKED', 'NEGOTIATION', 'BOOKING_INITIATED'];
/**
 * "Last activity" for a lead: the most recent LeadActivity row, or the
 * lead's own created_at if it has never had one (a fresh, untouched lead).
 * Deliberately NOT Lead.last_contacted_at — that field only updates on a
 * status transition, so a telecaller adding notes/sending a WhatsApp
 * proposal/logging interest without also changing status would otherwise
 * look neglected when they're actually working the lead.
 */
async function leadsInactiveSince(cutoff) {
    const candidates = await prisma_1.prisma.lead.findMany({
        where: {
            status: { notIn: LEAD_INACTIVE_TERMINAL_STATUSES },
            assigned_to_id: { not: null },
        },
        select: {
            id: true,
            lead_code: true,
            customer_name: true,
            assigned_to_id: true,
            created_at: true,
            activities: { orderBy: { created_at: 'desc' }, take: 1, select: { created_at: true } },
        },
    });
    return candidates
        .filter((lead) => {
        const lastActivity = lead.activities[0]?.created_at ?? lead.created_at;
        return lastActivity < cutoff;
    })
        .map(({ id, lead_code, customer_name, assigned_to_id }) => ({
        id,
        lead_code,
        customer_name,
        assigned_to_id,
    }));
}
// 1. Lead follow-up reminders — an active lead with no logged activity in 2+
// days gets a reminder nudge sent to whoever it's assigned to. Runs daily by
// design: a lead that stays neglected gets nudged again the next day too
// (a reminder, not a one-time alert) rather than being suppressed after the
// first notification.
const leadFollowUpJob = async () => {
    logger_1.logger.info('Executing Lead Follow-Up Reminders...');
    const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const staleLeads = await leadsInactiveSince(cutoff);
    let notifiedCount = 0;
    for (const lead of staleLeads) {
        if (!lead.assigned_to_id)
            continue;
        await (0, notifyEmployee_1.notifyEmployee)(lead.assigned_to_id, {
            type: 'LEAD_FOLLOW_UP_REMINDER',
            title: 'Follow-up needed',
            message: `${lead.customer_name} (${lead.lead_code}) has had no activity in 2+ days — give them a call.`,
            link: `/leads/${lead.id}`,
        });
        notifiedCount++;
    }
    logger_1.logger.info(`Sent ${notifiedCount} lead follow-up reminder(s).`);
};
exports.leadFollowUpJob = leadFollowUpJob;
// 2. Stale lead flagging — an active lead with no logged activity in 5+ days
// gets escalated to the assigned employee's reporting manager (falling back
// to the company's MD if they have no manager set, same fallback pattern
// dailyAttendanceRollupJob uses for HR/MD) so it surfaces for review or pool
// recovery, not just re-nudged at the assignee. Idempotent per ~5-day
// stretch of continued neglect via an audit-event check (mirrors the
// UNINFORMED_ABSENT pattern below) — otherwise a manager would get the same
// escalation every single day a lead stays stale.
const staleLeadFlaggingJob = async () => {
    logger_1.logger.info('Executing Stale Lead Flagging...');
    const cutoff = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const staleLeads = await leadsInactiveSince(cutoff);
    let flaggedCount = 0;
    for (const lead of staleLeads) {
        if (!lead.assigned_to_id)
            continue;
        const alreadyFlagged = await prisma_1.prisma.auditEvent.findFirst({
            where: {
                entity_type: 'LEAD',
                entity_id: lead.id,
                action: 'LEAD_STALE_FLAGGED',
                created_at: { gte: cutoff },
            },
        });
        if (alreadyFlagged)
            continue;
        const assignee = await prisma_1.prisma.employee.findUnique({
            where: { id: lead.assigned_to_id },
            select: {
                id: true,
                full_name: true,
                employee_code: true,
                reporting_manager_id: true,
                company_id: true,
            },
        });
        if (!assignee)
            continue;
        let recipientId = assignee.reporting_manager_id;
        if (!recipientId) {
            const md = await prisma_1.prisma.employee.findFirst({
                where: {
                    company_id: assignee.company_id,
                    status: 'ACTIVE',
                    roles: { some: { role: { name: shared_1.Roles.MD } } },
                },
                select: { id: true },
            });
            recipientId = md?.id ?? null;
        }
        if (!recipientId) {
            logger_1.logger.warn(`[Jobs] Lead ${lead.lead_code}: no reporting manager or MD to escalate staleness to.`);
            continue;
        }
        await (0, notifyEmployee_1.notifyEmployee)(recipientId, {
            type: 'LEAD_STALE_FLAGGED',
            title: 'Lead going stale',
            message: `${lead.customer_name} (${lead.lead_code}), assigned to ${assignee.full_name || assignee.employee_code}, has had no activity in 5+ days.`,
            link: `/leads/${lead.id}`,
        });
        await prisma_1.prisma.auditEvent.create({
            data: {
                actor_id: lead.assigned_to_id,
                action: 'LEAD_STALE_FLAGGED',
                entity_type: 'LEAD',
                entity_id: lead.id,
                reason: `No activity for 5+ days; escalated to ${recipientId === assignee.reporting_manager_id ? 'reporting manager' : 'MD'}.`,
            },
        });
        flaggedCount++;
    }
    logger_1.logger.info(`Flagged ${flaggedCount} stale lead(s).`);
};
exports.staleLeadFlaggingJob = staleLeadFlaggingJob;
// 3. Daily attendance rollup: force-checkout anyone still checked in as of
// midnight IST, then notify HR (falling back to MD if the company has no
// HR_MANAGER employee onboarded) with a summary. No *_notified_at escalation
// state is needed here (unlike siteVisitEscalationJob, which polls
// repeatedly) -- this runs exactly once per calendar day and only ever
// touches that day's still-open logs, so it's inherently idempotent without
// extra state: a re-run finds nothing left to close.
// `referenceDate` defaults to "now" for real cron/production use; tests pass
// a fixed instant so the Sunday-skip / day-boundary logic below is
// deterministic regardless of which real-world day the test suite runs on.
const dailyAttendanceRollupJob = async (referenceDate = new Date()) => {
    logger_1.logger.info('Executing Daily Attendance Rollup...');
    // The job fires at IST midnight, so "today" per getISTComponents() at this
    // exact moment IS the boundary we want -- anyone still checked in from
    // before this instant gets force-closed. Using `lt` (not a same-day range)
    // is deliberately self-healing: if a prior run failed, older open logs
    // still get caught here rather than silently skipped forever.
    const todayIST = (0, time_1.getISTComponents)(referenceDate);
    const midnightInstant = (0, time_1.getISTMidnightInstant)(todayIST.dateString);
    // The calendar day that JUST ended -- this is what gets finalized as
    // present/absent below, now that it can no longer change.
    const yesterday = (0, time_1.getISTComponents)(new Date(midnightInstant.getTime() - 1));
    const findRecipients = async (companyId) => {
        const companyEmployees = await prisma_1.prisma.employee.findMany({
            where: { company_id: companyId, status: 'ACTIVE' },
            include: { roles: { include: { role: true } } },
        });
        const hrIds = companyEmployees
            .filter((e) => e.roles.some((r) => r.role.name === shared_1.Roles.HR_MANAGER))
            .map((e) => e.id);
        const mdIds = companyEmployees
            .filter((e) => e.roles.some((r) => r.role.name === shared_1.Roles.MD))
            .map((e) => e.id);
        return { recipients: hrIds.length > 0 ? hrIds : mdIds, companyEmployees };
    };
    // ---- Part 1: force-checkout anyone still checked in ----
    const openLogs = await prisma_1.prisma.attendanceLog.findMany({
        where: { check_out_at: null, check_in_at: { lt: midnightInstant } },
        include: {
            employee: { select: { id: true, company_id: true, full_name: true, employee_code: true } },
        },
    });
    if (openLogs.length === 0) {
        logger_1.logger.info('No open check-ins to close.');
    }
    else {
        const byCompany = new Map();
        for (const log of openLogs) {
            const companyId = log.employee.company_id;
            if (!byCompany.has(companyId))
                byCompany.set(companyId, []);
            byCompany.get(companyId).push(log);
        }
        for (const [companyId, logs] of byCompany.entries()) {
            for (const log of logs) {
                const durationMinutes = Math.round((midnightInstant.getTime() - log.check_in_at.getTime()) / 60000);
                await prisma_1.prisma.$transaction([
                    prisma_1.prisma.attendanceLog.update({
                        where: { id: log.id },
                        data: {
                            check_out_at: midnightInstant,
                            working_duration_minutes: Math.max(0, durationMinutes),
                        },
                    }),
                    prisma_1.prisma.auditEvent.create({
                        data: {
                            actor_id: log.employee_id,
                            action: 'ATTENDANCE_AUTO_CHECKOUT_MIDNIGHT',
                            entity_type: 'ATTENDANCE_LOG',
                            entity_id: log.id,
                            new_value: JSON.stringify({ check_out_at: midnightInstant }),
                            reason: 'Employee did not check out; auto-closed at midnight.',
                        },
                    }),
                ]);
            }
            const { recipients } = await findRecipients(companyId);
            if (recipients.length > 0) {
                const names = logs.map((l) => l.employee.full_name || l.employee.employee_code).join(', ');
                await (0, notifyEmployee_1.notifyEmployee)(recipients, {
                    type: 'SYSTEM',
                    title: `🕛 ${logs.length} employee${logs.length === 1 ? '' : 's'} auto-checked-out at midnight`,
                    message: `${names} did not check out and ${logs.length === 1 ? 'was' : 'were'} automatically logged out at midnight.`,
                    link: '/hr-attendance',
                });
            }
            else {
                logger_1.logger.warn(`[Jobs] Company ${companyId}: no HR_MANAGER or MD employee onboarded -- ${logs.length} midnight auto-checkout(s) went unnotified.`);
            }
        }
        logger_1.logger.info(`Auto-checked-out ${openLogs.length} open attendance log(s).`);
    }
    // ---- Part 2: record uninformed absences for the day that just ended ----
    // Feeds performance-metric.ts's uninformedAbsentEvents input (Permissions
    // unaffected -- this is an internal audit event, not user-facing). Found
    // while verifying the performance formula: UNINFORMED_ABSENT was read in
    // 4 places (routes/performance.ts x3, analytics.service.ts x1) but never
    // written anywhere, so this penalty could never actually fire for anyone.
    if ((0, time_1.getISTDayOfWeek)(yesterday.dateString) !== 0) {
        const yesterdayStart = (0, time_1.getISTMidnightInstant)(yesterday.dateString);
        const companiesWithStaff = await prisma_1.prisma.employee.groupBy({
            by: ['company_id'],
            where: { status: 'ACTIVE', attendance_required: true },
        });
        for (const { company_id: companyId } of companiesWithStaff) {
            const holiday = await prisma_1.prisma.companyHoliday.findFirst({
                where: { company_id: companyId, date: (0, time_1.toHolidayDateKey)(yesterday.dateString) },
            });
            if (holiday)
                continue; // no attendance expected company-wide on a holiday
            const staff = await prisma_1.prisma.employee.findMany({
                where: { company_id: companyId, status: 'ACTIVE', attendance_required: true },
                select: { id: true, full_name: true, employee_code: true },
            });
            const [loggedIds, approvedLeaveIds] = await Promise.all([
                prisma_1.prisma.attendanceLog.findMany({
                    where: {
                        employee_id: { in: staff.map((s) => s.id) },
                        check_in_at: { gte: yesterdayStart, lt: midnightInstant },
                    },
                    select: { employee_id: true },
                }),
                prisma_1.prisma.attendanceProposal.findMany({
                    where: {
                        employee_id: { in: staff.map((s) => s.id) },
                        type: 'LEAVE',
                        status: 'APPROVED',
                        target_date: { gte: yesterdayStart, lt: midnightInstant },
                    },
                    select: { employee_id: true },
                }),
            ]);
            const excusedIds = new Set([
                ...loggedIds.map((l) => l.employee_id),
                ...approvedLeaveIds.map((p) => p.employee_id),
            ]);
            let absentees = staff.filter((s) => !excusedIds.has(s.id));
            if (absentees.length === 0)
                continue;
            // Idempotency: a re-run (manual trigger, crash recovery) must not
            // double-write this event for the same employee+date -- that would
            // double the -2.0 penalty in the performance formula.
            const alreadyRecorded = await prisma_1.prisma.auditEvent.findMany({
                where: {
                    actor_id: { in: absentees.map((a) => a.id) },
                    action: 'UNINFORMED_ABSENT',
                    new_value: { contains: yesterday.dateString },
                },
                select: { actor_id: true },
            });
            const alreadyRecordedIds = new Set(alreadyRecorded.map((a) => a.actor_id));
            absentees = absentees.filter((a) => !alreadyRecordedIds.has(a.id));
            if (absentees.length === 0)
                continue;
            for (const absentee of absentees) {
                await prisma_1.prisma.auditEvent.create({
                    data: {
                        actor_id: absentee.id,
                        action: 'UNINFORMED_ABSENT',
                        entity_type: 'EMPLOYEE',
                        entity_id: absentee.id,
                        new_value: JSON.stringify({ date: yesterday.dateString }),
                        reason: 'No attendance log and no approved leave for this date.',
                    },
                });
            }
            const { recipients } = await findRecipients(companyId);
            if (recipients.length > 0) {
                const names = absentees.map((a) => a.full_name || a.employee_code).join(', ');
                await (0, notifyEmployee_1.notifyEmployee)(recipients, {
                    type: 'SYSTEM',
                    title: `⚠️ ${absentees.length} uninformed absence${absentees.length === 1 ? '' : 's'} on ${yesterday.dateString}`,
                    message: `${names} had no attendance log and no approved leave for ${yesterday.dateString}.`,
                    link: '/hr-attendance',
                });
            }
        }
    }
};
exports.dailyAttendanceRollupJob = dailyAttendanceRollupJob;
// 4. Expired session cleanup
const expiredSessionCleanupJob = async () => {
    logger_1.logger.info('Executing Expired Session Cleanup...');
    // Was a stub (hardcoded "Cleaned up 2 expired sessions." log, no query).
    // Deletes AuthSession rows (refresh-token records, apps/api/src/routes/
    // auth.ts) whose expires_at has passed — these no longer authenticate
    // anything (the /auth/refresh route already rejects an expired token), so
    // this is pure housekeeping. Naturally idempotent: DELETE WHERE expires_at
    // < now() matches nothing on a re-run once already cleaned.
    const result = await prisma_1.prisma.authSession.deleteMany({
        where: { expires_at: { lt: new Date() } },
    });
    logger_1.logger.info(`Cleaned up ${result.count} expired session(s).`);
};
exports.expiredSessionCleanupJob = expiredSessionCleanupJob;
// 5. Commission calculation batch
//
// § Phase 5: STILL A STUB, DELIBERATELY. There is no commission-rate field
// anywhere in the schema, and — per the person requesting this work — it's
// not yet confirmed whether commission is even paid today (possibly
// tracked off-CRM in a spreadsheet, possibly not paid at all), and if so
// under what structure (flat %, tiered, role-based). Inventing a formula
// here would mean guessing at numbers that could end up on someone's
// paycheck. Do not implement real logic in this function until the actual
// business rule is confirmed — this stub is intentional, not forgotten.
const commissionCalculationBatchJob = async () => {
    logger_1.logger.info('Executing Commission Calculation Batch...');
    if (jobState['commissionCalc']) {
        logger_1.logger.info('Idempotency check: Commissions already calculated for this period. Skipping.');
        return;
    }
    logger_1.logger.info('Commission calculation skipped: no confirmed commission structure yet (stub, see comment above).');
    jobState['commissionCalc'] = true;
};
exports.commissionCalculationBatchJob = commissionCalculationBatchJob;
// 6. Backup verification
//
// § Phase 5: Hostinger's API only exposes backup endpoints for VPS hosting
// (VPS_getBackupsV1) — a MySQL database on shared/Business hosting (what
// this company is on) has no programmatic way to check "did today's backup
// actually succeed"; it's only inspectable via the hPanel UI. So this job
// doesn't (and can't) "verify Hostinger's backup" — instead it runs its own
// nightly mysqldump export that the app fully controls and can genuinely
// verify, layered on top of (not replacing) whatever Hostinger already does.
//
// IMPORTANT — this depends on the `mysqldump` binary being present in
// whatever environment this job actually runs in. It is NOT guaranteed to
// exist on every hosting platform (some Node-only runtimes have no shell
// access to database client tools at all). If it's missing, this job fails
// loudly (notifies MD/Admin) rather than silently reporting a fake success —
// confirm mysqldump is available wherever apps/api is deployed before
// relying on this as your actual backup story.
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.cwd(), 'backups');
const BACKUP_RETENTION_DAYS = 7;
const MIN_VALID_BACKUP_BYTES = 1024; // a real dump of a live CRM DB is always far larger than this; anything smaller means the export failed partway
function parseDatabaseUrl(url) {
    const parsed = new URL(url);
    return {
        host: parsed.hostname,
        port: parsed.port || '3306',
        user: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
        database: parsed.pathname.replace(/^\//, ''),
    };
}
// A backup covers the whole shared database, not one company — so a failure
// notification goes to every company's MD, not an arbitrary "first" one.
async function notifyAllCompanyMDs(title, message) {
    const admins = await prisma_1.prisma.employee.findMany({
        where: { status: 'ACTIVE', roles: { some: { role: { name: shared_1.Roles.MD } } } },
        select: { id: true },
    });
    if (admins.length > 0) {
        await (0, notifyEmployee_1.notifyEmployee)(admins.map((a) => a.id), { type: 'BACKUP_VERIFICATION', title, message });
    }
}
const backupVerificationJob = async () => {
    logger_1.logger.info('Executing Backup Verification...');
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        logger_1.logger.error('[Jobs] Backup verification: DATABASE_URL is not set — cannot run mysqldump.');
        return;
    }
    const { host, port, user, password, database } = parseDatabaseUrl(databaseUrl);
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outFile = path.join(BACKUP_DIR, `${database}-${timestamp}.sql`);
    try {
        // Password via env var (MYSQL_PWD), not a CLI arg — a CLI arg would be
        // visible to anyone who can list processes on the host.
        await execFileAsync('mysqldump', [
            '--host',
            host,
            '--port',
            port,
            '--user',
            user,
            '--single-transaction',
            '--quick',
            database,
            '--result-file',
            outFile,
        ], { env: { ...process.env, MYSQL_PWD: password }, timeout: 5 * 60 * 1000 });
        const stats = fs.statSync(outFile);
        if (stats.size < MIN_VALID_BACKUP_BYTES) {
            throw new Error(`Backup file is only ${stats.size} bytes — export likely failed partway through.`);
        }
        logger_1.logger.info(`Backup verified successfully: ${outFile} (${(stats.size / 1024 / 1024).toFixed(2)} MB).`);
        // Retention: delete our own prior exports older than the window so this
        // doesn't grow disk usage forever. Only ever touches files this job
        // itself created (matched by the `${database}-` prefix), never anything
        // else that might live in BACKUP_DIR.
        const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        for (const file of fs.readdirSync(BACKUP_DIR)) {
            if (!file.startsWith(`${database}-`) || !file.endsWith('.sql'))
                continue;
            const filePath = path.join(BACKUP_DIR, file);
            if (fs.statSync(filePath).mtimeMs < cutoff)
                fs.unlinkSync(filePath);
        }
    }
    catch (err) {
        const isMissingBinary = err?.code === 'ENOENT';
        const reason = isMissingBinary
            ? 'mysqldump is not installed / not on PATH in this environment — this job cannot run here at all.'
            : err?.message || String(err);
        logger_1.logger.error(`[Jobs] Backup verification FAILED: ${reason}`);
        await notifyAllCompanyMDs('⚠️ Nightly backup verification failed', reason).catch(() => { });
    }
};
exports.backupVerificationJob = backupVerificationJob;
// 7. Report generation
//
// § Phase 5: STILL A STUB, DELIBERATELY. Which report(s) and what
// "generated" actually means (emailed digest? stored for in-app download?
// something else?) hasn't been decided yet. Building a report nobody asked
// for is worse than leaving this honestly unimplemented — do not add real
// logic here until the actual report(s) are specified.
const reportGenerationJob = async () => {
    logger_1.logger.info('Executing Report Generation...');
    if (jobState['reportGen']) {
        logger_1.logger.info('Idempotency check: Reports already generated and sent. Skipping.');
        return;
    }
    logger_1.logger.info('Report generation skipped: no report(s) specified yet (stub, see comment above).');
    jobState['reportGen'] = true;
};
exports.reportGenerationJob = reportGenerationJob;
// 8. Site Visit Escalation & Notification
const siteVisitEscalationJob = async () => {
    logger_1.logger.info('Executing Site Visit Escalation...');
    const now = new Date();
    // Find all pending site visits (REQUESTED, RESCHEDULE_REQUESTED, PENDING_PM_RECONFIRMATION)
    // that have not yet occurred
    const pendingVisits = await prisma_1.prisma.siteVisitBooking.findMany({
        where: {
            status: { in: ['REQUESTED', 'RESCHEDULE_REQUESTED', 'PENDING_PM_RECONFIRMATION'] },
            scheduled_date: { gt: now },
        },
        include: {
            escalation: true,
            lead: true,
            property: true,
            project: true,
            project_manager: true,
            telecaller: true,
        },
    });
    if (pendingVisits.length === 0) {
        logger_1.logger.info('No pending site visits require escalation check.');
        return;
    }
    // Pre-fetch MD and Marketing Directors per company
    const directorsByCompany = {};
    const getDirectors = async (companyId) => {
        if (!directorsByCompany[companyId]) {
            const emps = await prisma_1.prisma.employee.findMany({
                where: { company_id: companyId },
                include: { roles: { include: { role: true } } },
            });
            const md = [];
            const marketing = [];
            for (const emp of emps) {
                const roleNames = emp.roles.map((r) => r.role.name);
                if (roleNames.includes(shared_1.Roles.MD))
                    md.push(emp.id);
                if (roleNames.includes(shared_1.Roles.MARKETING_DIRECTOR))
                    marketing.push(emp.id);
            }
            directorsByCompany[companyId] = { md, marketing };
        }
        return directorsByCompany[companyId];
    };
    let escalatedCount = 0;
    for (const visit of pendingVisits) {
        const hoursUntilVisit = (visit.scheduled_date.getTime() - now.getTime()) / (1000 * 60 * 60);
        const hoursNotice = (visit.scheduled_date.getTime() - visit.created_at.getTime()) / (1000 * 60 * 60);
        const needsMD = hoursUntilVisit <= 10 || hoursNotice <= 10;
        const needsMarketing = hoursUntilVisit <= 12 || hoursNotice <= 12;
        const directors = await getDirectors(visit.telecaller.company_id);
        // Ensure escalation record exists
        if (!visit.escalation) {
            await prisma_1.prisma.siteVisitEscalation.create({
                data: { site_visit_booking_id: visit.id },
            });
            visit.escalation = {
                id: 0,
                site_visit_booking_id: visit.id,
                marketing_director_notified_at: null,
                managing_director_notified_at: null,
            };
        }
        const pmStatus = visit.project_manager
            ? `${visit.project_manager.full_name || visit.project_manager.employee_code} (Assigned)`
            : 'Unassigned';
        const locationInfo = visit.project
            ? visit.project.name
            : visit.property
                ? visit.property.title
                : 'Unknown Location';
        const notificationPayload = {
            type: 'SITE_VISIT_ESCALATED',
            title: `URGENT: Site Visit Escalation (${visit.booking_code})`,
            message: `Site Visit ${visit.booking_code} at ${locationInfo} on ${visit.scheduled_date.toLocaleString()} needs PM response. PM Status: ${pmStatus}. Customer: ${visit.lead.customer_name} (${visit.lead.phone}).`,
            link: `/site-visits/${visit.id}`,
        };
        if (needsMD && !visit.escalation.managing_director_notified_at) {
            // Atomic conditional update
            const updateRes = await prisma_1.prisma.siteVisitEscalation.updateMany({
                where: {
                    site_visit_booking_id: visit.id,
                    managing_director_notified_at: null,
                },
                data: { managing_director_notified_at: now },
            });
            if (updateRes.count > 0 && directors.md.length > 0) {
                await (0, notifyEmployee_1.notifyEmployee)(directors.md, notificationPayload);
                escalatedCount++;
            }
        }
        if (needsMarketing && !visit.escalation.marketing_director_notified_at) {
            // Atomic conditional update
            const updateRes = await prisma_1.prisma.siteVisitEscalation.updateMany({
                where: {
                    site_visit_booking_id: visit.id,
                    marketing_director_notified_at: null,
                },
                data: { marketing_director_notified_at: now },
            });
            if (updateRes.count > 0 && directors.marketing.length > 0) {
                await (0, notifyEmployee_1.notifyEmployee)(directors.marketing, notificationPayload);
                escalatedCount++;
            }
        }
    }
    logger_1.logger.info(`Escalated ${escalatedCount} director notifications for pending site visits.`);
};
exports.siteVisitEscalationJob = siteVisitEscalationJob;
// 9. Stale Reschedule Notification (2 Days)
const staleRescheduleSweepJob = async () => {
    logger_1.logger.info('Executing Stale Reschedule Sweep...');
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    // Find leads that have a CANCELLED site visit, haven't been contacted in 2 days, and aren't already closed
    const staleLeads = await prisma_1.prisma.lead.findMany({
        where: {
            status: { notIn: ['DROPPED', 'NEGOTIATION', 'BOOKING_INITIATED', 'BOOKED'] },
            last_contacted_at: { lt: twoDaysAgo },
            site_visits: {
                some: {
                    status: 'CANCELLED',
                    updated_at: { lt: twoDaysAgo },
                },
            },
        },
        select: { id: true, lead_code: true, customer_name: true, assigned_to_id: true },
    });
    let notifiedCount = 0;
    for (const lead of staleLeads) {
        if (lead.assigned_to_id) {
            await (0, notifyEmployee_1.notifyEmployee)([lead.assigned_to_id], {
                type: 'SYSTEM_ALERT',
                title: 'Lead Inactive After Cancellation',
                message: `Lead ${lead.lead_code} (${lead.customer_name}) has had no update for 2 days since their site visit was cancelled. Are you sure you want to drop the lead?`,
                link: `/leads/${lead.id}`,
            });
            notifiedCount++;
            // Touch last_contacted_at so we don't spam them every hour
            await prisma_1.prisma.lead.update({
                where: { id: lead.id },
                data: { last_contacted_at: new Date() },
            });
        }
    }
    logger_1.logger.info(`Notified telecallers about ${notifiedCount} stale rescheduled leads.`);
};
exports.staleRescheduleSweepJob = staleRescheduleSweepJob;
// 10. Lead Recovery Job (Mechanism 1 Nightly Sweep)
const leadRecoveryJob = async () => {
    logger_1.logger.info('Executing nightly Lead Recovery Sweep...');
    const { matchDroppedLeadsToProperty } = await Promise.resolve().then(() => __importStar(require('../utils/matchingEngine')));
    const { LeadService } = await Promise.resolve().then(() => __importStar(require('../services/lead.service')));
    // Fetch all LIVE properties
    const liveProperties = await prisma_1.prisma.property.findMany({
        where: { status: 'LIVE' },
        select: { id: true },
    });
    let recoveredCount = 0;
    for (const prop of liveProperties) {
        const matchedLeadIds = await matchDroppedLeadsToProperty(prop.id);
        for (const leadId of matchedLeadIds) {
            // Re-use the same recovery trigger logic with its atomic guards
            await LeadService.triggerLeadRecoveryForProperty(prop.id);
            recoveredCount++;
        }
    }
    logger_1.logger.info(`Lead Recovery Sweep finished. Recovered ${recoveredCount} leads.`);
};
exports.leadRecoveryJob = leadRecoveryJob;
// 11. Inventory lock/hold expiry sweep.
//
// Two independent problems this closes:
//
// 1. Stale LOCKED/RESERVED items: booking.service.ts's claimAndCreate() has
//    always treated an expired lock as reclaimable, but only lazily — the
//    *next* booking attempt on that exact item is what notices. Until then,
//    the item shows as unavailable everywhere else (search, the Units tab,
//    the layout map) while actually being free. This job does that reclaim
//    proactively on a schedule instead of waiting for someone to try again.
//    A PENDING booking still sitting on an expired lock is cancelled at the
//    same time — the customer never confirmed within the hold window, so the
//    booking is stale, not stalled.
//
// 2. HOLD expiry: a manual "hold this unit for a walk-in customer" (spec
//    section 24's HOLD status, `hold_until`/`held_for_lead_id`) has nothing
//    else that ever clears it. Past its expiry, the unit reverts to AVAILABLE.
const inventoryLockAndHoldExpirySweepJob = async () => {
    logger_1.logger.info('Executing Inventory Lock & Hold Expiry Sweep...');
    const now = new Date();
    const [expiredLockedProperties, expiredReservedUnits, expiredHeldProperties, expiredHeldUnits] = await Promise.all([
        prisma_1.prisma.property.findMany({
            where: { status: 'LOCKED', locked_until: { lt: now } },
            select: { id: true, locked_by_booking_id: true },
        }),
        prisma_1.prisma.projectUnit.findMany({
            where: { sales_status: 'RESERVED', locked_until: { lt: now } },
            select: { id: true, locked_by_booking_id: true },
        }),
        prisma_1.prisma.property.findMany({
            where: { sales_status: 'HOLD', hold_until: { lt: now } },
            select: { id: true },
        }),
        prisma_1.prisma.projectUnit.findMany({
            where: { sales_status: 'HOLD', hold_until: { lt: now } },
            select: { id: true },
        }),
    ]);
    let releasedLocks = 0;
    let cancelledBookings = 0;
    const cancelStaleBookingIfPending = async (tx, bookingId) => {
        if (!bookingId)
            return false;
        const booking = await tx.booking.findUnique({ where: { id: bookingId } });
        if (!booking || booking.status !== 'PENDING')
            return false;
        await tx.booking.update({
            where: { id: booking.id },
            data: {
                status: 'CANCELLED',
                notes: `${booking.notes ? booking.notes + ' | ' : ''}Auto-cancelled: hold expired without confirmation.`,
            },
        });
        return true;
    };
    for (const row of expiredLockedProperties) {
        await prisma_1.prisma.$transaction(async (tx) => {
            if (await cancelStaleBookingIfPending(tx, row.locked_by_booking_id))
                cancelledBookings++;
            await tx.property.update({
                where: { id: row.id },
                data: { status: 'LIVE', locked_until: null, locked_by_booking_id: null },
            });
        });
        releasedLocks++;
    }
    for (const row of expiredReservedUnits) {
        await prisma_1.prisma.$transaction(async (tx) => {
            if (await cancelStaleBookingIfPending(tx, row.locked_by_booking_id))
                cancelledBookings++;
            await tx.projectUnit.update({
                where: { id: row.id },
                data: { sales_status: 'AVAILABLE', locked_until: null, locked_by_booking_id: null },
            });
        });
        releasedLocks++;
    }
    if (expiredHeldProperties.length > 0) {
        await prisma_1.prisma.property.updateMany({
            where: { id: { in: expiredHeldProperties.map((r) => r.id) } },
            data: { sales_status: 'AVAILABLE', hold_until: null, held_for_lead_id: null },
        });
    }
    if (expiredHeldUnits.length > 0) {
        await prisma_1.prisma.projectUnit.updateMany({
            where: { id: { in: expiredHeldUnits.map((r) => r.id) } },
            data: { sales_status: 'AVAILABLE', hold_until: null, held_for_lead_id: null },
        });
    }
    const releasedHolds = expiredHeldProperties.length + expiredHeldUnits.length;
    logger_1.logger.info(`Inventory Lock & Hold Expiry Sweep finished. Released ${releasedLocks} expired lock(s) (${cancelledBookings} stale booking(s) cancelled), released ${releasedHolds} expired hold(s).`);
};
exports.inventoryLockAndHoldExpirySweepJob = inventoryLockAndHoldExpirySweepJob;
