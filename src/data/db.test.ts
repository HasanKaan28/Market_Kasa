import { afterEach, describe, expect, it } from 'vitest';
import { openMarketDb, type MarketDb } from './db';

let db: MarketDb | undefined;
afterEach(async () => {
  await db?.delete();
  db = undefined;
});

describe('openMarketDb', () => {
  it('names the database per market, apart from v1', () => {
    db = openMarketDb('kursunlu-market');
    expect(db.name).toBe('mk2-kursunlu-market');
    expect(db.name).not.toBe('MarketPosDB');
  });

  it('declares the M1a tables', async () => {
    db = openMarketDb('tables-check');
    await db.open();
    expect(db.tables.map((t) => t.name).sort()).toEqual([
      'customers',
      'ledger',
      'outbox',
      'products',
      'sales',
      'stockLevels',
      'stockMovements',
    ]);
  });

  it('rejects market ids that are not slug-safe', () =>
    expect(() => openMarketDb('Kurşunlu Market')).toThrow(RangeError));
});
