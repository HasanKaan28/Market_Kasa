import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCALE,
  isValidScaleConfig,
  readScaleBarcode,
  scaleItemCodes,
  scaleQtyMilli,
  withCheckDigit,
} from './scaleBarcode';

// 27 · item 00123 · 01250 g · check digit
const WEIGHED = withCheckDigit('270012301250');

describe('withCheckDigit', () => {
  it('adds the EAN-13 check digit', () => {
    expect(withCheckDigit('869000000001')).toBe('8690000000012');
  });
});

describe('readScaleBarcode', () => {
  it('reads the item code and the weight a scale prints', () => {
    expect(readScaleBarcode(WEIGHED, DEFAULT_SCALE)).toEqual({
      prefix: '27',
      itemCode: '00123',
      amount: 1250,
    });
  });

  it('splits by the item code length the shop set', () => {
    const code = withCheckDigit('280123045678');
    expect(readScaleBarcode(code, { ...DEFAULT_SCALE, codeDigits: 4 })).toEqual({
      prefix: '28',
      itemCode: '0123',
      amount: 45678,
    });
  });

  it('is nothing for an ordinary barcode, a bad check digit, a zero amount or a scale turned off', () => {
    const wrongCheck = `${WEIGHED.slice(0, 12)}${(Number(WEIGHED[12]) + 1) % 10}`;
    for (const code of ['8690000000012', wrongCheck, withCheckDigit('270012300000'), '2700123']) {
      expect(readScaleBarcode(code, DEFAULT_SCALE), code).toBeNull();
    }
    expect(readScaleBarcode(WEIGHED, { ...DEFAULT_SCALE, enabled: false })).toBeNull();
    expect(readScaleBarcode(WEIGHED, { ...DEFAULT_SCALE, prefixes: ['28'] })).toBeNull();
  });
});

describe('scaleItemCodes', () => {
  it('looks the item up with its prefix, as printed, and without leading zeros', () => {
    expect(scaleItemCodes({ prefix: '27', itemCode: '00123', amount: 1 })).toEqual([
      '2700123',
      '00123',
      '123',
    ]);
  });
});

describe('scaleQtyMilli', () => {
  const cheese = { unit: 'kg' as const, sellPrice: 40000 };
  const bread = { unit: 'piece' as const, sellPrice: 1500 };

  it('takes grams as thousandths of a kilo', () => {
    expect(scaleQtyMilli(1250, cheese, 'weight')).toBe(1250);
  });

  it('turns a price into a weight at the product’s price per kilo', () => {
    // 150,00 ₺ of cheese at 400,00 ₺/kg is 375 g.
    expect(scaleQtyMilli(15000, cheese, 'price')).toBe(375);
  });

  it('takes a price as whole pieces only when it divides evenly', () => {
    expect(scaleQtyMilli(4500, bread, 'price')).toBe(3000);
    expect(scaleQtyMilli(4000, bread, 'price')).toBeNull();
    expect(scaleQtyMilli(1250, bread, 'weight')).toBeNull();
    expect(scaleQtyMilli(1000, { unit: 'kg', sellPrice: 0 }, 'price')).toBeNull();
  });
});

describe('isValidScaleConfig', () => {
  it('takes two-digit prefixes from 20 to 29 and an item code of 4 to 6 digits', () => {
    expect(isValidScaleConfig(DEFAULT_SCALE)).toBe(true);
    expect(isValidScaleConfig({ ...DEFAULT_SCALE, prefixes: [] })).toBe(false);
    expect(isValidScaleConfig({ ...DEFAULT_SCALE, prefixes: ['86'] })).toBe(false);
    expect(isValidScaleConfig({ ...DEFAULT_SCALE, prefixes: ['2'] })).toBe(false);
    expect(isValidScaleConfig({ ...DEFAULT_SCALE, codeDigits: 7 })).toBe(false);
  });
});
