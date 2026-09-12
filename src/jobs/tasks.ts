import { logger } from '../utils/logger';
import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';
import { notifyEmployee } from '../utils/notifyEmployee';
import { Roles } from '../shared';
import {
  getISTComponents,
  getISTMidnightInstant,
  getISTDayOfWeek,
  toHolidayDateKey,
} from '../utils/time';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execFileAsync = promisify(execFile);
// Mock state for idempotency testing
const jobState: Record<string, boolean> = {};

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
async function leadsInactiveSince(
  cutoff: Date,
): Promise<
  { id: number; lead_code: string; customer_name: string; assigned_to_id: number | null }[]
> {
  const candidates = await prisma.lead.findMany({
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
export const leadFollowUpJob = async () => {
  logger.info('Executing Lead Follow-Up Reminders...');
  const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const staleLeads = await leadsInactiveSince(cutoff);

  let notifiedCount = 0;
  for (const lead of staleLeads) {
    if (!lead.assigned_to_id) continue;
    await notifyEmployee(lead.assigned_to_id, {
      type: 'LEAD_FOLLOW_UP_REMINDER',
      title: 'Follow-up needed',
      message: `${lead.customer_name} (${lead.lead_code}) has had no activity in 2+ days — give them a call.`,
      link: `/leads/${lead.id}`,
    });
    notifiedCount++;
  }
  logger.info(`Sent ${notifiedCount} lead follow-up reminder(s).`);
};

// 2. Stale lead flagging — an active lead with no logged activity in 5+ days
// gets escalated to the assigned employee's reporting manager (falling back
// to the company's MD if they have no manager set, same fallback pattern
// dailyAttendanceRollupJob uses for HR/MD) so it surfaces for review or pool
// recovery, not just re-nudged at the assignee. Idempotent per ~5-day
// stretch of continued neglect via an audit-event check (mirrors the
// UNINFORMED_ABSENT pattern below) — otherwise a manager would get the same
// escalation every single day a lead stays stale.
export const staleLeadFlaggingJob = async () => {
  logger.info('Executing Stale Lead Flagging...');
  const cutoff = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  const staleLeads = await leadsInactiveSince(cutoff);

  let flaggedCount = 0;
  for (const lead of staleLeads) {
    if (!lead.assigned_to_id) continue;

    const alreadyFlagged = await prisma.auditEvent.findFirst({
      where: {
        entity_type: 'LEAD',
        entity_id: lead.id,
        action: 'LEAD_STALE_FLAGGED',
        created_at: { gte: cutoff },
      },
    });
    if (alreadyFlagged) continue;

    const assignee = await prisma.employee.findUnique({
      where: { id: lead.assigned_to_id },
      select: {
        id: true,
        full_name: true,
        employee_code: true,
        reporting_manager_id: true,
        company_id: true,
      },
    });
    if (!assignee) continue;

    let recipientId = assignee.reporting_manager_id;
    if (!recipientId) {
      const md = await prisma.employee.findFirst({
        where: {
          company_id: assignee.company_id,
          status: 'ACTIVE',
          roles: { some: { role: { name: Roles.MD } } },
        },
        select: { id: true },
      });
      recipientId = md?.id ?? null;
    }
    if (!recipientId) {
      logger.warn(
        `[Jobs] Lead ${lead.lead_code}: no reporting manager or MD to escalate staleness to.`,
      );
      continue;
    }

    await notifyEmployee(recipientId, {
      type: 'LEAD_STALE_FLAGGED',
      title: 'Lead going stale',
      message: `${lead.customer_name} (${lead.lead_code}), assigned to ${assignee.full_name || assignee.employee_code}, has had no activity in 5+ days.`,
      link: `/leads/${lead.id}`,
    });
    await prisma.auditEvent.create({
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
  logger.info(`Flagged ${flaggedCount} stale lead(s).`);
};

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
export const dailyAttendanceRollupJob = async (referenceDate: Date = new Date()) => {
  logger.info('Executing Daily Attendance Rollup...');

  // The job fires at IST midnight, so "today" per getISTComponents() at this
  // exact moment IS the boundary we want -- anyone still checked in from
  // before this instant gets force-closed. Using `lt` (not a same-day range)
  // is deliberately self-healing: if a prior run failed, older open logs
  // still get caught here rather than silently skipped forever.
  const todayIST = getISTComponents(referenceDate);
  const midnightInstant = getISTMidnightInstant(todayIST.dateString);
  // The calendar day that JUST ended -- this is what gets finalized as
  // present/absent below, now that it can no longer change.
  const yesterday = getISTComponents(new Date(midnightInstant.getTime() - 1));

  const findRecipients = async (companyId: number) => {
    const companyEmployees = await prisma.employee.findMany({
      where: { company_id: companyId, status: 'ACTIVE' },
      include: { roles: { include: { role: true } } },
    });
    const hrIds = companyEmployees
      .filter((e) => e.roles.some((r) => r.role.name === Roles.HR_MANAGER))
      .map((e) => e.id);
    const mdIds = companyEmployees
      .filter((e) => e.roles.some((r) => r.role.name === Roles.MD))
      .map((e) => e.id);
    return { recipients: hrIds.length > 0 ? hrIds : mdIds, companyEmployees };
  };

  // ---- Part 1: force-checkout anyone still checked in ----
  const openLogs = await prisma.attendanceLog.findMany({
    where: { check_out_at: null, check_in_at: { lt: midnightInstant } },
    include: {
      employee: { select: { id: true, company_id: true, full_name: true, employee_code: true } },
    },
  });

  if (openLogs.length === 0) {
    logger.info('No open check-ins to close.');
  } else {
    const byCompany = new Map<number, typeof openLogs>();
    for (const log of openLogs) {
      const companyId = log.employee.company_id;
      if (!byCompany.has(companyId)) byCompany.set(companyId, []);
      byCompany.get(companyId)!.push(log);
    }

    for (const [companyId, logs] of byCompany.entries()) {
      for (const log of logs) {
        const durationMinutes = Math.round(
          (midnightInstant.getTime() - log.check_in_at.getTime()) / 60000,
        );
        await prisma.$transaction([
          prisma.attendanceLog.update({
            where: { id: log.id },
            data: {
              check_out_at: midnightInstant,
              working_duration_minutes: Math.max(0, durationMinutes),
            },
          }),
          prisma.auditEvent.create({
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
        await notifyEmployee(recipients, {
          type: 'SYSTEM',
          title: `🕛 ${logs.length} employee${logs.length === 1 ? '' : 's'} auto-checked-out at midnight`,
          message: `${names} did not check out and ${logs.length === 1 ? 'was' : 'were'} automatically logged out at midnight.`,
          link: '/hr-attendance',
        });
      } else {
        logger.warn(
          `[Jobs] Company ${companyId}: no HR_MANAGER or MD employee onboarded -- ${logs.length} midnight auto-checkout(s) went unnotified.`,
        );
      }
    }

    logger.info(`Auto-checked-out ${openLogs.length} open attendance log(s).`);
  }

  // ---- Part 2: record uninformed absences for the day that just ended ----
  // Feeds performance-metric.ts's uninformedAbsentEvents input (Permissions
  // unaffected -- this is an internal audit event, not user-facing). Found
  // while verifying the performance formula: UNINFORMED_ABSENT was read in
  // 4 places (routes/performance.ts x3, analytics.service.ts x1) but never
  // written anywhere, so this penalty could never actually fire for anyone.
  if (getISTDayOfWeek(yesterday.dateString) !== 0) {
    const yesterdayStart = getISTMidnightInstant(yesterday.dateString);
    const companiesWithStaff = await prisma.employee.groupBy({
      by: ['company_id'],
      where: { status: 'ACTIVE', attendance_required: true },
    });

    for (const { company_id: companyId } of companiesWithStaff) {
      const holiday = await prisma.companyHoliday.findFirst({
        where: { company_id: companyId, date: toHolidayDateKey(yesterday.dateString) },
      });
      if (holiday) continue; // no attendance expected company-wide on a holiday

      const staff = await prisma.employee.findMany({
        where: { company_id: companyId, status: 'ACTIVE', attendance_required: true },
        select: { id: true, full_name: true, employee_code: true, report_required: true },
      });

      const [loggedIds, approvedLeaveIds] = await Promise.all([
        prisma.attendanceLog.findMany({
          where: {
            employee_id: { in: staff.map((s) => s.id) },
            check_in_at: { gte: yesterdayStart, lt: midnightInstant },
          },
          select: { employee_id: true },
        }),
        prisma.attendanceProposal.findMany({
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

      // ---- Part 3: flag anyone who attended but never submitted a daily
      // report -- feeds performance.ts's missingDailyReportEvents input.
      // Deliberately covers everyone who logged in that day regardless of
      // employment_type (Part-Time included per the requester -- report_
      // required is the only opt-out, same flag HR already uses elsewhere).
      // Placed here, BEFORE Part 2's own `if (absentees.length === 0)
      // continue`, since that continue would otherwise skip this entirely
      // for any company where nobody happened to be an uninformed absentee
      // that day -- the common case, and exactly what silently swallowed
      // this block the first time it was placed after Part 2 instead.
      const attendedIds = staff
        .filter((s) => loggedIds.some((l) => l.employee_id === s.id) && s.report_required !== false)
        .map((s) => s.id);
      let submittedIds = new Set<number>();
      if (attendedIds.length > 0) {
        const submitted = await prisma.dailyReport.findMany({
          where: {
            employee_id: { in: attendedIds },
            submitted_at: { gte: yesterdayStart, lt: midnightInstant },
          },
          select: { employee_id: true },
        });
        submittedIds = new Set(submitted.map((r) => r.employee_id));
        let missingReport = staff.filter(
          (s) => attendedIds.includes(s.id) && !submittedIds.has(s.id),
        );

        if (missingReport.length > 0) {
          const alreadyFlagged = await prisma.auditEvent.findMany({
            where: {
              actor_id: { in: missingReport.map((m) => m.id) },
              action: 'MISSING_DAILY_REPORT',
              new_value: { contains: yesterday.dateString },
            },
            select: { actor_id: true },
          });
          const alreadyFlaggedIds = new Set(alreadyFlagged.map((a) => a.actor_id));
          missingReport = missingReport.filter((m) => !alreadyFlaggedIds.has(m.id));
        }

        if (missingReport.length > 0) {
          for (const emp of missingReport) {
            await prisma.auditEvent.create({
              data: {
                actor_id: emp.id,
                action: 'MISSING_DAILY_REPORT',
                entity_type: 'EMPLOYEE',
                entity_id: emp.id,
                new_value: JSON.stringify({ date: yesterday.dateString }),
                reason: 'Attended but did not submit a daily report for this date.',
              },
            });
          }
          const names = missingReport.map((m) => m.full_name || m.employee_code).join(', ');
          await notifyEmployee(
            missingReport.map((m) => m.id),
            {
              type: 'SYSTEM',
              title: '📋 Daily report missing',
              message: `You attended on ${yesterday.dateString} but didn't submit a daily report — this cost 1.0 performance point.`,
              link: '/daily-report',
            },
          );
          logger.info(`${names} missed submitting a daily report for ${yesterday.dateString}.`);
        }
      }

      // ---- Part 4: "cleared their desk" bonus -- submitted their report AND
      // has zero open (PENDING/IN_PROGRESS/OVERDUE) tasks left as of end of
      // day. Per the requester: "if they completed all works in their
      // account they need to get 1 pt." Operationalized as a precise,
      // checkable pair of conditions rather than something vaguer like "all
      // leads followed up," since tasks are the one work-queue every role
      // already has and can genuinely empty out.
      const reportSubmittedIds = staff
        .filter((s) => attendedIds.includes(s.id) && submittedIds.has(s.id))
        .map((s) => s.id);
      if (reportSubmittedIds.length > 0) {
        const withOpenTasks = await prisma.task.findMany({
          where: {
            assignee_id: { in: reportSubmittedIds },
            status: { in: ['PENDING', 'IN_PROGRESS', 'OVERDUE'] },
          },
          select: { assignee_id: true },
          distinct: ['assignee_id'],
        });
        const withOpenTaskIds = new Set(withOpenTasks.map((t) => t.assignee_id));
        let clearedDesk = staff.filter(
          (s) => reportSubmittedIds.includes(s.id) && !withOpenTaskIds.has(s.id),
        );

        if (clearedDesk.length > 0) {
          const alreadyAwarded = await prisma.auditEvent.findMany({
            where: {
              actor_id: { in: clearedDesk.map((c) => c.id) },
              action: 'COMPLETED_ALL_WORK',
              new_value: { contains: yesterday.dateString },
            },
            select: { actor_id: true },
          });
          const alreadyAwardedIds = new Set(alreadyAwarded.map((a) => a.actor_id));
          clearedDesk = clearedDesk.filter((c) => !alreadyAwardedIds.has(c.id));
        }

        if (clearedDesk.length > 0) {
          for (const emp of clearedDesk) {
            await prisma.auditEvent.create({
              data: {
                actor_id: emp.id,
                action: 'COMPLETED_ALL_WORK',
                entity_type: 'EMPLOYEE',
                entity_id: emp.id,
                new_value: JSON.stringify({ date: yesterday.dateString, points: 1.0 }),
                reason: 'Submitted daily report and cleared all open tasks for this date.',
              },
            });
          }
          const names = clearedDesk.map((c) => c.full_name || c.employee_code).join(', ');
          await notifyEmployee(
            clearedDesk.map((c) => c.id),
            {
              type: 'SYSTEM',
              title: '🎯 Cleared your desk!',
              message: `You submitted your daily report and had no open tasks left on ${yesterday.dateString} — +1.0 performance point.`,
              link: '/my-performance',
            },
          );
          logger.info(`${names} completed all their work on ${yesterday.dateString}.`);
        }
      }

      let absentees = staff.filter((s) => !excusedIds.has(s.id));
      if (absentees.length === 0) continue;

      // Idempotency: a re-run (manual trigger, crash recovery) must not
      // double-write this event for the same employee+date -- that would
      // double the -2.0 penalty in the performance formula.
      const alreadyRecorded = await prisma.auditEvent.findMany({
        where: {
          actor_id: { in: absentees.map((a) => a.id) },
          action: 'UNINFORMED_ABSENT',
          new_value: { contains: yesterday.dateString },
        },
        select: { actor_id: true },
      });
      const alreadyRecordedIds = new Set(alreadyRecorded.map((a) => a.actor_id));
      absentees = absentees.filter((a) => !alreadyRecordedIds.has(a.id));
      if (absentees.length === 0) continue;

      for (const absentee of absentees) {
        await prisma.auditEvent.create({
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
        await notifyEmployee(recipients, {
          type: 'SYSTEM',
          title: `⚠️ ${absentees.length} uninformed absence${absentees.length === 1 ? '' : 's'} on ${yesterday.dateString}`,
          message: `${names} had no attendance log and no approved leave for ${yesterday.dateString}.`,
          link: '/hr-attendance',
        });
      }
    }
  }
};

// 4. Expired session cleanup
export const expiredSessionCleanupJob = async () => {
  logger.info('Executing Expired Session Cleanup...');
  // Was a stub (hardcoded "Cleaned up 2 expired sessions." log, no query).
  // Deletes AuthSession rows (refresh-token records, apps/api/src/routes/
  // auth.ts) whose expires_at has passed — these no longer authenticate
  // anything (the /auth/refresh route already rejects an expired token), so
  // this is pure housekeeping. Naturally idempotent: DELETE WHERE expires_at
  // < now() matches nothing on a re-run once already cleaned.
  const result = await prisma.authSession.deleteMany({
    where: { expires_at: { lt: new Date() } },
  });
  logger.info(`Cleaned up ${result.count} expired session(s).`);
};

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
export const commissionCalculationBatchJob = async () => {
  logger.info('Executing Commission Calculation Batch...');
  if (jobState['commissionCalc']) {
    logger.info('Idempotency check: Commissions already calculated for this period. Skipping.');
    return;
  }
  logger.info(
    'Commission calculation skipped: no confirmed commission structure yet (stub, see comment above).',
  );
  jobState['commissionCalc'] = true;
};

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

function parseDatabaseUrl(url: string) {
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
async function notifyAllCompanyMDs(title: string, message: string) {
  const admins = await prisma.employee.findMany({
    where: { status: 'ACTIVE', roles: { some: { role: { name: Roles.MD } } } },
    select: { id: true },
  });
  if (admins.length > 0) {
    await notifyEmployee(
      admins.map((a) => a.id),
      { type: 'BACKUP_VERIFICATION', title, message },
    );
  }
}

export const backupVerificationJob = async () => {
  logger.info('Executing Backup Verification...');
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logger.error('[Jobs] Backup verification: DATABASE_URL is not set — cannot run mysqldump.');
    return;
  }

  const { host, port, user, password, database } = parseDatabaseUrl(databaseUrl);
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(BACKUP_DIR, `${database}-${timestamp}.sql`);

  try {
    // Password via env var (MYSQL_PWD), not a CLI arg — a CLI arg would be
    // visible to anyone who can list processes on the host.
    await execFileAsync(
      'mysqldump',
      [
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
      ],
      { env: { ...process.env, MYSQL_PWD: password }, timeout: 5 * 60 * 1000 },
    );

    const stats = fs.statSync(outFile);
    if (stats.size < MIN_VALID_BACKUP_BYTES) {
      throw new Error(
        `Backup file is only ${stats.size} bytes — export likely failed partway through.`,
      );
    }

    logger.info(
      `Backup verified successfully: ${outFile} (${(stats.size / 1024 / 1024).toFixed(2)} MB).`,
    );

    // Retention: delete our own prior exports older than the window so this
    // doesn't grow disk usage forever. Only ever touches files this job
    // itself created (matched by the `${database}-` prefix), never anything
    // else that might live in BACKUP_DIR.
    const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const file of fs.readdirSync(BACKUP_DIR)) {
      if (!file.startsWith(`${database}-`) || !file.endsWith('.sql')) continue;
      const filePath = path.join(BACKUP_DIR, file);
      if (fs.statSync(filePath).mtimeMs < cutoff) fs.unlinkSync(filePath);
    }
  } catch (err: any) {
    const isMissingBinary = err?.code === 'ENOENT';
    const reason = isMissingBinary
      ? 'mysqldump is not installed / not on PATH in this environment — this job cannot run here at all.'
      : err?.message || String(err);
    logger.error(`[Jobs] Backup verification FAILED: ${reason}`);
    await notifyAllCompanyMDs('⚠️ Nightly backup verification failed', reason).catch(() => {});
  }
};

// 7. Report generation
//
// § Phase 5: STILL A STUB, DELIBERATELY. Which report(s) and what
// "generated" actually means (emailed digest? stored for in-app download?
// something else?) hasn't been decided yet. Building a report nobody asked
// for is worse than leaving this honestly unimplemented — do not add real
// logic here until the actual report(s) are specified.
export const reportGenerationJob = async () => {
  logger.info('Executing Report Generation...');
  if (jobState['reportGen']) {
    logger.info('Idempotency check: Reports already generated and sent. Skipping.');
    return;
  }
  logger.info('Report generation skipped: no report(s) specified yet (stub, see comment above).');
  jobState['reportGen'] = true;
};

// 8. Site Visit Escalation & Notification
export const siteVisitEscalationJob = async () => {
  logger.info('Executing Site Visit Escalation...');
  const now = new Date();

  // Find all pending site visits (REQUESTED, RESCHEDULE_REQUESTED, PENDING_PM_RECONFIRMATION)
  // that have not yet occurred
  const pendingVisits = await prisma.siteVisitBooking.findMany({
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
    logger.info('No pending site visits require escalation check.');
    return;
  }

  // Pre-fetch MD and Marketing Directors per company
  const directorsByCompany: Record<number, { md: number[]; marketing: number[] }> = {};

  const getDirectors = async (companyId: number) => {
    if (!directorsByCompany[companyId]) {
      const emps = await prisma.employee.findMany({
        where: { company_id: companyId },
        include: { roles: { include: { role: true } } },
      });
      const md: number[] = [];
      const marketing: number[] = [];
      for (const emp of emps) {
        const roleNames = emp.roles.map((r) => r.role.name);
        if (roleNames.includes(Roles.MD)) md.push(emp.id);
        if (roleNames.includes(Roles.MARKETING_DIRECTOR)) marketing.push(emp.id);
      }
      directorsByCompany[companyId] = { md, marketing };
    }
    return directorsByCompany[companyId];
  };

  let escalatedCount = 0;

  for (const visit of pendingVisits) {
    const hoursUntilVisit = (visit.scheduled_date.getTime() - now.getTime()) / (1000 * 60 * 60);
    const hoursNotice =
      (visit.scheduled_date.getTime() - visit.created_at.getTime()) / (1000 * 60 * 60);

    const needsMD = hoursUntilVisit <= 10 || hoursNotice <= 10;
    const needsMarketing = hoursUntilVisit <= 12 || hoursNotice <= 12;

    const directors = await getDirectors(visit.telecaller.company_id);

    // Ensure escalation record exists
    if (!visit.escalation) {
      await prisma.siteVisitEscalation.create({
        data: { site_visit_booking_id: visit.id },
      });
      visit.escalation = {
        id: 0,
        site_visit_booking_id: visit.id,
        marketing_director_notified_at: null,
        managing_director_notified_at: null,
      } as any;
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

    if (needsMD && !visit.escalation!.managing_director_notified_at) {
      // Atomic conditional update
      const updateRes = await prisma.siteVisitEscalation.updateMany({
        where: {
          site_visit_booking_id: visit.id,
          managing_director_notified_at: null,
        },
        data: { managing_director_notified_at: now },
      });

      if (updateRes.count > 0 && directors.md.length > 0) {
        await notifyEmployee(directors.md, notificationPayload);
        escalatedCount++;
      }
    }

    if (needsMarketing && !visit.escalation!.marketing_director_notified_at) {
      // Atomic conditional update
      const updateRes = await prisma.siteVisitEscalation.updateMany({
        where: {
          site_visit_booking_id: visit.id,
          marketing_director_notified_at: null,
        },
        data: { marketing_director_notified_at: now },
      });

      if (updateRes.count > 0 && directors.marketing.length > 0) {
        await notifyEmployee(directors.marketing, notificationPayload);
        escalatedCount++;
      }
    }
  }

  logger.info(`Escalated ${escalatedCount} director notifications for pending site visits.`);
};

// 9. Stale Reschedule Notification (2 Days)
export const staleRescheduleSweepJob = async () => {
  logger.info('Executing Stale Reschedule Sweep...');
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

  // Find leads that have a CANCELLED site visit, haven't been contacted in 2 days, and aren't already closed
  const staleLeads = await prisma.lead.findMany({
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
      await notifyEmployee([lead.assigned_to_id], {
        type: 'SYSTEM_ALERT',
        title: 'Lead Inactive After Cancellation',
        message: `Lead ${lead.lead_code} (${lead.customer_name}) has had no update for 2 days since their site visit was cancelled. Are you sure you want to drop the lead?`,
        link: `/leads/${lead.id}`,
      });
      notifiedCount++;
      // Touch last_contacted_at so we don't spam them every hour
      await prisma.lead.update({
        where: { id: lead.id },
        data: { last_contacted_at: new Date() },
      });
    }
  }

  logger.info(`Notified telecallers about ${notifiedCount} stale rescheduled leads.`);
};

// 10. Lead Recovery Job (Mechanism 1 Nightly Sweep)
export const leadRecoveryJob = async () => {
  logger.info('Executing nightly Lead Recovery Sweep...');
  const { matchDroppedLeadsToProperty } = await import('../utils/matchingEngine');
  const { LeadService } = await import('../services/lead.service');

  // Fetch all LIVE properties
  const liveProperties = await prisma.property.findMany({
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

  logger.info(`Lead Recovery Sweep finished. Recovered ${recoveredCount} leads.`);
};

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
export const inventoryLockAndHoldExpirySweepJob = async () => {
  logger.info('Executing Inventory Lock & Hold Expiry Sweep...');
  const now = new Date();

  const [expiredLockedProperties, expiredReservedUnits, expiredHeldProperties, expiredHeldUnits] =
    await Promise.all([
      prisma.property.findMany({
        where: { status: 'LOCKED', locked_until: { lt: now } },
        select: { id: true, locked_by_booking_id: true },
      }),
      prisma.projectUnit.findMany({
        where: { sales_status: 'RESERVED', locked_until: { lt: now } },
        select: { id: true, locked_by_booking_id: true },
      }),
      prisma.property.findMany({
        where: { sales_status: 'HOLD', hold_until: { lt: now } },
        select: { id: true },
      }),
      prisma.projectUnit.findMany({
        where: { sales_status: 'HOLD', hold_until: { lt: now } },
        select: { id: true },
      }),
    ]);

  let releasedLocks = 0;
  let cancelledBookings = 0;

  const cancelStaleBookingIfPending = async (
    tx: Prisma.TransactionClient,
    bookingId: number | null,
  ) => {
    if (!bookingId) return false;
    const booking = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!booking || booking.status !== 'PENDING') return false;
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
    await prisma.$transaction(async (tx) => {
      if (await cancelStaleBookingIfPending(tx, row.locked_by_booking_id)) cancelledBookings++;
      await tx.property.update({
        where: { id: row.id },
        data: { status: 'LIVE', locked_until: null, locked_by_booking_id: null },
      });
    });
    releasedLocks++;
  }

  for (const row of expiredReservedUnits) {
    await prisma.$transaction(async (tx) => {
      if (await cancelStaleBookingIfPending(tx, row.locked_by_booking_id)) cancelledBookings++;
      await tx.projectUnit.update({
        where: { id: row.id },
        data: { sales_status: 'AVAILABLE', locked_until: null, locked_by_booking_id: null },
      });
    });
    releasedLocks++;
  }

  if (expiredHeldProperties.length > 0) {
    await prisma.property.updateMany({
      where: { id: { in: expiredHeldProperties.map((r) => r.id) } },
      data: { sales_status: 'AVAILABLE', hold_until: null, held_for_lead_id: null },
    });
  }
  if (expiredHeldUnits.length > 0) {
    await prisma.projectUnit.updateMany({
      where: { id: { in: expiredHeldUnits.map((r) => r.id) } },
      data: { sales_status: 'AVAILABLE', hold_until: null, held_for_lead_id: null },
    });
  }

  const releasedHolds = expiredHeldProperties.length + expiredHeldUnits.length;
  logger.info(
    `Inventory Lock & Hold Expiry Sweep finished. Released ${releasedLocks} expired lock(s) (${cancelledBookings} stale booking(s) cancelled), released ${releasedHolds} expired hold(s).`,
  );
};
