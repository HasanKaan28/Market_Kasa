import { describe, expect, it } from 'vitest';
import { formatPriceInput, formatStock, parseQuantity } from './format';

describe('formatPriceInput', () => {
  it('writes a price for an input field, without grouping', () => {
    expect(formatPriceInput(4250)).toBe('42,50');
    expect(formatPriceInput(100_000_000)).toBe('1000000,00');
  });
});

describe('formatStock', () => {
  it('formats stock with its unit', () => {
    expect(formatStock(12000, 'piece')).toBe('12 adet');
    expect(formatStock(1250, 'kg')).toBe('1,25 kg');
    expect(formatStock(-3000, 'piece')).toBe('−3 adet');
    expect(formatStock(0, 'kg')).toBe('0 kg');
  });
});

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
