import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import type { MarketDb } from './db';
import { expiringLots } from './expiry';
import { createProduct, deleteProduct } from './products';
import { recordPurchase } from './purchases';
import { adjustStock } from './stock';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const day = (date: string) => new Date(`${date}T09:00:00Z`);

async function receive(
  productId: string,
  qtyMilli: number,
  expiresOn: string | undefined,
  at: Date,
) {
  return recordPurchase(
    db,
    { deviceCode: 'K1', lines: [{ productId, qtyMilli, ...(expiresOn ? { expiresOn } : {}) }] },
    at,
  );
}

describe('recordPurchase with an expiry date', () => {
  it('keeps the date on the line, and refuses one that is not a date', async () => {
    const milk = await createProduct(
      db,
      { name: 'Süt', sellPrice: 4250, vatRate: 1 },
      day('2026-11-01'),
    );
    const purchase = await receive(milk.id, 12000, '2026-11-20', day('2026-11-01'));
    expect(purchase.lines[0]?.expiresOn).toBe('2026-11-20');
    await expect(receive(milk.id, 1000, '20.11.2026', day('2026-11-01'))).rejects.toThrow(
      RangeError,
    );
  });
});

describe('expiringLots', () => {
  it('lists what is still on the shelf and runs out within 30 days, the soonest first', async () => {
    const milk = await createProduct(
      db,
      { name: 'Süt', sellPrice: 4250, vatRate: 1 },
      day('2026-11-01'),
    );
    const yogurt = await createProduct(
      db,
      { name: 'Yoğurt', sellPrice: 9000, vatRate: 1 },
      day('2026-11-01'),
    );
    await receive(milk.id, 12000, '2026-11-12', day('2026-11-01'));
    await receive(milk.id, 12000, '2026-11-25', day('2026-11-05'));
    await receive(yogurt.id, 6000, '2026-11-08', day('2026-11-02'));
    // Far off: not listed.
    await receive(yogurt.id, 6000, '2027-03-01', day('2026-11-06'));

    const lots = await expiringLots(db, '2026-11-09');
    expect(
      lots.map(({ name, expiresOn, remainingMilli, daysLeft }) => ({
        name,
        expiresOn,
        remainingMilli,
        daysLeft,
      })),
    ).toEqual([
      { name: 'Yoğurt', expiresOn: '2026-11-08', remainingMilli: 6000, daysLeft: -1 },
      { name: 'Süt', expiresOn: '2026-11-12', remainingMilli: 12000, daysLeft: 3 },
      { name: 'Süt', expiresOn: '2026-11-25', remainingMilli: 12000, daysLeft: 16 },
    ]);
  });

  it('counts the oldest delivery as sold first', async () => {
    const milk = await createProduct(
      db,
      { name: 'Süt', sellPrice: 4250, vatRate: 1 },
      day('2026-11-01'),
    );
    await receive(milk.id, 12000, '2026-11-12', day('2026-11-01'));
    await receive(milk.id, 12000, '2026-11-25', day('2026-11-05'));
    // 15 sold or thrown away: the first delivery is gone, 9 of the second remain.
    await adjustStock(
      db,
      { productId: milk.id, deltaMilli: -15000, reason: 'waste' },
      day('2026-11-08'),
    );

    const lots = await expiringLots(db, '2026-11-09');
    expect(lots.map(({ expiresOn, remainingMilli }) => ({ expiresOn, remainingMilli }))).toEqual([
      { expiresOn: '2026-11-25', remainingMilli: 9000 },
    ]);
  });

  it('leaves out deliveries with no date and deleted products', async () => {
    const milk = await createProduct(
      db,
      { name: 'Süt', sellPrice: 4250, vatRate: 1 },
      day('2026-11-01'),
    );
    const gone = await createProduct(
      db,
      { name: 'Ayran', sellPrice: 1500, vatRate: 1 },
      day('2026-11-01'),
    );
    await receive(milk.id, 12000, undefined, day('2026-11-01'));
    await receive(gone.id, 6000, '2026-11-10', day('2026-11-01'));
    await deleteProduct(db, gone.id, day('2026-11-02'));
    expect(await expiringLots(db, '2026-11-09')).toEqual([]);
  });
});
