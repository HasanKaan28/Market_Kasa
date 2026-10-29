import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VatRate } from '@/domain/pricing';
import { makeTestDb } from '@/test/db';
import type { MarketDb } from './db';
import { DuplicateBarcodeError } from './errors';
import { pendingOps } from './outbox';
import {
  createProduct,
  deleteProduct,
  findProductByBarcode,
  listQuickProducts,
  searchProducts,
  updateProduct,
} from './products';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const at = new Date('2026-10-29T09:00:00Z');
const later = new Date('2026-10-29T10:00:00Z');

describe('products', () => {
  it('creates a product with defaults and queues it', async () => {
    const p = await createProduct(
      db,
      { barcode: ' 8690000000017 ', name: '  Süt ', sellPrice: 4250, vatRate: 1 },
      at,
    );
    expect(p).toMatchObject({
      barcode: '8690000000017',
      name: 'Süt',
      unit: 'piece',
      buyPrice: 0,
      isQuick: false,
      criticalLevelMilli: 0,
      createdAt: '2026-10-29T09:00:00.000Z',
      updatedAt: '2026-10-29T09:00:00.000Z',
    });
    const ops = await pendingOps(db);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: 'insert', table: 'products', recordId: p.id, record: p });
  });

  it('refuses a barcode that another product holds, even a deleted one', async () => {
    const p = await createProduct(
      db,
      { barcode: '8690000000017', name: 'Süt', sellPrice: 4250, vatRate: 1 },
      at,
    );
    const ayran = { barcode: '8690000000017', name: 'Ayran', sellPrice: 2250, vatRate: 1 } as const;
    await expect(createProduct(db, ayran, at)).rejects.toBeInstanceOf(DuplicateBarcodeError);
    await deleteProduct(db, p.id, later);
    await expect(createProduct(db, ayran, at)).rejects.toBeInstanceOf(DuplicateBarcodeError);
  });

  it('patches only the changed fields', async () => {
    const p = await createProduct(db, { name: 'Simit', sellPrice: 1750, vatRate: 1 }, at);
    const updated = await updateProduct(db, p.id, { sellPrice: 2000 }, later);
    expect(updated).toMatchObject({ sellPrice: 2000, updatedAt: '2026-10-29T10:00:00.000Z' });
    const last = (await pendingOps(db)).at(-1);
    expect(last).toMatchObject({ kind: 'patch', table: 'products', recordId: p.id });
    expect(last && 'patch' in last ? last.patch : undefined).toEqual({
      sellPrice: 2000,
      updatedAt: '2026-10-29T10:00:00.000Z',
    });
  });

  it('soft-deletes and hides deleted products', async () => {
    const p = await createProduct(
      db,
      { barcode: '8690000000024', name: 'Siyah Çay', sellPrice: 27900, vatRate: 1 },
      at,
    );
    await deleteProduct(db, p.id, later);
    expect(await findProductByBarcode(db, '8690000000024')).toBeUndefined();
    expect(await searchProducts(db, 'çay')).toEqual([]);
    expect((await pendingOps(db)).at(-1)).toMatchObject({
      kind: 'patch',
      patch: { deletedAt: '2026-10-29T10:00:00.000Z', updatedAt: '2026-10-29T10:00:00.000Z' },
    });
  });

  it('searches names the Turkish way and barcodes by prefix', async () => {
    await createProduct(
      db,
      { barcode: '8690000000017', name: 'Süt', sellPrice: 4250, vatRate: 1 },
      at,
    );
    await createProduct(
      db,
      { barcode: '8690000000024', name: 'Siyah Çay', sellPrice: 27900, vatRate: 1 },
      at,
    );
    await createProduct(db, { name: 'Simit', sellPrice: 1750, vatRate: 1 }, at);
    expect((await searchProducts(db, 'ç')).map((p) => p.name)).toEqual(['Siyah Çay']);
    expect((await searchProducts(db, 'SİMİT')).map((p) => p.name)).toEqual(['Simit']);
    expect((await searchProducts(db, '869')).map((p) => p.name)).toEqual(['Siyah Çay', 'Süt']);
  });

  it('keeps defaults when optional fields are passed as undefined', async () => {
    const p = await createProduct(
      db,
      { name: 'Simit', sellPrice: 1750, vatRate: 1, buyPrice: undefined, unit: undefined },
      at,
    );
    expect(p).toMatchObject({ unit: 'piece', buyPrice: 0, isQuick: false, criticalLevelMilli: 0 });
  });

  it('finds capitals written with a plain I and ignores Turkish letters', async () => {
    await createProduct(db, { name: 'LIPTON ICE TEA', sellPrice: 3500, vatRate: 20 }, at);
    await createProduct(db, { name: 'Siyah Çay', sellPrice: 27900, vatRate: 1 }, at);
    await createProduct(db, { name: 'Süt', sellPrice: 4250, vatRate: 1 }, at);
    expect((await searchProducts(db, 'lipton')).map((p) => p.name)).toEqual(['LIPTON ICE TEA']);
    expect((await searchProducts(db, 'ice')).map((p) => p.name)).toEqual(['LIPTON ICE TEA']);
    expect((await searchProducts(db, 'cay')).map((p) => p.name)).toEqual(['Siyah Çay']);
    expect((await searchProducts(db, 'sut')).map((p) => p.name)).toEqual(['Süt']);
  });

  it('rejects invalid prices and VAT rates', async () => {
    await expect(createProduct(db, { name: 'X', sellPrice: -1, vatRate: 1 }, at)).rejects.toThrow(
      RangeError,
    );
    await expect(createProduct(db, { name: 'X', sellPrice: 10.5, vatRate: 1 }, at)).rejects.toThrow(
      RangeError,
    );
    await expect(
      createProduct(db, { name: 'X', sellPrice: 100, vatRate: 18 as VatRate }, at),
    ).rejects.toThrow(RangeError);
    await expect(
      createProduct(db, { name: '   ', sellPrice: 100, vatRate: 1 }, at),
    ).rejects.toThrow(RangeError);
    await expect(
      createProduct(db, { barcode: 'abc def', name: 'X', sellPrice: 100, vatRate: 1 }, at),
    ).rejects.toThrow(RangeError);
    expect(await pendingOps(db)).toEqual([]);
  });

  it('lists quick products by name, without deleted ones', async () => {
    await createProduct(db, { name: 'Simit', sellPrice: 1500, vatRate: 1, isQuick: true }, at);
    const ayran = await createProduct(
      db,
      { name: 'Ayran', sellPrice: 2250, vatRate: 1, isQuick: true },
      at,
    );
    await createProduct(db, { name: 'Süt', sellPrice: 4250, vatRate: 1 }, at);
    await deleteProduct(db, ayran.id, later);
    expect((await listQuickProducts(db)).map((p) => p.name)).toEqual(['Simit']);
  });
});
