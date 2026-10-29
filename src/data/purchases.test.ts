import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_UNIT_PRICE } from '@/domain/pricing';
import { makeTestDb } from '@/test/db';
import type { MarketDb } from './db';
import { RecordNotFoundError } from './errors';
import { pendingOps } from './outbox';
import { createProduct, deleteProduct } from './products';
import { recordPurchase } from './purchases';
import { stockOf } from './stock';
import { archiveSupplier, createSupplier, supplierBalance } from './suppliers';

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
    const tea = await createProduct(
      db,
      { name: 'Çay', sellPrice: 9000, buyPrice: 7000, vatRate: 1 },
      at,
    );
    const before = (await pendingOps(db)).length;
    // The second line's movement is the last write; everything before it must go too.
    let movements = 0;
    db.stockMovements.hook('creating', () => {
      movements += 1;
      if (movements === 2) {
        throw new Error('disk full');
      }
    });
    await expect(
      recordPurchase(
        db,
        {
          deviceCode: 'K1',
          lines: [
            { productId: milk.id, qtyMilli: 12000, sellPrice: 4500 },
            { productId: tea.id, qtyMilli: 6000, buyPrice: 7500 },
          ],
        },
        later,
      ),
    ).rejects.toThrow('disk full');
    expect(movements).toBe(2);
    expect(await db.purchases.count()).toBe(0);
    expect(await db.stockMovements.count()).toBe(0);
    expect(await stockOf(db, milk.id)).toBe(0);
    expect(await db.products.get(milk.id)).toMatchObject({ sellPrice: 4250 });
    expect(await db.products.get(tea.id)).toMatchObject({ buyPrice: 7000 });
    expect(await pendingOps(db)).toHaveLength(before);
  });

  it('refuses a deleted product before writing anything', async () => {
    const milk = await createProduct(db, { name: 'Süt', sellPrice: 4250, vatRate: 1 }, at);
    const gone = await createProduct(db, { name: 'Gazoz', sellPrice: 1000, vatRate: 1 }, at);
    await deleteProduct(db, gone.id, at);
    await expect(
      recordPurchase(
        db,
        {
          deviceCode: 'K1',
          lines: [
            { productId: milk.id, qtyMilli: 12000 },
            { productId: gone.id, qtyMilli: 6000 },
          ],
        },
        later,
      ),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    expect(await db.purchases.count()).toBe(0);
    expect(await stockOf(db, milk.id)).toBe(0);
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

  it('writes an on-account receipt and its invoice all or nothing', async () => {
    const milk = await createProduct(
      db,
      { name: 'Süt', sellPrice: 4250, buyPrice: 3000, vatRate: 1 },
      at,
    );
    const supplier = await createSupplier(db, { name: 'Eti' }, at);
    const purchase = await recordPurchase(
      db,
      {
        deviceCode: 'K1',
        lines: [{ productId: milk.id, qtyMilli: 10000 }],
        supplierId: supplier.id,
        invoiceNo: ' F-77 ',
        payment: 'on_account',
      },
      later,
    );
    expect(purchase).toMatchObject({
      supplierId: supplier.id,
      invoiceNo: 'F-77',
      payment: 'on_account',
    });
    expect(await db.supplierLedger.toArray()).toMatchObject([
      { supplierId: supplier.id, kind: 'invoice', amount: 30000, purchaseId: purchase.id },
    ]);
    expect(await supplierBalance(db, supplier.id)).toBe(30000);

    // The invoice is the last write; when it fails, the receipt must not stay behind.
    db.supplierLedger.hook('creating', () => {
      throw new Error('disk full');
    });
    await expect(
      recordPurchase(
        db,
        {
          deviceCode: 'K1',
          lines: [{ productId: milk.id, qtyMilli: 1000 }],
          supplierId: supplier.id,
          payment: 'on_account',
        },
        later,
      ),
    ).rejects.toThrow('disk full');
    expect(await db.purchases.count()).toBe(1);
    expect(await stockOf(db, milk.id)).toBe(10000);
  });

  it('needs a live supplier for an on-account receipt', async () => {
    const milk = await createProduct(
      db,
      { name: 'Süt', sellPrice: 4250, buyPrice: 3000, vatRate: 1 },
      at,
    );
    const line = [{ productId: milk.id, qtyMilli: 1000 }];
    await expect(
      recordPurchase(db, { deviceCode: 'K1', lines: line, payment: 'on_account' }, later),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      recordPurchase(db, { deviceCode: 'K1', lines: line, supplierId: 'nobody' }, later),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    expect(await db.purchases.count()).toBe(0);
  });

  it('keeps a receipt without a supplier as before', async () => {
    const milk = await createProduct(
      db,
      { name: 'Süt', sellPrice: 4250, buyPrice: 3000, vatRate: 1 },
      at,
    );
    const purchase = await recordPurchase(
      db,
      { deviceCode: 'K1', lines: [{ productId: milk.id, qtyMilli: 1000 }] },
      later,
    );
    expect(purchase.payment).toBe('cash');
    expect(purchase).not.toHaveProperty('supplierId');
    expect(await db.supplierLedger.count()).toBe(0);
  });

  it('takes free goods into stock at no cost and keeps the buy price', async () => {
    const tea = await createProduct(
      db,
      { name: 'Çay', sellPrice: 9000, buyPrice: 7000, vatRate: 1 },
      at,
    );
    const purchase = await recordPurchase(
      db,
      { deviceCode: 'K1', lines: [{ productId: tea.id, qtyMilli: 6000, free: true }] },
      later,
    );
    expect(purchase).toMatchObject({ total: 0, lines: [{ free: true, buyPrice: 0, cost: 0 }] });
    expect(await stockOf(db, tea.id)).toBe(6000);
    expect((await db.products.get(tea.id))?.buyPrice).toBe(7000);
  });

  it('keeps the buy price for free goods and for a price typed as nothing', async () => {
    const tea = await createProduct(
      db,
      { name: 'Çay', sellPrice: 9000, buyPrice: 7000, vatRate: 1 },
      at,
    );
    const purchase = await recordPurchase(
      db,
      {
        deviceCode: 'K1',
        lines: [
          { productId: tea.id, qtyMilli: 1000, free: true, buyPrice: 5000 },
          { productId: tea.id, qtyMilli: 2000, buyPrice: 0 },
        ],
      },
      later,
    );
    expect(purchase.lines.map((line) => [line.free, line.cost])).toEqual([
      [true, 0],
      [true, 0],
    ]);
    expect((await db.products.get(tea.id))?.buyPrice).toBe(7000);
  });

  it('records a line at the cost it was given', async () => {
    const tea = await createProduct(db, { name: 'Çay', sellPrice: 1500, vatRate: 20 }, at);
    // 24 × 8,33 without VAT is 199,92; with %20 the invoice says 239,90.
    const purchase = await recordPurchase(
      db,
      {
        deviceCode: 'K1',
        lines: [{ productId: tea.id, qtyMilli: 24000, buyPrice: 1000, cost: 23990 }],
      },
      later,
    );
    expect(purchase).toMatchObject({ total: 23990, lines: [{ buyPrice: 1000, cost: 23990 }] });
    await expect(
      recordPurchase(
        db,
        { deviceCode: 'K1', lines: [{ productId: tea.id, qtyMilli: 1000, cost: -1 }] },
        later,
      ),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it('refuses an archived supplier and saves free goods on account without an invoice', async () => {
    const tea = await createProduct(
      db,
      { name: 'Çay', sellPrice: 1500, buyPrice: 1000, vatRate: 1 },
      at,
    );
    const gone = await createSupplier(db, { name: 'Pınar' }, at);
    await archiveSupplier(db, gone.id, at);
    await expect(
      recordPurchase(
        db,
        { deviceCode: 'K1', lines: [{ productId: tea.id, qtyMilli: 1000 }], supplierId: gone.id },
        later,
      ),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    const eti = await createSupplier(db, { name: 'Eti' }, at);
    const purchase = await recordPurchase(
      db,
      {
        deviceCode: 'K1',
        lines: [{ productId: tea.id, qtyMilli: 6000, free: true }],
        supplierId: eti.id,
        payment: 'on_account',
      },
      later,
    );
    expect(purchase.total).toBe(0);
    expect(await db.supplierLedger.count()).toBe(0);
  });
});
