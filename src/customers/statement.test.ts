import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { archiveCustomer, createCustomer } from '@/data/customers';
import type { MarketDb } from '@/data/db';
import { recordAdjustment, recordPayment } from '@/data/ledger';
import { createProduct } from '@/data/products';
import { recordReturn } from '@/data/returns';
import { recordSale } from '@/data/sales';
import { voidSale } from '@/data/voids';
import { makeTestDb } from '@/test/db';
import { customerStatement, customerSummaries, formatBalance } from './statement';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const day = (n: number) => new Date(Date.UTC(2026, 9, n, 9));

describe('customer balances', () => {
  it('keeps an overpayment as credit', async () => {
    const ahmet = await createCustomer(db, { name: 'Ahmet' }, day(1));
    await recordAdjustment(db, { customerId: ahmet.id, amount: 5000, note: 'Eski borç' }, day(1));
    await recordPayment(db, { customerId: ahmet.id, amount: 7000, method: 'cash' }, day(2));
    expect(await customerSummaries(db, '2026-10-29')).toMatchObject([
      { customer: { id: ahmet.id }, balance: -2000, debtAgeDays: 0 },
    ]);
    expect([formatBalance(-2000), formatBalance(0), formatBalance(4250)]).toEqual([
      'Alacak ₺20,00',
      '₺0,00',
      '₺42,50',
    ]);
  });

  it('sums only active customers, by name', async () => {
    const zeynep = await createCustomer(db, { name: 'Zeynep' }, day(1));
    const cem = await createCustomer(db, { name: 'Çetin' }, day(1));
    const gone = await createCustomer(db, { name: 'Ali' }, day(1));
    await archiveCustomer(db, gone.id, day(2));
    await recordAdjustment(db, { customerId: zeynep.id, amount: 1000, note: 'Eski borç' }, day(10));
    const summaries = await customerSummaries(db, '2026-10-29');
    expect(summaries.map((row) => [row.customer.name, row.balance, row.debtAgeDays])).toEqual([
      ['Çetin', 0, 0],
      ['Zeynep', 1000, 19],
    ]);
    expect(summaries.map((row) => row.customer.id)).toEqual([cem.id, zeynep.id]);
  });
});

describe('customerStatement', () => {
  it('describes each entry and carries the balance', async () => {
    const ahmet = await createCustomer(db, { name: 'Ahmet', creditLimit: 100000 }, day(1));
    const tea = await createProduct(db, { name: 'Çay', sellPrice: 9000, vatRate: 1 }, day(1), {
      openingStockMilli: 50000,
    });
    const credit = (at: Date) =>
      recordSale(db, {
        deviceCode: 'K1',
        at,
        lines: [{ productId: tea.id, qtyMilli: 2000 }],
        payments: [{ method: 'credit', amount: 18000 }],
        customerId: ahmet.id,
      });
    const first = await credit(day(2));
    const second = await credit(day(3));
    await voidSale(db, { saleId: second.id, reason: 'Yanlış müşteri', deviceCode: 'K1', at: day(4) });
    await recordReturn(db, {
      saleId: first.id,
      lines: [{ productId: tea.id, qtyMilli: 1000 }],
      deviceCode: 'K1',
      at: day(5),
    });
    await recordPayment(
      db,
      { customerId: ahmet.id, amount: 5000, method: 'card', note: 'kart' },
      day(6),
    );
    await recordAdjustment(db, { customerId: ahmet.id, amount: -1000, note: 'yuvarlama' }, day(7));
    const lines = await customerStatement(db, ahmet.id);
    expect(lines.map((line) => [line.description, line.entry.amount, line.balanceAfter])).toEqual([
      [`Satış ${first.receiptNo}`, 18000, 18000],
      [`Satış ${second.receiptNo}`, 18000, 36000],
      [`Satış iptali ${second.receiptNo}`, -18000, 18000],
      [`İade ${first.receiptNo}`, -9000, 9000],
      ['Tahsilat (kart): kart', -5000, 4000],
      ['Düzeltme: yuvarlama', -1000, 3000],
    ]);
  });
});
