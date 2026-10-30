import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import type { MarketDb } from './db';
import { pendingOps } from './outbox';
import { createProduct } from './products';
import { adjustStock, listMovements, recomputeStock, recordStockMovement, stockOf } from './stock';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const at = new Date('2026-10-29T09:00:00Z');

describe('stock', () => {
  it('keeps the cached level equal to the sum of movements', async () => {
    await recordStockMovement(db, { productId: 'p1', delta: 50000, kind: 'count', at });
    await recordStockMovement(db, { productId: 'p1', delta: -2000, kind: 'sale', refId: 's1', at });
    expect(await stockOf(db, 'p1')).toBe(48000);
    expect(await recomputeStock(db, 'p1')).toBe(48000);
  });

  it('reports zero for a product without movements', async () =>
    expect(await stockOf(db, 'unknown')).toBe(0));

  it('queues each movement as an insert with its business day', async () => {
    const m = await recordStockMovement(db, {
      productId: 'p1',
      delta: -1000,
      kind: 'sale',
      at: new Date('2026-10-28T21:30:00Z'),
    });
    expect(m.businessDate).toBe('2026-10-29');
    expect((await pendingOps(db))[0]).toMatchObject({
      kind: 'insert',
      table: 'stockMovements',
      recordId: m.id,
    });
  });

  it('rejects zero and fractional deltas', async () => {
    await expect(
      recordStockMovement(db, { productId: 'p1', delta: 0, kind: 'manual', at }),
    ).rejects.toThrow(RangeError);
    await expect(
      recordStockMovement(db, { productId: 'p1', delta: 0.5, kind: 'manual', at }),
    ).rejects.toThrow(RangeError);
  });

  it('adjusts stock by a signed difference with its reason', async () => {
    const product = await createProduct(db, { name: 'Bardak', sellPrice: 500, vatRate: 20 }, at);
    await recordStockMovement(db, { productId: product.id, delta: 10000, kind: 'count', at });
    const movement = await adjustStock(
      db,
      { productId: product.id, deltaMilli: -2000, reason: 'waste', note: ' kırık ' },
      at,
    );
    expect(movement).toMatchObject({ kind: 'manual', delta: -2000, note: 'Fire: kırık' });
    expect(await stockOf(db, product.id)).toBe(8000);
    await expect(
      adjustStock(db, { productId: product.id, deltaMilli: 500, reason: 'found' }, at),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it('takes a fraction for a piece product only to make its stock whole', async () => {
    const product = await createProduct(db, { name: 'Bardak', sellPrice: 500, vatRate: 20 }, at);
    // Two registers can leave it fractional: one sells 0,5 by weight, the other counts pieces.
    await recordStockMovement(db, { productId: product.id, delta: 1500, kind: 'count', at });
    await expect(
      adjustStock(db, { productId: product.id, deltaMilli: -300, reason: 'lost' }, at),
    ).rejects.toBeInstanceOf(RangeError);
    await adjustStock(db, { productId: product.id, deltaMilli: 500, reason: 'found' }, at);
    expect(await stockOf(db, product.id)).toBe(2000);
  });

  it('lists movements newest first with the stock after each', async () => {
    const product = await createProduct(db, { name: 'Bardak', sellPrice: 500, vatRate: 20 }, at);
    const t = (minute: number) => new Date(at.getTime() + minute * 60_000);
    await recordStockMovement(db, {
      productId: product.id,
      delta: 10000,
      kind: 'purchase',
      at: t(1),
    });
    await recordStockMovement(db, { productId: product.id, delta: -2000, kind: 'sale', at: t(2) });
    await adjustStock(db, { productId: product.id, deltaMilli: -9000, reason: 'lost' }, t(3));
    const rows = await listMovements(db, product.id);
    expect(rows.map((row) => [row.movement.delta, row.balanceMilli])).toEqual([
      [-9000, -1000],
      [-2000, 8000],
      [10000, 10000],
    ]);
  });

  it('reads only the newest movements of one product', async () => {
    const cups = await createProduct(db, { name: 'Bardak', sellPrice: 500, vatRate: 20 }, at);
    const tea = await createProduct(db, { name: 'Çay', sellPrice: 9000, vatRate: 1 }, at);
    const t = (minute: number) => new Date(at.getTime() + minute * 60_000);
    for (const [n, delta] of [1000, 2000, 3000].entries()) {
      await recordStockMovement(db, { productId: cups.id, delta, kind: 'count', at: t(n) });
      await recordStockMovement(db, { productId: tea.id, delta: 500, kind: 'count', at: t(n) });
    }
    const rows = await listMovements(db, cups.id, 2);
    expect(rows.map(({ movement, balanceMilli }) => [movement.delta, balanceMilli])).toEqual([
      [3000, 6000],
      [2000, 3000],
    ]);
  });

  it('dates an adjustment by the business day cutoff', async () => {
    const cups = await createProduct(db, { name: 'Bardak', sellPrice: 500, vatRate: 20 }, at);
    const movement = await adjustStock(
      db,
      { productId: cups.id, deltaMilli: 1000, reason: 'found', cutoffMinutes: 240 },
      new Date('2026-10-29T00:30:00Z'),
    );
    expect(movement.businessDate).toBe('2026-10-28');
  });
});
