const DEFAULT_TIME_ZONE = 'Europe/Istanbul';
// A day may turn at most at noon; later would move a whole working day to the day before.
const MAX_CUTOFF_MINUTES = 720;

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dayFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Whether a day cutoff is whole minutes after midnight, at most noon. */
export function isValidCutoff(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes >= 0 && minutes <= MAX_CUTOFF_MINUTES;
}

/**
 * The trading day an instant belongs to, as YYYY-MM-DD in the market's time zone.
 * A sale before the cutoff (minutes after midnight) still counts towards the previous day.
 */
export function businessDate(
  at: Date,
  opts: { timeZone?: string; cutoffMinutes?: number } = {},
): string {
  const { timeZone = DEFAULT_TIME_ZONE, cutoffMinutes = 0 } = opts;
  if (!Number.isInteger(cutoffMinutes) || cutoffMinutes < 0 || cutoffMinutes > MAX_CUTOFF_MINUTES) {
    throw new RangeError(
      `A day cutoff must be 0 to ${MAX_CUTOFF_MINUTES} minutes, got ${cutoffMinutes}`,
    );
  }
  const shifted = new Date(at.getTime() - cutoffMinutes * 60_000);
  const parts = dayFormatter(timeZone).formatToParts(shifted);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

const wallClockFormatters = new Map<string, Intl.DateTimeFormat>();

function wallClockFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = wallClockFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    wallClockFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** How far the zone's clock is ahead of UTC at an instant, in milliseconds. */
function zoneOffset(at: number, timeZone: string): number {
  const parts = wallClockFormatter(timeZone).formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value ?? 0);
  const wall = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return wall - Math.floor(at / 1000) * 1000;
}

/** The instant a business day (YYYY-MM-DD) starts: its midnight in the zone, plus the cutoff. */
export function businessDayStart(
  day: string,
  opts: { timeZone?: string; cutoffMinutes?: number } = {},
): Date {
  const { timeZone = DEFAULT_TIME_ZONE, cutoffMinutes = 0 } = opts;
  const midnightAsUtc = Date.parse(`${day}T00:00:00Z`);
  const midnight = midnightAsUtc - zoneOffset(midnightAsUtc, timeZone);
  return new Date(midnight + cutoffMinutes * 60_000);
}
