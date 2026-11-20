import { describe, expect, it } from 'vitest';
import { formatReceiptNo, nextReceiptSeq } from './receipt';

describe('receipt numbers', () => {
  it('formats device, day and padded sequence', () =>
    expect(formatReceiptNo('K1', '2026-10-28', 42)).toBe('K1-20261028-0042'));

  it('grows past four digits', () =>
    expect(formatReceiptNo('K1', '2026-10-28', 10000)).toBe('K1-20261028-10000'));

  it('starts at 1 on a business day the device has not used yet', () =>
    expect(nextReceiptSeq(null)).toBe(1));

  it('continues after the highest sequence the device issued that day', () =>
    expect(nextReceiptSeq(41)).toBe(42));

  it('never reuses a number when the clock moves back to an earlier day', () => {
    // The 28th already holds K1-…-0001..0120; the clock jumped to the 29th and back.
    // The caller passes the highest sequence issued on the 28th, not the device's latest receipt.
    expect(formatReceiptNo('K1', '2026-10-28', nextReceiptSeq(120))).toBe('K1-20261028-0121');
  });

  it('rejects an impossible previous sequence', () => {
    expect(() => nextReceiptSeq(-1)).toThrow(RangeError);
    expect(() => nextReceiptSeq(1.5)).toThrow(RangeError);
  });

  it('rejects bad input', () => {
    expect(() => formatReceiptNo('k1', '2026-10-28', 1)).toThrow(RangeError);
    expect(() => formatReceiptNo('K1', '28.10.2026', 1)).toThrow(RangeError);
    expect(() => formatReceiptNo('K1', '2026-10-28', 0)).toThrow(RangeError);
  });
});
