import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VatRate } from '@/domain/pricing';
import { makeTestDb } from '@/test/db';
import type { MarketDb } from './db';
import { DuplicateBarcodeError, RecordNotFoundError } from './errors';
import { pendingOps } from './outbox';
import {
  createProduct,
  deleteProduct,
  findProductByBarcode,
  listProductsInCategory,
  listQuickProducts,
  restoreProduct,
  searchProducts,
  updateProduct,
} from './products';
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

  it('stores barcodes in upper case and finds them in any case', async () => {
    const pen = await createProduct(
      db,
      { barcode: 'brk-0042', name: 'Kalem', sellPrice: 1500, vatRate: 20 },
      at,
    );
    expect(pen.barcode).toBe('BRK-0042');
    expect((await findProductByBarcode(db, ' brk-0042 '))?.id).toBe(pen.id);
    expect(await findProductByBarcode(db, 'brk 42')).toBeUndefined();
  });

  it("lists a category's live products by name", async () => {
    const inBakery = { sellPrice: 2000, vatRate: 1, categoryId: 'c-bakery' } as const;
    await createProduct(db, { ...inBakery, name: 'Poğaça' }, at);
    await createProduct(db, { ...inBakery, name: 'Açma' }, at);
    const gone = await createProduct(db, { ...inBakery, name: 'Eski' }, at);
    await deleteProduct(db, gone.id, at);
    await createProduct(db, { name: 'Süt', sellPrice: 4250, vatRate: 1, categoryId: 'c-milk' }, at);
    expect((await listProductsInCategory(db, 'c-bakery')).map((p) => p.name)).toEqual([
      'Açma',
      'Poğaça',
    ]);
  });

  it('finds a deleted product by its barcode only when asked', async () => {
    const old = await createProduct(
      db,
      { barcode: '8690000000031', name: 'Eski Gazoz', sellPrice: 1000, vatRate: 1 },
      at,
    );
    await deleteProduct(db, old.id, at);
    expect(await findProductByBarcode(db, '8690000000031')).toBeUndefined();
    expect((await findProductByBarcode(db, '8690000000031', { includeDeleted: true }))?.id).toBe(
      old.id,
    );
  });

  it('takes a barcode off a deleted product', async () => {
    const old = await createProduct(
      db,
      { barcode: '869', name: 'Eski Süt', sellPrice: 4000, vatRate: 1 },
      at,
    );
    await deleteProduct(db, old.id, at);
    const milk = await createProduct(
      db,
      { barcode: '869', name: 'Süt', sellPrice: 4250, vatRate: 1 },
      later,
    );
    expect(milk.barcode).toBe('869');
    expect((await db.products.get(old.id))?.barcode).toBeUndefined();
    const oldOps = (await pendingOps(db)).filter((op) => op.recordId === old.id);
    expect(oldOps.at(-1)).toMatchObject({
      kind: 'patch',
      patch: { barcode: null, updatedAt: later.toISOString() },
    });

    const gone = await createProduct(
      db,
      { barcode: '870', name: 'Eski Ayran', sellPrice: 2000, vatRate: 1 },
      at,
    );
    await deleteProduct(db, gone.id, at);
    const ayran = await createProduct(db, { name: 'Ayran', sellPrice: 2250, vatRate: 1 }, at);
    expect((await updateProduct(db, ayran.id, { barcode: '870' }, later)).barcode).toBe('870');
    expect((await db.products.get(gone.id))?.barcode).toBeUndefined();
  });

  it('refuses a barcode a live product holds, on create and on update', async () => {
    await createProduct(
      db,
      { barcode: '8690000000017', name: 'Süt', sellPrice: 4250, vatRate: 1 },
      at,
    );
    const ayran = await createProduct(db, { name: 'Ayran', sellPrice: 2250, vatRate: 1 }, at);
    const kefir = createProduct(
      db,
      { barcode: '8690000000017', name: 'Kefir', sellPrice: 3000, vatRate: 1 },
      at,
    );
    await expect(kefir).rejects.toBeInstanceOf(DuplicateBarcodeError);
    await expect(kefir).rejects.toMatchObject({ holderName: 'Süt' });
    const update = updateProduct(db, ayran.id, { barcode: '8690000000017' }, later);
    await expect(update).rejects.toBeInstanceOf(DuplicateBarcodeError);
    await expect(update).rejects.toMatchObject({ holderName: 'Süt' });
    expect((await db.products.get(ayran.id))?.barcode).toBeUndefined();
  });

  it('restores a deleted product', async () => {
    const simit = await createProduct(db, { name: 'Simit', sellPrice: 1500, vatRate: 1 }, at);
    await deleteProduct(db, simit.id, at);
    const restored = await restoreProduct(db, simit.id, later);
    expect(restored.deletedAt).toBeUndefined();
    expect(restored.updatedAt).toBe(later.toISOString());
    expect((await db.products.get(simit.id))?.deletedAt).toBeUndefined();
    const ops = await pendingOps(db);
    expect(ops.at(-1)).toMatchObject({
      kind: 'patch',
      recordId: simit.id,
      patch: { deletedAt: null, updatedAt: later.toISOString() },
    });
    await restoreProduct(db, simit.id, later);
    expect(await pendingOps(db)).toHaveLength(ops.length);
    await expect(restoreProduct(db, 'missing', later)).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  it('refuses fractions for a piece product', async () => {
    const pen = { name: 'Kalem', sellPrice: 1500, vatRate: 20 } as const;
    await expect(createProduct(db, pen, at, { openingStockMilli: 1500 })).rejects.toBeInstanceOf(
      RangeError,
    );
    await expect(
      createProduct(db, { ...pen, criticalLevelMilli: 1500 }, at),
    ).rejects.toBeInstanceOf(RangeError);
    const cheese = await createProduct(
      db,
      { name: 'Peynir', unit: 'kg', sellPrice: 30000, vatRate: 1, criticalLevelMilli: 1500 },
      at,
    );
    await expect(updateProduct(db, cheese.id, { unit: 'piece' }, later)).rejects.toBeInstanceOf(
      RangeError,
    );
    expect((await db.products.get(cheese.id))?.unit).toBe('kg');
    expect(await db.products.count()).toBe(1);
  });

  it('records opening stock as a count movement', async () => {
    const cheese = await createProduct(
      db,
      { name: 'Peynir', unit: 'kg', sellPrice: 30000, vatRate: 1 },
      at,
      { openingStockMilli: 1500 },
    );
    expect(await stockOf(db, cheese.id)).toBe(1500);
    expect(await db.stockMovements.where('productId').equals(cheese.id).toArray()).toMatchObject([
      { kind: 'count', delta: 1500 },
    ]);
    expect((await pendingOps(db)).map((op) => op.table)).toEqual(['products', 'stockMovements']);
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

  it('rejects a price above ₺1.000.000', async () => {
    await expect(
      createProduct(db, { name: 'X', sellPrice: 100_000_001, vatRate: 1 }, at),
    ).rejects.toThrow(RangeError);
    const p = await createProduct(db, { name: 'Y', sellPrice: 100_000_000, vatRate: 1 }, at);
    await expect(updateProduct(db, p.id, { sellPrice: 8690000000017 }, later)).rejects.toThrow(
      RangeError,
    );
  });
});
