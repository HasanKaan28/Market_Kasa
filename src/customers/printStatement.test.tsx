import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomerRecord, LedgerRecord } from '@/data/types';
import { printStatement } from './printStatement';

afterEach(() => {
  act(() => {
    window.dispatchEvent(new Event('afterprint'));
  });
});

const stamp = '2026-10-20T09:00:00.000Z';
const customer: CustomerRecord = {
  id: 'c1',
  name: 'Ahmet',
  phone: '05321112233',
  creditLimit: 0,
  createdAt: stamp,
  updatedAt: stamp,
};

function entry(id: string, amount: number, occurredAt: string): LedgerRecord {
  return {
    id,
    customerId: 'c1',
    kind: amount > 0 ? 'debt' : 'payment',
    amount,
    occurredAt,
    businessDate: occurredAt.slice(0, 10),
  };
}

describe('printStatement', () => {
  it('prints the statement on A4, oldest first', () => {
    let printed = '';
    const print = vi.fn(() => {
      printed = document.getElementById('print-root')?.textContent ?? '';
    });
    printStatement(
      {
        marketName: 'Kurşunlu Market',
        customer,
        lines: [
          {
            entry: entry('e1', 5000, '2026-10-20T09:00:00.000Z'),
            description: 'Satış K1-20261020-0001',
            balanceAfter: 5000,
          },
          {
            entry: entry('e2', -2000, '2026-10-25T09:00:00.000Z'),
            description: 'Tahsilat (nakit)',
            balanceAfter: 3000,
          },
        ],
        printedAt: new Date('2026-10-29T09:00:00Z'),
      },
      print,
    );
    expect(print).toHaveBeenCalledTimes(1);
    for (const text of [
      'Kurşunlu Market',
      'Müşteri ekstresi',
      'Ahmet',
      '29.10.2026',
      'Bakiye: ₺30,00',
    ]) {
      expect(printed).toContain(text);
    }
    expect(printed.indexOf('Satış K1-20261020-0001')).toBeLessThan(
      printed.indexOf('Tahsilat (nakit)'),
    );
    expect(document.getElementById('print-page')?.textContent).toBe(
      '@page { size: A4; margin: 15mm; }',
    );
  });
});
