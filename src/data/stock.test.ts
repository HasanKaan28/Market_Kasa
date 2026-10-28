import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import type { MarketDb } from './db';
import { pendingOps } from './outbox';
import { recomputeStock, recordStockMovement, stockOf } from './stock';

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
});
