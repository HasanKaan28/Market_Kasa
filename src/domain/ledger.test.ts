import { describe, expect, it } from 'vitest';
import { balance, debtAgeDays, oldestUnpaidDebt, stockLevel, type LedgerEntry } from './ledger';

const entries: LedgerEntry[] = [
  { kind: 'debt', amount: 10000, occurredAt: '2026-10-01T09:00:00Z' },
  { kind: 'debt', amount: 5000, occurredAt: '2026-10-10T09:00:00Z' },
  { kind: 'payment', amount: -12000, occurredAt: '2026-10-15T09:00:00Z' },
];

describe('ledger', () => {
  it('sums signed amounts', () => expect(balance(entries)).toBe(3000));

  it('ages from the oldest unpaid debt, FIFO', () => {
    expect(oldestUnpaidDebt(entries)).toBe('2026-10-10T09:00:00Z');
    expect(debtAgeDays(entries, '2026-10-28')).toBe(18);
  });

  it('orders by time, not by array position', () =>
    expect(oldestUnpaidDebt([...entries].reverse())).toBe('2026-10-10T09:00:00Z'));

  it('keeps overpayment as credit', () => {
    const over: LedgerEntry[] = [
      { kind: 'debt', amount: 10000, occurredAt: '2026-10-01T09:00:00Z' },
      { kind: 'payment', amount: -12000, occurredAt: '2026-10-02T09:00:00Z' },
    ];
    expect(balance(over)).toBe(-2000);
    expect(oldestUnpaidDebt(over)).toBeNull();
    expect(debtAgeDays(over, '2026-10-28')).toBe(0);
  });

  it('applies earlier credit to later debts', () => {
    const e: LedgerEntry[] = [
      { kind: 'debt', amount: 10000, occurredAt: '2026-10-01T09:00:00Z' },
      { kind: 'payment', amount: -12000, occurredAt: '2026-10-02T09:00:00Z' },
      { kind: 'debt', amount: 5000, occurredAt: '2026-10-05T09:00:00Z' },
    ];
    expect(balance(e)).toBe(3000);
    expect(oldestUnpaidDebt(e)).toBe('2026-10-05T09:00:00Z');
  });

  it('rejects fractional kuruş', () =>
    expect(() =>
      balance([{ kind: 'debt', amount: 0.5, occurredAt: '2026-10-01T09:00:00Z' }]),
    ).toThrow(RangeError));

  it('rejects sign mistakes', () =>
    expect(() =>
      balance([{ kind: 'payment', amount: 500, occurredAt: '2026-10-01T09:00:00Z' }]),
    ).toThrow(RangeError));
});

describe('stockLevel', () => {
  it('sums movements', () =>
    expect(stockLevel([{ delta: 50000 }, { delta: -2000 }, { delta: -1000 }])).toBe(47000));

  it('rejects fractional thousandths', () =>
    expect(() => stockLevel([{ delta: 0.5 }])).toThrow(RangeError));

  it("closes the voided sale's debt, not the oldest", () => {
    const voided: LedgerEntry[] = [
      { kind: 'debt', amount: 5000, saleId: 'a', occurredAt: '2026-10-01T09:00:00Z' },
      { kind: 'debt', amount: 5000, saleId: 'b', occurredAt: '2026-10-10T09:00:00Z' },
      { kind: 'adjustment', amount: -5000, saleId: 'b', occurredAt: '2026-10-12T09:00:00Z' },
    ];
    expect(oldestUnpaidDebt(voided)).toBe('2026-10-01T09:00:00Z');
  });

  it('lets a payment close the oldest debt, not a hand-written later one', () => {
    const entries: LedgerEntry[] = [
      { kind: 'debt', amount: 5000, saleId: 'a', occurredAt: '2026-10-01T09:00:00Z' },
      { kind: 'adjustment', amount: 3000, occurredAt: '2026-10-05T09:00:00Z' },
      { kind: 'payment', amount: -5000, occurredAt: '2026-10-06T09:00:00Z' },
    ];
    expect(oldestUnpaidDebt(entries)).toBe('2026-10-05T09:00:00Z');
  });

  it("carries what a void takes back beyond its sale's debt to the next debt", () => {
    const entries: LedgerEntry[] = [
      { kind: 'debt', amount: 10000, saleId: 'a', occurredAt: '2026-10-01T09:00:00Z' },
      { kind: 'debt', amount: 5000, saleId: 'b', occurredAt: '2026-10-02T09:00:00Z' },
      { kind: 'payment', amount: -5000, occurredAt: '2026-10-03T09:00:00Z' },
      { kind: 'adjustment', amount: -10000, saleId: 'a', occurredAt: '2026-10-04T09:00:00Z' },
    ];
    expect(oldestUnpaidDebt(entries)).toBeNull();
  });

  it('counts debt age by the business day cutoff', () => {
    // 02:30 in Istanbul on the 29th: with the day turning at 04:00 it is still the 28th.
    const late: LedgerEntry[] = [
      { kind: 'debt', amount: 1000, occurredAt: '2026-10-28T23:30:00Z' },
    ];
    expect(debtAgeDays(late, '2026-10-29')).toBe(0);
    expect(debtAgeDays(late, '2026-10-29', { cutoffMinutes: 240 })).toBe(1);
  });

  it('ages a debt by its business day', () => {
    // Written with the day turning at 04:00, so kept as the 28th whatever the cutoff is now.
    const kept: LedgerEntry[] = [
      {
        kind: 'debt',
        amount: 1000,
        occurredAt: '2026-10-28T23:30:00Z',
        businessDate: '2026-10-28',
      },
    ];
    expect(debtAgeDays(kept, '2026-10-29')).toBe(1);
  });
});
