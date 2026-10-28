import { describe, expect, it } from 'vitest';
import { formatReceiptNo, nextReceiptSeq } from './receipt';

describe('receipt numbers', () => {
  it('formats device, day and padded sequence', () =>
    expect(formatReceiptNo('K1', '2026-10-28', 42)).toBe('K1-20261028-0042'));

  it('grows past four digits', () =>
    expect(formatReceiptNo('K1', '2026-10-28', 10000)).toBe('K1-20261028-10000'));

  it('restarts each business day', () => {
    expect(nextReceiptSeq(null, '2026-10-28')).toBe(1);
    expect(nextReceiptSeq({ businessDate: '2026-10-28', seq: 41 }, '2026-10-28')).toBe(42);
    expect(nextReceiptSeq({ businessDate: '2026-10-28', seq: 41 }, '2026-10-29')).toBe(1);
  });

  it('rejects bad input', () => {
    expect(() => formatReceiptNo('k1', '2026-10-28', 1)).toThrow(RangeError);
    expect(() => formatReceiptNo('K1', '28.10.2026', 1)).toThrow(RangeError);
    expect(() => formatReceiptNo('K1', '2026-10-28', 0)).toThrow(RangeError);
  });
});
