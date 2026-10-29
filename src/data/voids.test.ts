import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import { createCustomer, customerBalance } from './customers';
import type { MarketDb } from './db';
import { RecordNotFoundError, SaleReturnedError, SaleVoidedError } from './errors';
import { pendingOps } from './outbox';
import { createProduct } from './products';
import { recordSale } from './sales';
import { stockOf } from './stock';
import type { SaleRecord } from './types';
import { isVoided, voidSale } from './voids';

let db: MarketDb;
let sale: SaleRecord;
let customerId: string;
const at = new Date('2026-10-29T09:00:00Z');
const later = new Date('2026-10-29T10:00:00Z');

beforeEach(async () => {
  db = makeTestDb();
  const make = async (name: string, sellPrice: number) =>
    (await createProduct(db, { name, sellPrice, vatRate: 1 }, at)).id;
  const ekmek = await make('Ekmek', 1500);
  const ayran = await make('Ayran', 2250);
  customerId = (await createCustomer(db, { name: 'Ahmet' }, at)).id;
  sale = await recordSale(db, {
    deviceCode: 'K1',
    at,
    customerId,
    lines: [
      { productId: ekmek, qtyMilli: 2000 },
      { productId: ayran, qtyMilli: 3000 },
    ],
    payments: [{ method: 'credit', amount: 9750 }],
  });
});
afterEach(async () => {
  await db.delete();
});

const input = (reason: string) => ({ saleId: sale.id, reason, deviceCode: 'K1', at: later });

describe('voidSale', () => {
  it('puts the stock back and clears the credit', async () => {
    const record = await voidSale(db, input('Yanlış ürün'));
    for (const line of sale.lines) {
      expect(await stockOf(db, line.productId)).toBe(0);
    }
    expect(await customerBalance(db, customerId)).toBe(0);
    expect(await isVoided(db, sale.id)).toBe(true);
    expect((await pendingOps(db)).map((op) => op.table)).toContain('saleVoids');
    expect(record).toMatchObject({
      saleId: sale.id,
      reason: 'Yanlış ürün',
      businessDate: '2026-10-29',
    });
  });

  it('voids a sale once', async () => {
    await voidSale(db, input('Yanlış ürün'));
    const movements = await db.stockMovements.count();
    await expect(voidSale(db, input('Tekrar'))).rejects.toBeInstanceOf(SaleVoidedError);
    expect(await db.stockMovements.count()).toBe(movements);
  });

  it('needs a reason and an existing sale', async () => {
    const before = (await pendingOps(db)).length;
    await expect(voidSale(db, input('  '))).rejects.toThrow(RangeError);
    await expect(voidSale(db, { ...input('X'), saleId: 'missing' })).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
    expect((await pendingOps(db)).length).toBe(before);
  });

  it('refuses to void a sale with returns', async () => {
    await db.returns.add({
      id: 'r1',
      saleId: sale.id,
      deviceCode: 'K1',
      lines: [],
      refundMethod: 'credit',
      amount: 0,
      vat: 0,
      occurredAt: later.toISOString(),
      businessDate: '2026-10-29',
    });
    await expect(voidSale(db, input('X'))).rejects.toBeInstanceOf(SaleReturnedError);
  });
});
