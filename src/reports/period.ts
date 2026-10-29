export type PeriodChoice = 'today' | 'yesterday' | 'week' | 'month';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The business days a period covers, from `today` (YYYY-MM-DD): the week starts on Monday and
 * both the week and the month run up to today.
 */
export function periodOf(choice: PeriodChoice, today: string): { from: string; to: string } {
  const at = Date.parse(`${today}T00:00:00Z`);
  switch (choice) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const yesterday = isoDay(at - DAY_MS);
      return { from: yesterday, to: yesterday };
    }
    case 'week': {
      // getUTCDay: 0 is Sunday; Monday starts the week.
      const sinceMonday = (new Date(at).getUTCDay() + 6) % 7;
      return { from: isoDay(at - sinceMonday * DAY_MS), to: today };
    }
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today };
  }
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
