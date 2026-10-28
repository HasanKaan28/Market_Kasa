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

  it('rejects sign mistakes', () =>
    expect(() =>
      balance([{ kind: 'payment', amount: 500, occurredAt: '2026-10-01T09:00:00Z' }]),
    ).toThrow(RangeError));
});

describe('stockLevel', () => {
  it('sums movements', () =>
    expect(stockLevel([{ delta: 50000 }, { delta: -2000 }, { delta: -1000 }])).toBe(47000));
});
