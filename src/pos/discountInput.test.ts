import { describe, expect, it } from 'vitest';
import { readDiscount } from './discountInput';

describe('readDiscount', () => {
  it('reads a percent typed with its sign', () => {
    for (const typed of ['10', '%10', '10%', '% 10', ' 10 % ']) {
      expect([typed, readDiscount(typed, 'percent', 10000)]).toEqual([typed, 1000]);
    }
    expect(readDiscount('%101', 'percent', 10000)).toBeNull();
    expect(readDiscount('%', 'percent', 10000)).toBeNull();
  });
});
