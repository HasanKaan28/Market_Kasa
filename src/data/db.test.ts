import Dexie from 'dexie';
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

  it('declares the data and sync tables', async () => {
    db = openMarketDb('tables-check');
    await db.open();
    expect(db.tables.map((t) => t.name).sort()).toEqual([
      'categories',
      'customers',
      'ledger',
      'meta',
      'outbox',
      'products',
      'purchases',
      'returns',
      'saleVoids',
      'sales',
      'stockCounts',
      'stockLevels',
      'stockMovements',
      'supplierLedger',
      'suppliers',
    ]);
  });

  it('indexes movements by product and time', () => {
    db = openMarketDb('movement-index-check');
    expect(db.stockMovements.schema.indexes.map((index) => index.name)).toContain(
      '[productId+occurredAt]',
    );
  });

  it('does not index booleans', () => {
    db = openMarketDb('index-check');
    expect(db.products.schema.indexes.map((index) => index.name)).not.toContain('isQuick');
  });

  it('rejects market ids that are not slug-safe', () =>
    expect(() => openMarketDb('Kurşunlu Market')).toThrow(RangeError));

  it('upper-cases stored barcodes when it opens, keeping the oldest holder', async () => {
    const old = new Dexie('mk2-barcode-case');
    old.version(4).stores({
      products: 'id, &barcode, name, updatedAt',
      customers: 'id, name, phone, updatedAt',
      sales: 'id, receiptNo, [deviceCode+businessDate+seq], occurredAt, customerId',
      stockMovements: 'id, productId',
      stockLevels: 'productId',
      ledger: 'id, customerId',
      outbox: '++seq',
      meta: 'key',
      saleVoids: 'id, saleId',
      returns: 'id, saleId',
    });
    const product = (id: string, barcode: string, createdAt: string) => ({
      id,
      barcode,
      name: id,
      unit: 'piece',
      sellPrice: 100,
      buyPrice: 0,
      vatRate: 1,
      isQuick: false,
      criticalLevelMilli: 0,
      createdAt,
      updatedAt: createdAt,
    });
    // Added newest first, so the oldest holder wins by date, not by the order of the rows.
    await old
      .table('products')
      .bulkAdd([
        product('newer', 'ABC', '2026-02-01T00:00:00.000Z'),
        product('older', 'abc', '2026-01-01T00:00:00.000Z'),
        product('dashed', 'x-1', '2026-03-01T00:00:00.000Z'),
      ]);
    old.close();

    db = openMarketDb('barcode-case');
    expect((await db.products.get('older'))?.barcode).toBe('ABC');
    expect((await db.products.get('newer'))?.barcode).toBeUndefined();
    expect((await db.products.get('dashed'))?.barcode).toBe('X-1');
  });
});
