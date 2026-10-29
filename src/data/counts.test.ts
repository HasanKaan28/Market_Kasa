import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import { countsNeedingCheck, recordCount } from './counts';
import type { MarketDb } from './db';
import { RecordNotFoundError } from './errors';
import { pendingOps } from './outbox';
import { createProduct, deleteProduct } from './products';
import { recordStockMovement, stockOf } from './stock';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const minute = (n: number) => new Date(Date.UTC(2026, 9, 29, 9, n));

async function stocked(name: string, stockMilli: number, unit: 'piece' | 'kg' = 'piece') {
  return createProduct(db, { name, unit, sellPrice: 1000, vatRate: 1 }, minute(0), {
    openingStockMilli: stockMilli,
  });
}

describe('recordCount', () => {
  it('records a count all or nothing, moving only what differs', async () => {
    const tea = await stocked('Çay', 10000);
    const milk = await stocked('Süt', 5000);
    const before = (await pendingOps(db)).length;
    const count = await recordCount(
      db,
      {
        deviceCode: 'K1',
        lines: [
          { productId: tea.id, countedMilli: 8000 },
          { productId: milk.id, countedMilli: 5000 },
        ],
        note: ' Raf 3 ',
      },
      minute(5),
    );
    expect(count).toMatchObject({
      deviceCode: 'K1',
      note: 'Raf 3',
      lines: [
        { productId: tea.id, name: 'Çay', unit: 'piece', expectedMilli: 10000, countedMilli: 8000 },
        { productId: milk.id, name: 'Süt', unit: 'piece', expectedMilli: 5000, countedMilli: 5000 },
      ],
    });
    expect(await stockOf(db, tea.id)).toBe(8000);
    expect(await stockOf(db, milk.id)).toBe(5000);
    const moved = (await db.stockMovements.toArray()).filter((m) => m.refId === count.id);
    expect(moved.map((m) => [m.productId, m.kind, m.delta])).toEqual([[tea.id, 'count', -2000]]);
    expect((await pendingOps(db)).slice(before).map((op) => op.table)).toEqual([
      'stockCounts',
      'stockMovements',
    ]);

    // The second difference's movement is the last write; everything before it must go too.
    const counts = await db.stockCounts.count();
    const ops = (await pendingOps(db)).length;
    let movements = 0;
    db.stockMovements.hook('creating', () => {
      movements += 1;
      if (movements === 2) {
        throw new Error('disk full');
      }
    });
    await expect(
      recordCount(
        db,
        {
          deviceCode: 'K1',
          lines: [
            { productId: tea.id, countedMilli: 7000 },
            { productId: milk.id, countedMilli: 4000 },
          ],
        },
        minute(6),
      ),
    ).rejects.toThrow('disk full');
    expect(movements).toBe(2);
    expect(await db.stockCounts.count()).toBe(counts);
    expect(await stockOf(db, tea.id)).toBe(8000);
    expect(await pendingOps(db)).toHaveLength(ops);
  });

  it('refuses fractions and amounts below zero', async () => {
    const tea = await stocked('Çay', 10000);
    const cheese = await stocked('Peynir', 1500, 'kg');
    const gone = await stocked('Gazoz', 1000);
    await deleteProduct(db, gone.id, minute(1));
    const one = (productId: string, countedMilli: number) =>
      recordCount(db, { deviceCode: 'K1', lines: [{ productId, countedMilli }] }, minute(5));
    await expect(one(tea.id, 1500)).rejects.toBeInstanceOf(RangeError);
    await expect(one(tea.id, -1000)).rejects.toBeInstanceOf(RangeError);
    await expect(one(gone.id, 1000)).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(recordCount(db, { deviceCode: 'K1', lines: [] }, minute(5))).rejects.toBeInstanceOf(
      RangeError,
    );
    await expect(
      recordCount(
        db,
        {
          deviceCode: 'K1',
          lines: [
            { productId: tea.id, countedMilli: 1000 },
            { productId: tea.id, countedMilli: 2000 },
          ],
        },
        minute(5),
      ),
    ).rejects.toBeInstanceOf(RangeError);
    expect(await db.stockCounts.count()).toBe(0);
    await one(cheese.id, 1250);
    expect(await stockOf(db, cheese.id)).toBe(1250);
  });
});

describe('countsNeedingCheck', () => {
  it('flags a count that a late movement or a second count breaks', async () => {
    const tea = await stocked('Çay', 10000);
    const first = await recordCount(
      db,
      { deviceCode: 'K1', lines: [{ productId: tea.id, countedMilli: 10000 }] },
      minute(10),
    );
    expect(await countsNeedingCheck(db, minute(0))).toEqual([]);

    // A sale another register made before the count arrives after it.
    await recordStockMovement(db, { productId: tea.id, delta: -1000, kind: 'sale', at: minute(5) });
    expect(await countsNeedingCheck(db, minute(0))).toEqual([
      { count: first, line: first.lines[0], expectedNowMilli: 9000 },
    ]);

    // Counting the product again clears it.
    const second = await recordCount(
      db,
      { deviceCode: 'K1', lines: [{ productId: tea.id, countedMilli: 9000 }] },
      minute(20),
    );
    expect(await countsNeedingCheck(db, minute(0))).toEqual([]);

    // Another register counted the same product offline, before this device's count.
    const pulled = {
      id: 'count-k2',
      deviceCode: 'K2',
      lines: [
        { productId: tea.id, name: 'Çay', unit: 'piece', expectedMilli: 9000, countedMilli: 8000 },
      ],
      occurredAt: minute(15).toISOString(),
      businessDate: '2026-10-29',
    } as const;
    await db.stockCounts.add({ ...pulled, lines: [...pulled.lines] });
    await recordStockMovement(db, {
      productId: tea.id,
      delta: -1000,
      kind: 'count',
      refId: pulled.id,
      at: minute(15),
    });
    expect(await countsNeedingCheck(db, minute(0))).toEqual([
      { count: second, line: second.lines[0], expectedNowMilli: 8000 },
    ]);
    // Counts before `since` are not looked at.
    expect(await countsNeedingCheck(db, minute(30))).toEqual([]);
  });
});
