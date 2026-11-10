import { describe, expect, it } from 'vitest';
import { divRoundHalfUp, formatTRY, MoneyParseError, parseTRY } from './money';

describe('formatTRY', () => {
  it.each([
    [123450, '₺1.234,50'],
    [1500, '₺15,00'],
    [0, '₺0,00'],
    [-3020, '-₺30,20'],
    [123456789, '₺1.234.567,89'],
  ])('%i → %s', (k, s) => expect(formatTRY(k)).toBe(s));

  it('rejects non-integer kuruş', () => expect(() => formatTRY(1.5)).toThrow(RangeError));

  it('never shows a negative zero', () => expect(formatTRY(-0)).toBe('₺0,00'));
});

describe('parseTRY', () => {
  it.each([
    ['1.234,50', 123450],
    ['1234,5', 123450],
    ['12,5', 1250],
    ['12.5', 1250],
    ['12.50', 1250],
    ['1.250', 125000],
    ['₺ 1.234,50', 123450],
    ['15 TL', 1500],
    ['15', 1500],
    ['0', 0],
  ])('%s → %i', (s, k) => expect(parseTRY(s)).toBe(k));

  it.each(['', 'abc', '-5', '1,234', '1,2,3', '12.3.4', ','])('rejects %j', (s) =>
    expect(() => parseTRY(s)).toThrow(MoneyParseError),
  );

  it('refuses grouping that cannot be thousands', () => {
    for (const typed of ['0.500', '00.500', '1.23,50', '1234.567', '1.2345,00', '0.500,00']) {
      expect(() => parseTRY(typed), typed).toThrow(MoneyParseError);
    }
    expect(parseTRY('1.250,5')).toBe(125050);
    expect(parseTRY('12.345.678')).toBe(1234567800);
  });
});

describe('divRoundHalfUp', () => {
  it.each([
    [5, 2, 3],
    [-5, 2, -3],
    [4, 2, 2],
    [7, 3, 2],
    [300000, 101, 2970],
    [-1, 3, 0],
  ])('%i / %i → %i', (n, d, r) => expect(divRoundHalfUp(n, d)).toBe(r));
});
