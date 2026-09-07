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
