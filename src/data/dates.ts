/** A real calendar day written `YYYY-MM-DD`. */
export function isDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return false;
  }
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

/** `2026-11-09` as the shop reads it: `09.11.2026`. */
export function formatDay(day: string): string {
  return day.split('-').reverse().join('.');
}

/** Today in Istanbul, `YYYY-MM-DD`: the latest a document's date may be. */
export function istanbulToday(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(at);
}
