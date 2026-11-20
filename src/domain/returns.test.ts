import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { refundShare } from './returns';

describe('refundShare', () => {
  it('splits a line into partial refunds that add up to its net', () => {
    const parts = [0, 1000, 2000].map((already) => refundShare(1000, 3000, already, 1000));
    expect(parts).toEqual([333, 334, 333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.array(fc.integer({ min: 1, max: 5000 }), { minLength: 1, maxLength: 8 }),
        (amount, steps) => {
          const sold = steps.reduce((a, b) => a + b, 0);
          let already = 0;
          let refunded = 0;
          for (const step of steps) {
            refunded += refundShare(amount, sold, already, step);
            already += step;
          }
          expect(refunded).toBe(amount);
        },
      ),
    );
  });

  it('refuses impossible quantities', () => {
    expect(() => refundShare(1000, 3000, 2000, 2000)).toThrow(RangeError);
    expect(() => refundShare(1000, 3000, 0, 0)).toThrow(RangeError);
    expect(() => refundShare(1000, 0, 0, 1000)).toThrow(RangeError);
  });
});
