import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MarketDb } from '@/data/db';
import { createCustomer, customerBalance } from '@/data/customers';
import { pendingCount } from '@/data/outbox';
import { createProduct, findProductByBarcode, updateProduct } from '@/data/products';
import { recordReturn, returnedQuantities, saleStatus } from '@/data/returns';
import { recentSales, recordSale } from '@/data/sales';
import { stockOf } from '@/data/stock';
import { isVoided, voidSale } from '@/data/voids';
import { makeTestDb } from '@/test/db';
import { syncOnce } from './engine';
import { FakeServer } from './fakeServer';
import { parkedRows, rejectedOps } from './issues';
import type { SyncTransport } from './protocol';

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

  it('carries a void and a return to another device', async () => {
    const milk = await sellOneMilk(a);
    const second = await recordSale(a, {
      deviceCode: 'K1',
      at,
      lines: [{ productId: milk.id, qtyMilli: 2000 }],
      payments: [{ method: 'cash', amount: 8500 }],
    });
    const first = (await recentSales(a)).find((sale) => sale.id !== second.id);
    if (!first) throw new Error('first sale missing');
    await voidSale(a, { saleId: first.id, reason: 'Yanlış', deviceCode: 'K1', at });
    await recordReturn(a, {
      saleId: second.id,
      lines: [{ productId: milk.id, qtyMilli: 1000 }],
      deviceCode: 'K1',
      at,
    });
    await syncOnce(a, server);
    await syncOnce(b, server);
    expect(await isVoided(b, first.id)).toBe(true);
    expect((await returnedQuantities(b, second.id)).get(milk.id)).toBe(1000);
    expect(await stockOf(b, milk.id)).toBe(await stockOf(a, milk.id));
    expect(await parkedRows(b)).toEqual([]);
  });

  it('counts a sale voided on two devices once', async () => {
    const customer = await createCustomer(a, { name: 'Ahmet' }, at);
    const milk = await createProduct(
      a,
      { barcode: 'B1', name: 'Süt', sellPrice: 4250, vatRate: 1 },
      at,
    );
    const sale = await recordSale(a, {
      deviceCode: 'K1',
      at,
      customerId: customer.id,
      lines: [{ productId: milk.id, qtyMilli: 1000 }],
      payments: [{ method: 'credit', amount: 4250 }],
    });
    await syncOnce(a, server);
    await syncOnce(b, server);
    await voidSale(a, { saleId: sale.id, reason: 'Kasada', deviceCode: 'K1', at });
    await voidSale(b, { saleId: sale.id, reason: 'Arkada', deviceCode: 'K2', at });
    for (const db of [a, b, a]) await syncOnce(db, server);
    expect(server.rows('saleVoids')).toHaveLength(1);
    for (const db of [a, b]) {
      expect(await stockOf(db, milk.id)).toBe(0);
      expect(await customerBalance(db, customer.id)).toBe(0);
    }
  });

  it('flags a sale returned beyond what was sold across devices', async () => {
    const milk = await sellOneMilk(a);
    const [sale] = await recentSales(a);
    if (!sale) throw new Error('sale missing');
    await syncOnce(a, server);
    await syncOnce(b, server);
    for (const db of [a, b]) {
      await recordReturn(db, {
        saleId: sale.id,
        lines: [{ productId: milk.id, qtyMilli: 1000 }],
        deviceCode: 'K1',
        at,
      });
    }
    for (const db of [a, b, a]) await syncOnce(db, server);
    expect((await saleStatus(a, sale.id)).conflict).toBe(true);
    expect((await saleStatus(b, sale.id)).conflict).toBe(true);
  });

  it('still pulls when the push fails', async () => {
    await createProduct(b, { name: 'Ayran', sellPrice: 2250, vatRate: 1 }, at);
    await syncOnce(b, server);
    await sellOneMilk(a);
    server.failNextPush();
    await expect(syncOnce(a, server)).rejects.toThrow('network down');
    expect(await a.products.count()).toBe(2);
    expect(await pendingCount(a)).toBe(3);
  });

  it('drops a refused edit and takes the server row back', async () => {
    const milk = await createProduct(a, { name: 'Süt', sellPrice: 4250, vatRate: 1 }, at);
    await syncOnce(a, server);
    server.refuse((op) => (op.kind === 'patch' ? 'Fiyat değiştirme yetkisi yok' : undefined));
    await updateProduct(a, milk.id, { sellPrice: 1 }, at);
    await syncOnce(a, server, { overlap: 0 });
    expect(await pendingCount(a)).toBe(0);
    expect((await a.products.get(milk.id))?.sellPrice).toBe(4250);
    expect(await rejectedOps(a)).toEqual([
      expect.objectContaining({
        reason: 'Fiyat değiştirme yetkisi yok',
        op: expect.objectContaining({ table: 'products', recordId: milk.id }),
      }),
    ]);
  });

  it('gives a contested barcode back to its owner after an edit races a pull', async () => {
    const later = new Date('2026-10-29T10:00:00Z');
    const eski = await createProduct(b, { name: 'Eski', sellPrice: 1000, vatRate: 1 }, at);
    const yeni = await createProduct(b, { name: 'Yeni', sellPrice: 1000, vatRate: 1 }, later);
    await syncOnce(b, server);
    await syncOnce(a, server, { overlap: 0 });
    await updateProduct(b, eski.id, { barcode: 'N1' }, later);
    await updateProduct(b, yeni.id, { sellPrice: 1200 }, later);
    await syncOnce(b, server);
    // A's manager gives N1 to Yeni after A's push and before its pull.
    let edited = false;
    const racing: SyncTransport = {
      push: (request) => server.push(request),
      pull: async (request) => {
        if (!edited) {
          edited = true;
          await updateProduct(a, yeni.id, { barcode: 'N1' }, later);
        }
        return server.pull(request);
      },
    };
    await syncOnce(a, racing, { overlap: 0 });
    for (let round = 0; round < 2; round += 1) {
      await syncOnce(a, server, { overlap: 0 });
      await syncOnce(b, server, { overlap: 0 });
    }
    expect((await findProductByBarcode(a, 'N1'))?.id).toBe(eski.id);
    expect((await findProductByBarcode(b, 'N1'))?.id).toBe(eski.id);
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
