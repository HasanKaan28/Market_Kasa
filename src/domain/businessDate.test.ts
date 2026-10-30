import { describe, expect, it } from 'vitest';
import { businessDate, businessDayStart } from './businessDate';

describe('businessDate', () => {
  it.each([
    ['2026-10-28T20:59:59Z', 0, '2026-10-28'],
    ['2026-10-28T21:00:00Z', 0, '2026-10-29'],
    ['2026-10-28T21:30:00Z', 240, '2026-10-28'],
    ['2026-10-29T00:59:59Z', 240, '2026-10-28'],
    ['2026-10-29T01:00:00Z', 240, '2026-10-29'],
  ])('%s (cutoff %i) → %s', (iso, cutoff, day) =>
    expect(businessDate(new Date(iso), { cutoffMinutes: cutoff })).toBe(day),
  );

  it('refuses a cutoff outside the day', () => {
    const at = new Date('2026-10-29T09:00:00Z');
    expect(() => businessDate(at, { cutoffMinutes: -1 })).toThrow(RangeError);
    expect(() => businessDate(at, { cutoffMinutes: 721 })).toThrow(RangeError);
    expect(() => businessDate(at, { cutoffMinutes: 1.5 })).toThrow(RangeError);
    // 11:00 in Istanbul, before a day that turns at noon.
    expect(businessDate(new Date('2026-10-29T08:00:00Z'), { cutoffMinutes: 720 })).toBe(
      '2026-10-28',
    );
  });
  it('finds the instant a business day starts', () => {
    expect(businessDayStart('2026-10-29').toISOString()).toBe('2026-10-28T21:00:00.000Z');
    expect(businessDayStart('2026-10-29', { cutoffMinutes: 120 }).toISOString()).toBe(
      '2026-10-28T23:00:00.000Z',
    );
    const start = businessDayStart('2026-03-01');
    expect(businessDate(start)).toBe('2026-03-01');
    expect(businessDate(new Date(start.getTime() - 1))).toBe('2026-02-28');
  });
});
