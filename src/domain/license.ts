import { businessDate } from './businessDate';

/** Where a market's licence stands on a day (DESIGN §8.6). */
export type LicenseState =
  | { kind: 'unknown' }
  | { kind: 'active'; daysLeft: number }
  | { kind: 'warning'; daysLeft: number }
  | { kind: 'grace'; graceDaysLeft: number }
  | { kind: 'readOnly' };

const WARNING_DAYS = 7;
const GRACE_DAYS = 3;
const DAY_MS = 86_400_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The licence on the business day of `now`: a warning in its last 7 days, 3 days of grace after
 * its last day, then read-only. `expiresAt` is the last day it covers (YYYY-MM-DD); without one,
 * nothing is known and nothing is restricted.
 */
export function licenseState(
  expiresAt: string | null,
  now: Date,
  opts: { cutoffMinutes?: number } = {},
): LicenseState {
  if (expiresAt === null || !DAY.test(expiresAt) || Number.isNaN(Date.parse(expiresAt))) {
    return { kind: 'unknown' };
  }
  const today = businessDate(now, opts);
  const daysLeft = Math.round((Date.parse(expiresAt) - Date.parse(today)) / DAY_MS);
  if (daysLeft > WARNING_DAYS) {
    return { kind: 'active', daysLeft };
  }
  if (daysLeft >= 0) {
    return { kind: 'warning', daysLeft };
  }
  if (daysLeft >= -GRACE_DAYS) {
    return { kind: 'grace', graceDaysLeft: GRACE_DAYS + daysLeft };
  }
  return { kind: 'readOnly' };
}
