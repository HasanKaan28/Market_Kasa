import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import { createCustomer, customerBalance } from './customers';
import type { MarketDb } from './db';
import { ReturnExceedsSaleError, SaleVoidedError } from './errors';
import { createProduct } from './products';
import { planRefund, recordReturn, returnedQuantities } from './returns';
import { recordSale } from './sales';
import { stockOf } from './stock';
import type { Payment } from './types';
import { voidSale } from './voids';

let db: MarketDb;
let ekmek: string;
let ayran: string;
const at = new Date('2026-10-29T09:00:00Z');
const later = new Date('2026-10-29T10:00:00Z');

beforeEach(async () => {
  db = makeTestDb();
  ekmek = (await createProduct(db, { name: 'Ekmek', sellPrice: 1500, vatRate: 1 }, at)).id;
  ayran = (await createProduct(db, { name: 'Ayran', sellPrice: 2250, vatRate: 1 }, at)).id;
});
afterEach(async () => {
  await db.delete();
});

async function sell(productId: string, qtyMilli: number, payments: Payment[], customerId?: string) {
  return recordSale(db, {
    deviceCode: 'K1',
    at,
    customerId,
    lines: [{ productId, qtyMilli }],
    payments,
  });
}

const giveBack = (saleId: string, productId: string, qtyMilli: number) =>
  recordReturn(db, { saleId, lines: [{ productId, qtyMilli }], deviceCode: 'K1', at: later });

describe('recordReturn', () => {
  it('returns stock and reduces the debt', async () => {
    const customer = await createCustomer(db, { name: 'Ahmet' }, at);
    const sale = await sell(ayran, 3000, [{ method: 'credit', amount: 6750 }], customer.id);
    const record = await giveBack(sale.id, ayran, 1000);
    expect(record).toMatchObject({
      amount: 2250,
      refunds: [{ method: 'credit', amount: 2250 }],
      saleId: sale.id,
    });
    expect(record.lines).toEqual([
      expect.objectContaining({ productId: ayran, name: 'Ayran', qtyMilli: 1000, net: 2250 }),
    ]);
    expect(await stockOf(db, ayran)).toBe(-2000);
    expect(await customerBalance(db, customer.id)).toBe(4500);
  });

  it('splits partial returns so they add up to the line', async () => {
    const sale = await sell(ayran, 3000, [{ method: 'cash', amount: 6750 }]);
    const vats: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      vats.push((await giveBack(sale.id, ayran, 1000)).vat);
    }
    expect(vats).toEqual([22, 23, 22]);
    expect(vats.reduce((a, b) => a + b, 0)).toBe(sale.lines[0]?.vat);
    expect((await returnedQuantities(db, sale.id)).get(ayran)).toBe(3000);
  });

  it('refunds a split sale the way it was paid, debt first and cash last', async () => {
    const customer = await createCustomer(db, { name: 'Ahmet' }, at);
    const payments: Payment[] = [
      { method: 'cash', amount: 1000 },
      { method: 'credit', amount: 2000 },
    ];
    const sale = await sell(ekmek, 2000, payments, customer.id);
    expect((await giveBack(sale.id, ekmek, 1000)).refunds).toEqual([
      { method: 'credit', amount: 1500 },
    ]);
    expect((await giveBack(sale.id, ekmek, 1000)).refunds).toEqual([
      { method: 'credit', amount: 500 },
      { method: 'cash', amount: 1000 },
    ]);
    expect(await customerBalance(db, customer.id)).toBe(0);
  });

  it('refuses to return more than was sold', async () => {
    const sale = await sell(ekmek, 2000, [{ method: 'cash', amount: 3000 }]);
    await giveBack(sale.id, ekmek, 1000);
    await expect(giveBack(sale.id, ekmek, 2000)).rejects.toBeInstanceOf(ReturnExceedsSaleError);
    expect(await db.returns.count()).toBe(1);
    expect(await stockOf(db, ekmek)).toBe(-1000);
  });

  it('refuses a return on a voided sale', async () => {
    const sale = await sell(ekmek, 2000, [{ method: 'cash', amount: 3000 }]);
    await voidSale(db, { saleId: sale.id, reason: 'Yanlış', deviceCode: 'K1', at: later });
    await expect(giveBack(sale.id, ekmek, 1000)).rejects.toBeInstanceOf(SaleVoidedError);
  });

  it('refuses lines the sale does not have', async () => {
    const sale = await sell(ekmek, 2000, [{ method: 'cash', amount: 3000 }]);
    await expect(giveBack(sale.id, ayran, 1000)).rejects.toThrow(RangeError);
    await expect(giveBack(sale.id, ekmek, 0)).rejects.toThrow(RangeError);
    expect(await db.returns.count()).toBe(0);
  });
});

describe('planRefund', () => {
  it('takes card before cash, and never more than each method still holds', () => {
    const payments: Payment[] = [
      { method: 'cash', amount: 1000 },
      { method: 'card', amount: 500 },
    ];
    expect(planRefund(payments, [], 1200)).toEqual([
      { method: 'card', amount: 500 },
      { method: 'cash', amount: 700 },
    ]);
    const earlier = [{ method: 'card' as const, amount: 500 }];
    expect(planRefund(payments, earlier, 300)).toEqual([{ method: 'cash', amount: 300 }]);
    expect(() => planRefund(payments, earlier, 1100)).toThrow(RangeError);
  });
});
