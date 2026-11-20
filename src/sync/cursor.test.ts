import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { MarketDb, openMarketDb } from '@/data/db';
import { getPullCursor, setPullCursor } from './cursor';

const opened: Dexie[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) {
    await db.delete();
  }
});

describe('pull cursor', () => {
  it('starts at zero and remembers its value', async () => {
    const db = openMarketDb(`test-${crypto.randomUUID()}`);
    opened.push(db);
    expect(await getPullCursor(db)).toBe(0);
    await setPullCursor(db, 42);
    expect(await getPullCursor(db)).toBe(42);
    await expect(setPullCursor(db, -1)).rejects.toThrow(RangeError);
  });

  it('upgrades a version 1 database without losing rows', async () => {
    const name = `mk2-test-${crypto.randomUUID()}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({
      products: 'id, &barcode, name, isQuick, updatedAt',
      customers: 'id, name, phone, updatedAt',
      sales: 'id, &receiptNo, [deviceCode+businessDate+seq], occurredAt, customerId',
      stockMovements: 'id, productId',
      stockLevels: 'productId',
      ledger: 'id, customerId',
      outbox: '++seq',
    });
    await v1.table('products').add({ id: 'p1', name: 'Süt' });
    v1.close();
    const db = new MarketDb(name);
    opened.push(db);
    expect(await db.products.get('p1')).toMatchObject({ name: 'Süt' });
    expect(await getPullCursor(db)).toBe(0);
  });
});
