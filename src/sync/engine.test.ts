import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MarketDb } from '@/data/db';
import { pendingCount } from '@/data/outbox';
import { createProduct, findProductByBarcode } from '@/data/products';
import { recentSales, recordSale } from '@/data/sales';
import { stockOf } from '@/data/stock';
import { makeTestDb } from '@/test/db';
import { syncOnce } from './engine';
import { FakeServer } from './fakeServer';

let a: MarketDb;
let b: MarketDb;
let server: FakeServer;
beforeEach(() => {
  a = makeTestDb();
  b = makeTestDb();
  server = new FakeServer();
});
afterEach(async () => {
  await a.delete();
  await b.delete();
});

const at = new Date('2026-10-29T09:00:00Z');

async function sellOneMilk(db: MarketDb) {
  const milk = await createProduct(
    db,
    { barcode: 'B1', name: 'Süt', sellPrice: 4250, vatRate: 1 },
    at,
  );
  await recordSale(db, {
    deviceCode: 'K1',
    at,
    lines: [{ productId: milk.id, qtyMilli: 1000 }],
    payments: [{ method: 'cash', amount: 4250 }],
  });
  return milk;
}

describe('syncOnce', () => {
  it('moves a product and a sale from one device to another', async () => {
    const milk = await sellOneMilk(a);
    expect(await syncOnce(a, server)).toEqual({ pushed: 3, pulled: 3 });
    expect(await syncOnce(b, server)).toEqual({ pushed: 0, pulled: 3 });
    expect((await findProductByBarcode(b, 'B1'))?.id).toBe(milk.id);
    expect(await stockOf(b, milk.id)).toBe(-1000);
    expect((await recentSales(b)).map((s) => s.receiptNo)).toEqual(['K1-20261029-0001']);
  });

  it('keeps the outbox when a push fails', async () => {
    await sellOneMilk(a);
    server.failNextPush();
    await expect(syncOnce(a, server)).rejects.toThrow('network down');
    expect(await pendingCount(a)).toBe(3);
    await syncOnce(a, server);
    expect(await pendingCount(a)).toBe(0);
  });

  it('pages through large pushes and pulls', async () => {
    for (const code of ['B1', 'B2', 'B3', 'B4', 'B5']) {
      await createProduct(a, { barcode: code, name: code, sellPrice: 100, vatRate: 1 }, at);
    }
    expect(await syncOnce(a, server, { batchSize: 2, overlap: 0 })).toEqual({
      pushed: 5,
      pulled: 5,
    });
    expect(await syncOnce(b, server, { batchSize: 2, overlap: 0 })).toEqual({
      pushed: 0,
      pulled: 5,
    });
    expect(await b.products.count()).toBe(5);
  });

  it('re-reads an overlap window without duplicating events', async () => {
    const milk = await sellOneMilk(a);
    await syncOnce(a, server);
    await syncOnce(b, server);
    expect(await syncOnce(b, server, { overlap: 10 })).toEqual({ pushed: 0, pulled: 3 });
    expect(await stockOf(b, milk.id)).toBe(-1000);
    expect(await b.sales.count()).toBe(1);
  });
});
