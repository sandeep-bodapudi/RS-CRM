import { AttendanceStatus, AttendanceStatusType } from '../shared';

export interface ISTTimeComponents {
  hours: number;
  minutes: number;
  timeString: string;
  dateString: string;
}

/**
 * Converts a JS Date to IST (Asia/Kolkata) time components.
 */
export const getISTComponents = (date: Date = new Date()): ISTTimeComponents => {
  const istFormatter = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = istFormatter.formatToParts(date);
  let hours = 0;
  let minutes = 0;
  let year = '';
  let month = '';
  let day = '';

  for (const part of parts) {
    if (part.type === 'hour') hours = parseInt(part.value, 10);
    if (part.type === 'minute') minutes = parseInt(part.value, 10);
    if (part.type === 'year') year = part.value;
    if (part.type === 'month') month = part.value;
    if (part.type === 'day') day = part.value;
  }

  const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  const dateString = `${year}-${month}-${day}`;

  return { hours, minutes, timeString, dateString };
};

/**
 * Timezone-independent day-of-week for an IST calendar date string
 * ("YYYY-MM-DD" from getISTComponents().dateString). 0 = Sunday ... 6 = Saturday.
 *
 * DO NOT compute this via `new Date(dateString + 'T00:00:00+05:30').getDay()` —
 * .getDay() reads the day-of-week using the server PROCESS's own local
 * timezone, not the +05:30 you just encoded into the string. On any server
 * not running in Asia/Kolkata (e.g. a UTC-hosted production box), IST
 * midnight is always 18:30 the *previous* UTC day, so .getDay() permanently
 * returns yesterday's weekday instead of today's — every Sunday is missed
 * and every Monday is wrongly flagged as Sunday. Date.UTC(...).getUTCDay()
 * is immune to this because UTC accessors never consult local timezone.
 */
