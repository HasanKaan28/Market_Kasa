import { describe, expect, it } from 'vitest';
import { fitsUnit, readMultiplier } from './multiplier';

describe('readMultiplier', () => {
  it('reads a count typed before a star', () => {
    expect(readMultiplier('10*')).toEqual({ qtyMilli: 10_000, rest: '' });
    expect(readMultiplier(' 3 * ')).toEqual({ qtyMilli: 3_000, rest: '' });
    expect(readMultiplier('2×')).toEqual({ qtyMilli: 2_000, rest: '' });
  });

  it('reads a weight with a comma or a point', () => {
    expect(readMultiplier('1,5*')).toEqual({ qtyMilli: 1_500, rest: '' });
    expect(readMultiplier('0.25*')).toEqual({ qtyMilli: 250, rest: '' });
  });

  it('keeps what follows the star as the search', () => {
    expect(readMultiplier('3*süt')).toEqual({ qtyMilli: 3_000, rest: 'süt' });
    expect(readMultiplier('10*8690000000017')).toEqual({ qtyMilli: 10_000, rest: '8690000000017' });
  });

  it('is nothing for text that does not start with a count and a star', () => {
    for (const text of ['', 'süt', '10', '*5', '0*', '0,0*', '12345*', '1,2345*', 'a10*']) {
      expect(readMultiplier(text), text).toBeNull();
    }
  });
});

describe('fitsUnit', () => {
  it('takes whole pieces, and any weight', () => {
    expect(fitsUnit(10_000, 'piece')).toBe(true);
    expect(fitsUnit(1_500, 'piece')).toBe(false);
    expect(fitsUnit(1_500, 'kg')).toBe(true);
  });
});
