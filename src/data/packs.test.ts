import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import type { MarketDb } from './db';
import { DuplicateBarcodeError } from './errors';
import { createProduct, deleteProduct, findProductByCode, updateProduct } from './products';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const at = new Date('2026-11-10T09:00:00Z');
const water = {
  name: 'Su 0,5 L',
  barcode: '8690000000012',
  sellPrice: 1000,
  vatRate: 1,
} as const;

describe('pack barcodes', () => {
  it('finds a product by its own barcode as one, and by a pack barcode as the pack', async () => {
    const product = await createProduct(
      db,
      {
        ...water,
        packs: [
          { barcode: ' 8690000000029 ', qtyMilli: 12000 },
          { barcode: 'koli-24', qtyMilli: 24000 },
        ],
      },
      at,
    );
    expect(product.packs).toEqual([
      { barcode: '8690000000029', qtyMilli: 12000 },
      { barcode: 'KOLI-24', qtyMilli: 24000 },
    ]);
    expect(await findProductByCode(db, '8690000000012')).toEqual({ product });
    expect(await findProductByCode(db, '8690000000029')).toEqual({ product, qtyMilli: 12000 });
    expect(await findProductByCode(db, 'koli-24')).toEqual({ product, qtyMilli: 24000 });
    expect(await findProductByCode(db, '8690000000999')).toBeUndefined();
  });

  it('changes and clears the packs', async () => {
    const product = await createProduct(
      db,
      { ...water, packs: [{ barcode: '8690000000029', qtyMilli: 12000 }] },
      at,
    );
    await updateProduct(
      db,
      product.id,
      { packs: [{ barcode: '8690000000036', qtyMilli: 6000 }] },
      at,
    );
    expect(await findProductByCode(db, '8690000000029')).toBeUndefined();
    expect((await findProductByCode(db, '8690000000036'))?.qtyMilli).toBe(6000);
    await updateProduct(db, product.id, { packs: [] }, at);
    expect(await findProductByCode(db, '8690000000036')).toBeUndefined();
    expect((await db.products.get(product.id))?.packs).toBeUndefined();
  });

  it('keeps every barcode on one live product only', async () => {
    await createProduct(
      db,
      { ...water, packs: [{ barcode: '8690000000029', qtyMilli: 12000 }] },
      at,
    );
    // Another product's own barcode, or its pack, cannot be the same code.
    await expect(
      createProduct(
        db,
        { name: 'Ayran', barcode: '8690000000029', sellPrice: 1500, vatRate: 1 },
        at,
      ),
    ).rejects.toThrow(DuplicateBarcodeError);
    await expect(
      createProduct(
        db,
        {
          name: 'Ayran',
          sellPrice: 1500,
          vatRate: 1,
          packs: [{ barcode: '8690000000012', qtyMilli: 6000 }],
        },
        at,
      ),
    ).rejects.toThrow(DuplicateBarcodeError);
    // Nor twice on the same product.
    await expect(
      createProduct(
        db,
        {
          name: 'Kola',
          barcode: '8690000000043',
          sellPrice: 2000,
          vatRate: 1,
          packs: [{ barcode: '8690000000043', qtyMilli: 6000 }],
        },
        at,
      ),
    ).rejects.toThrow(RangeError);
  });

  it('lets a deleted product’s pack barcode go to a new one', async () => {
    const old = await createProduct(
      db,
      { ...water, packs: [{ barcode: '8690000000029', qtyMilli: 12000 }] },
      at,
    );
    await deleteProduct(db, old.id, at);
    const fresh = await createProduct(
      db,
      { name: 'Su 1 L', barcode: '8690000000029', sellPrice: 1500, vatRate: 1 },
      at,
    );
    expect(await findProductByCode(db, '8690000000029')).toEqual({ product: fresh });
  });

  it('takes whole pieces in a pack of a piece product, and a positive amount', async () => {
    for (const qtyMilli of [1500, 0, -1000]) {
      await expect(
        createProduct(db, { ...water, packs: [{ barcode: 'P1', qtyMilli }] }, at),
        String(qtyMilli),
      ).rejects.toThrow(RangeError);
    }
  });
});
