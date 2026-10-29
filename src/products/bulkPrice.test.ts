import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MarketDb } from '@/data/db';
import { pendingOps } from '@/data/outbox';
import { createProduct } from '@/data/products';
import { MAX_UNIT_PRICE } from '@/domain/pricing';
import { makeTestDb } from '@/test/db';
import { bulkUpdatePrices, changedPrice, type PriceChange } from './bulkPrice';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const at = new Date('2026-10-29T09:00:00Z');
const tenPercent: PriceChange = { target: 'sellPrice', by: 'percent', value: 100, roundTo: 0 };

describe('changedPrice', () => {
  it('raises by a percentage and rounds half up to the step', () => {
    expect(changedPrice(4250, tenPercent)).toBe(4675);
    expect(changedPrice(4250, { ...tenPercent, roundTo: 25 })).toBe(4675);
    expect(changedPrice(4250, { ...tenPercent, roundTo: 50 })).toBe(4700);
    expect(changedPrice(4250, { ...tenPercent, roundTo: 100 })).toBe(4700);
    expect(changedPrice(1999, { ...tenPercent, value: -125 })).toBe(1749);
  });

  it('never goes below zero and refuses the limit', () => {
    expect(changedPrice(1000, { ...tenPercent, by: 'amount', value: -2000 })).toBe(0);
    expect(() => changedPrice(MAX_UNIT_PRICE, tenPercent)).toThrow(RangeError);
  });
});

describe('bulkUpdatePrices', () => {
  it('patches only products whose price changes, in one transaction', async () => {
    const milk = await createProduct(db, { name: 'Süt', sellPrice: 4250, vatRate: 1 }, at);
    const free = await createProduct(db, { name: 'Poşet', sellPrice: 0, vatRate: 20 }, at);
    const before = (await pendingOps(db)).length;
    expect(await bulkUpdatePrices(db, [milk.id, free.id], tenPercent, at)).toBe(1);
    expect((await db.products.get(milk.id))?.sellPrice).toBe(4675);
    expect(await pendingOps(db)).toHaveLength(before + 1);

    const gold = await createProduct(
      db,
      { name: 'Altın', sellPrice: MAX_UNIT_PRICE, vatRate: 1 },
      at,
    );
    await expect(bulkUpdatePrices(db, [milk.id, gold.id], tenPercent, at)).rejects.toBeInstanceOf(
      RangeError,
    );
    expect((await db.products.get(milk.id))?.sellPrice).toBe(4675);
  });

  it('leaves an unknown buy price alone', async () => {
    const tea = await createProduct(db, { name: 'Çay', sellPrice: 9000, vatRate: 1 }, at);
    const change: PriceChange = { target: 'buyPrice', by: 'amount', value: 500, roundTo: 0 };
    expect(await bulkUpdatePrices(db, [tea.id], change, at)).toBe(0);
    expect((await db.products.get(tea.id))?.buyPrice).toBe(0);
  });
});
