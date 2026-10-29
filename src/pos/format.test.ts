import { describe, expect, it } from 'vitest';
import { parseQuantity } from './format';

describe('parseQuantity', () => {
  it('reads quantities by unit', () => {
    expect(parseQuantity('3', 'piece')).toBe(3000);
    expect(parseQuantity('1,5', 'piece')).toBeNull();
    expect(parseQuantity('0', 'piece')).toBeNull();
    expect(parseQuantity('abc', 'piece')).toBeNull();
    expect(parseQuantity('20000', 'piece')).toBeNull();
    expect(parseQuantity('1,250', 'kg')).toBe(1250);
    expect(parseQuantity(' 0,5 ', 'kg')).toBe(500);
    expect(parseQuantity('1.5', 'kg')).toBe(1500);
    expect(parseQuantity('1,2345', 'kg')).toBeNull();
  });
});
