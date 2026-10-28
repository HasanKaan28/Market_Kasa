const DEFAULT_TIME_ZONE = 'Europe/Istanbul';

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

/**
 * The trading day an instant belongs to, as YYYY-MM-DD in the market's time zone.
 * A sale before the cutoff (minutes after midnight) still counts towards the previous day.
 */
export function businessDate(
  at: Date,
  opts: { timeZone?: string; cutoffMinutes?: number } = {},
): string {
  const { timeZone = DEFAULT_TIME_ZONE, cutoffMinutes = 0 } = opts;
  const shifted = new Date(at.getTime() - cutoffMinutes * 60_000);
  const parts = dayFormatter(timeZone).formatToParts(shifted);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