export const getISTDayOfWeek = (dateString: string): number => {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

/**
 * Canonical UTC-midnight Date for a "YYYY-MM-DD" calendar date, matching how
 * CompanyHoliday.date is actually stored on creation (routes/attendance/
 * holidays-calendar.ts's POST /holidays: `new Date(`${date}T00:00:00Z`)`).
 * Building the lookup value with a +05:30 offset instead (as qr.ts used to)
 * produces a different instant than what's stored, so an exact `date: value`
 * match against a real holiday row silently never hits.
 */
export const toHolidayDateKey = (dateString: string): Date => new Date(`${dateString}T00:00:00Z`);

/**
 * IST-midnight instant for a "YYYY-MM-DD" calendar date, for use as a
 * Prisma `lt`/`gte` boundary (e.g. "any AttendanceLog still open as of
 * today's IST midnight"). Distinct from toHolidayDateKey, which is
 * UTC-midnight (matching how CompanyHoliday.date is stored) -- this one is
 * IST-midnight, matching real-world "the day rolled over" semantics. Safe
 * for the same reason as getISTMonthRange: used only as a boundary value,
 * never read back with a local (non-UTC) accessor.
 */
export const getISTMidnightInstant = (dateString: string): Date => new Date(`${dateString}T00:00:00+05:30`);

/**
 * IST-safe [startOfMonth, endOfMonth] instants for a given IST calendar year
 * and month (1-12), for use as Prisma `gte`/`lte` DateTime range bounds.
 *
 * DO NOT build these via `new Date(year, month - 1, 1)` — that constructor
 * interprets year/month/day in the server PROCESS's own local timezone, not
 * IST. On a UTC-hosted server this shifts both boundaries by 5.5 hours,
 * silently excluding/including events near every month's edges (found in
 * routes/performance.ts's my-score/team/leaderboard queries, 2026-09-07).
 * Built here via explicit +05:30 offsets used only as boundary instants —
 * never read back with a local (non-UTC) accessor — so this is safe
 * regardless of the server's own timezone.
 */
export const getISTMonthRange = (year: number, month: number): { startOfMonth: Date; endOfMonth: Date } => {
  const pad = (n: number) => String(n).padStart(2, '0');
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const startOfMonth = new Date(`${year}-${pad(month)}-01T00:00:00+05:30`);
  const nextMonthStart = new Date(`${nextYear}-${pad(nextMonth)}-01T00:00:00+05:30`);
  const endOfMonth = new Date(nextMonthStart.getTime() - 1);
  return { startOfMonth, endOfMonth };
};

/**
 * Calculates Attendance Status according to RRH Business Rules (IST):
 * 1. FULL_TIME: <= 10:30 AM IST -> PRESENT; 10:31-11:30 -> LATE or APPROVED_LATE;
 *    > 11:30 -> HALF_DAY or APPROVED_HALF_DAY.
 * 2. PART_TIME / CONTRACT / INTERN: no late/early/half-day penalties — status is
 *    always PRESENT and attendance is tracked via working_duration_minutes (check-in/out).
 */
export const calculateAttendanceStatus = (
  checkInDate: Date = new Date(),
  hasApprovedProposal: boolean = false,
  employmentType: string = 'FULL_TIME',
): AttendanceStatusType => {
  // PART_TIME / CONTRACT / INTERN — no penalty marks, duration tracked via check-in/out
  if (
    employmentType === 'PART_TIME' ||
    employmentType === 'CONTRACT' ||
    employmentType === 'INTERN'
  ) {
    return AttendanceStatus.PRESENT;
  }

  // FULL_TIME — existing cutoff-based marks
  const { hours, minutes } = getISTComponents(checkInDate);
  const totalMinutes = hours * 60 + minutes;

  const cutoff1030 = 10 * 60 + 30; // 630 minutes
  const cutoff1130 = 11 * 60 + 30; // 690 minutes

  if (totalMinutes <= cutoff1030) {
    return AttendanceStatus.PRESENT;
  }

  if (totalMinutes <= cutoff1130) {
    return hasApprovedProposal ? AttendanceStatus.APPROVED_LATE : AttendanceStatus.LATE;
  }

  // After 11:30 AM IST -> Half day rule
  return hasApprovedProposal ? AttendanceStatus.APPROVED_HALF_DAY : AttendanceStatus.HALF_DAY;
};

/**
 * § Phase 4 — the date the finer-grained morning scoring below takes effect.
 * "Forward only" per the requester: a check-in before this date keeps
 * scoring under the old flat +0.5-for-any-PRESENT rule (see
 * calculateAttendancePoints below) even when a past month's score is
 * recomputed live today, so a day someone already saw scored doesn't
 * silently change. Do not backdate this constant.
 */
export const PERFORMANCE_TIER_CUTOVER = new Date('2026-09-10T00:00:00+05:30');

/**
 * § Phase 4 — points earned/lost for one attendance log, centralizing what
 * used to be re-implemented independently at every call site (/my-score,
 * /history, /team, analytics.service.ts's teamPerformance). Replaces the old
 * flat "any PRESENT check-in earns +0.5" rule with a same-window gradient,
 * per the requester's exact spec:
 *   - before 10:00 AM IST            -> +1.0
 *   - 10:00–10:15 AM IST             -> +0.5
 *   - 10:15 AM up to the 10:30 cutoff -> 0.0
 *   - LATE / HALF_DAY (10:30 onward) -> unchanged (-1.0 each)
 *   - APPROVED_LATE / APPROVED_HALF_DAY -> 0.0 (an approval means "not
 *     penalized", not "still earns the on-time bonus" — this corrects a real
 *     bug where an approved-late check-in previously scored identically to
 *     on-time, +0.5)
 * Leave is untouched here by design — an approved LEAVE proposal never
 * creates an AttendanceLog row at all, so it was already neutral before this
 * change and needs no special-casing.
 */
export const calculateAttendancePoints = (
  status: AttendanceStatusType,
  checkInDate: Date | null,
  employmentType: string = 'FULL_TIME',
): number => {
  if (status === AttendanceStatus.APPROVED_LATE || status === AttendanceStatus.APPROVED_HALF_DAY) {
    return 0.0;
  }
  if (status === AttendanceStatus.LATE || status === AttendanceStatus.HALF_DAY) {
    return -1.0;
  }
  if (status !== AttendanceStatus.PRESENT) {
    return 0.0; // ABSENT / LEAVE / anything else — scored elsewhere, not here
  }

  // PART_TIME / CONTRACT / INTERN never get cutoff-based marks at all (see
  // calculateAttendanceStatus above) — they keep the pre-existing flat +0.5.
  // The new gradient is specifically about FULL_TIME's morning QR-scan cutoff.
  if (employmentType !== 'FULL_TIME' || !checkInDate || checkInDate < PERFORMANCE_TIER_CUTOVER) {
    return 0.5;
  }

  const { hours, minutes } = getISTComponents(checkInDate);
  const totalMinutes = hours * 60 + minutes;
  const cutoff1000 = 10 * 60;
  const cutoff1015 = 10 * 60 + 15;

  if (totalMinutes < cutoff1000) return 1.0;
  if (totalMinutes < cutoff1015) return 0.5;
  return 0.0; // 10:15 up to the existing 10:30 PRESENT cutoff
};
