import { describe, expect, it } from 'vitest';
import {
  computeCart,
  distributeDiscount,
  lineTotal,
  vatIncluded,
  type CartLineInput,
} from './pricing';

const mockupCart: CartLineInput[] = [
  { qtyMilli: 2000, unitPrice: 1500, vatRate: 1 }, // Ekmek ×2
  { qtyMilli: 3000, unitPrice: 2250, vatRate: 1 }, // Ayran ×3
  { qtyMilli: 1000, unitPrice: 18990, vatRate: 1 }, // Beyaz Peynir
  { qtyMilli: 1000, unitPrice: 27900, vatRate: 1 }, // Siyah Çay
];

describe('computeCart', () => {
  it('totals the mockup cart', () => {
    const t = computeCart(mockupCart);
    expect(t.subtotal).toBe(56640);
    expect(t.total).toBe(56640);
    expect(t.lines.map((l) => l.vat)).toEqual([30, 67, 188, 276]);
    expect(t.vatTotal).toBe(561);
    expect(t.vatByRate).toEqual({ 1: 561 });
  });

  it('spreads a cart discount by largest remainder', () => {
    expect(distributeDiscount([3000, 6750, 18990, 27900], 1000)).toEqual([53, 119, 335, 493]);
    const t = computeCart(mockupCart, 1000);
    expect(t.lines.map((l) => l.net)).toEqual([2947, 6631, 18655, 27407]);
    expect(t.total).toBe(55640);
    expect(t.vatTotal).toBe(551);
  });

  it('applies a line discount before VAT', () => {
    const t = computeCart([{ qtyMilli: 1000, unitPrice: 5000, vatRate: 20, lineDiscount: 500 }]);
    expect(t.lines[0]).toMatchObject({ gross: 5000, net: 4500, vat: 750 });
  });

  it('groups VAT by rate', () => {
    const t = computeCart([
      { qtyMilli: 1000, unitPrice: 1500, vatRate: 1 },
      { qtyMilli: 1000, unitPrice: 4990, vatRate: 20 },
      { qtyMilli: 1000, unitPrice: 8990, vatRate: 20 },
    ]);
    expect(t.total).toBe(15480);
    expect(t.vatByRate).toEqual({ 1: 15, 20: 2330 });
  });
});

describe('line and VAT rules', () => {
  it('handles 0% VAT and fractional quantities', () => {
    expect(vatIncluded(1000, 0)).toBe(0);
    expect(lineTotal(1500, 5000)).toBe(7500);
    expect(lineTotal(333, 1999)).toBe(666);
  });

  it('is symmetric for refunds', () => {
    expect(vatIncluded(-3000, 1)).toBe(-30);
  });

  it('rejects impossible discounts', () => {
    expect(() => distributeDiscount([3000], 3001)).toThrow(RangeError);
    expect(() => distributeDiscount([3000], -1)).toThrow(RangeError);
    expect(distributeDiscount([], 0)).toEqual([]);
    expect(() => computeCart([], 100)).toThrow(RangeError);
  });

  it('rejects a negative line discount', () => {
    expect(() =>
      computeCart([{ qtyMilli: 1000, unitPrice: 500, vatRate: 1, lineDiscount: -100 }]),
    ).toThrow(RangeError);
  });
});
