import { describe, expect, it } from 'vitest';
import { businessDate } from './businessDate';

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
});
