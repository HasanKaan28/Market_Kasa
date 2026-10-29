import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_UNIT_PRICE } from '@/domain/pricing';
import { makeTestDb } from '@/test/db';
import type { MarketDb } from './db';
import { RecordNotFoundError } from './errors';
import { pendingOps } from './outbox';
import { createProduct, deleteProduct } from './products';
import { recordPurchase } from './purchases';
import { stockOf } from './stock';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const at = new Date('2026-10-29T09:00:00Z');
const later = new Date('2026-10-29T10:00:00Z');

describe('recordPurchase', () => {
  it('records a goods receipt all or nothing', async () => {
    const milk = await createProduct(
      db,
      { name: 'Süt', sellPrice: 4250, buyPrice: 3000, vatRate: 1 },
      at,
    );
    const gone = await createProduct(db, { name: 'Gazoz', sellPrice: 1000, vatRate: 1 }, at);
    await deleteProduct(db, gone.id, at);
    const before = (await pendingOps(db)).length;
    await expect(
      recordPurchase(
        db,
        {
          deviceCode: 'K1',
          lines: [
            { productId: milk.id, qtyMilli: 12000, sellPrice: 4500 },
            { productId: gone.id, qtyMilli: 6000 },
          ],
        },
        later,
      ),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    expect(await db.purchases.count()).toBe(0);
    expect(await stockOf(db, milk.id)).toBe(0);
    expect((await db.products.get(milk.id))?.sellPrice).toBe(4250);
    expect(await pendingOps(db)).toHaveLength(before);
  });

  it('updates only the prices that change', async () => {
    const milk = await createProduct(
      db,
      { name: 'Süt', sellPrice: 4250, buyPrice: 3000, vatRate: 1 },
      at,
    );
    const cheese = await createProduct(
      db,
      { name: 'Peynir', unit: 'kg', sellPrice: 32000, buyPrice: 20000, vatRate: 1 },
      at,
    );
    const before = (await pendingOps(db)).length;
    const purchase = await recordPurchase(
      db,
      {
        deviceCode: 'K1',
        lines: [
          { productId: milk.id, qtyMilli: 12000, buyPrice: 3000, sellPrice: 4500 },
          { productId: cheese.id, qtyMilli: 2500 },
        ],
        note: ' İrsaliye 1234 ',
      },
      later,
    );
    expect(purchase).toMatchObject({
      deviceCode: 'K1',
      note: 'İrsaliye 1234',
      total: 86000,
      lines: [
        {
          productId: milk.id,
          name: 'Süt',
          unit: 'piece',
          qtyMilli: 12000,
          buyPrice: 3000,
          cost: 36000,
        },
        {
          productId: cheese.id,
          name: 'Peynir',
          unit: 'kg',
          qtyMilli: 2500,
          buyPrice: 20000,
          cost: 50000,
        },
      ],
    });
    expect(await db.products.get(milk.id)).toMatchObject({ buyPrice: 3000, sellPrice: 4500 });
    expect(await stockOf(db, milk.id)).toBe(12000);
    expect(await stockOf(db, cheese.id)).toBe(2500);
    const movements = await db.stockMovements.toArray();
    expect(movements.map((m) => [m.kind, m.refId])).toEqual([
      ['purchase', purchase.id],
      ['purchase', purchase.id],
    ]);
    // The receipt is queued before what refers to it; only the one changed price is patched.
    expect((await pendingOps(db)).slice(before).map((op) => op.table)).toEqual([
      'purchases',
      'products',
      'stockMovements',
      'stockMovements',
    ]);
  });

  it('refuses fractions for a piece product', async () => {
    const pen = await createProduct(db, { name: 'Kalem', sellPrice: 1500, vatRate: 20 }, at);
    await expect(
      recordPurchase(db, { deviceCode: 'K1', lines: [{ productId: pen.id, qtyMilli: 1500 }] }, at),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      recordPurchase(db, { deviceCode: 'K1', lines: [{ productId: pen.id, qtyMilli: 0 }] }, at),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(recordPurchase(db, { deviceCode: 'K1', lines: [] }, at)).rejects.toBeInstanceOf(
      RangeError,
    );
  });

  it('refuses a price above the limit', async () => {
    const pen = await createProduct(db, { name: 'Kalem', sellPrice: 1500, vatRate: 20 }, at);
    await expect(
      recordPurchase(
        db,
        {
          deviceCode: 'K1',
          lines: [{ productId: pen.id, qtyMilli: 1000, buyPrice: MAX_UNIT_PRICE + 1 }],
        },
        at,
      ),
    ).rejects.toBeInstanceOf(RangeError);
    expect(await db.purchases.count()).toBe(0);
  });
});
