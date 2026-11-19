import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import type { Actor } from './audit';
import { openCashSession } from './cash';
import {
  correctPurchase,
  correctSupplierPayment,
  reversePurchase,
  reverseSupplierPayment,
  reversedPurchaseIds,
  reversedEntryIds,
} from './corrections';
import type { MarketDb } from './db';
import { AlreadyReversedError, RecordNotFoundError } from './errors';
import { expiringLots } from './expiry';
import { pendingOps } from './outbox';
import { createProduct, deleteProduct } from './products';
import { recordPurchase } from './purchases';
import { stockOf } from './stock';
import { addSupplierInvoice, recordSupplierPayment } from './supplierLedger';
import { createSupplier, supplierBalance } from './suppliers';

let db: MarketDb;
let milkId: string;
let teaId: string;
let supplierId: string;
const at = new Date('2026-11-10T09:00:00Z');
const later = new Date('2026-11-12T09:00:00Z');
const actor: Actor = { deviceCode: 'K2', staffId: 's1' };

beforeEach(async () => {
  db = makeTestDb();
  milkId = (
    await createProduct(db, { name: 'Süt', sellPrice: 4250, buyPrice: 3000, vatRate: 1 }, at)
  ).id;
  teaId = (
    await createProduct(db, { name: 'Çay', sellPrice: 9000, buyPrice: 7000, vatRate: 1 }, at)
  ).id;
  supplierId = (await createSupplier(db, { name: 'Eti' }, at)).id;
});
afterEach(async () => {
  await db.delete();
});

function receive(payment: 'cash' | 'card' | 'on_account', extra: { fromDrawer?: boolean } = {}) {
  return recordPurchase(
    db,
    {
      deviceCode: 'K1',
      supplierId,
      invoiceNo: 'F-77',
      payment,
      ...extra,
      lines: [
        { productId: milkId, qtyMilli: 12000, buyPrice: 3200, expiresOn: '2026-11-20' },
        { productId: teaId, qtyMilli: 6000 },
      ],
    },
    at,
  );
}

describe('reversePurchase', () => {
  it('takes the stock and the invoice back, and leaves the prices as they are', async () => {
    const purchase = await receive('on_account');
    expect(await supplierBalance(db, supplierId)).toBe(purchase.total);

    const record = await reversePurchase(
      db,
      { purchaseId: purchase.id, reason: 'Yanlış fatura' },
      later,
      actor,
    );

    expect(record).toMatchObject({
      purchaseId: purchase.id,
      reason: 'Yanlış fatura',
      deviceCode: 'K2',
      staffId: 's1',
      businessDate: '2026-11-12',
    });
    expect(await stockOf(db, milkId)).toBe(0);
    expect(await stockOf(db, teaId)).toBe(0);
    const movements = await db.stockMovements.where('productId').equals(milkId).toArray();
    expect(movements.map((movement) => [movement.kind, movement.delta])).toEqual(
      expect.arrayContaining([
        ['purchase', 12000],
        ['purchaseVoid', -12000],
      ]),
    );
    expect(await supplierBalance(db, supplierId)).toBe(0);
    const invoice = (await db.supplierLedger.toArray()).find((entry) => entry.kind === 'invoice');
    const counter = (await db.supplierLedger.toArray()).find((entry) => entry.amount < 0);
    expect(counter).toMatchObject({
      kind: 'adjustment',
      amount: -purchase.total,
      purchaseId: purchase.id,
      reversesId: invoice?.id,
    });
    // The receipt changed the milk's buy price; taking it back does not change it again.
    expect(await db.products.get(milkId)).toMatchObject({ buyPrice: 3200 });
    expect(await reversedPurchaseIds(db, [purchase.id])).toEqual(new Set([purchase.id]));
    const tables = (await pendingOps(db, 1000)).map((op) => op.table);
    expect(tables).toContain('purchaseVoids');
    expect(await db.auditLog.toArray()).toEqual([
      expect.objectContaining({
        action: 'purchase.reverse',
        entity: 'purchase',
        entityId: purchase.id,
        staffId: 's1',
      }),
    ]);
  });

  it('puts the cash back in the drawer when it was paid from it', async () => {
    await openCashSession(db, { deviceCode: 'K2', openingCash: 0 }, at);
    const purchase = await receive('cash');
    await reversePurchase(db, { purchaseId: purchase.id, reason: 'İade' }, later, actor);
    const back = (await db.cashMovements.toArray()).filter((movement) => movement.kind === 'in');
    expect(back).toEqual([expect.objectContaining({ amount: purchase.total, deviceCode: 'K2' })]);
    expect(back[0]?.reason).toContain('Eti');
  });

  it('moves no cash for a receipt paid by card or from outside the drawer', async () => {
    const card = await receive('card');
    const outside = await receive('cash', { fromDrawer: false });
    await reversePurchase(db, { purchaseId: card.id, reason: 'İade' }, later, actor);
    await reversePurchase(db, { purchaseId: outside.id, reason: 'İade' }, later, actor);
    expect(await db.cashMovements.count()).toBe(0);
    expect(await db.supplierLedger.count()).toBe(0);
  });

  it('reverses a receipt only once, and only with a reason', async () => {
    const purchase = await receive('on_account');
    await expect(
      reversePurchase(db, { purchaseId: purchase.id, reason: '  ' }, later, actor),
    ).rejects.toThrow(RangeError);
    await expect(
      reversePurchase(db, { purchaseId: 'nope', reason: 'x' }, later, actor),
    ).rejects.toThrow(RecordNotFoundError);
    await reversePurchase(db, { purchaseId: purchase.id, reason: 'x' }, later, actor);
    await expect(
      reversePurchase(db, { purchaseId: purchase.id, reason: 'y' }, later, actor),
    ).rejects.toThrow(AlreadyReversedError);
    expect(await db.purchaseVoids.count()).toBe(1);
    expect(await supplierBalance(db, supplierId)).toBe(0);
  });

  it('writes all or nothing', async () => {
    const purchase = await receive('on_account');
    const before = (await pendingOps(db, 1000)).length;
    db.supplierLedger.hook('creating', () => {
      throw new Error('disk full');
    });
    await expect(
      reversePurchase(db, { purchaseId: purchase.id, reason: 'x' }, later, actor),
    ).rejects.toThrow('disk full');
    expect(await db.purchaseVoids.count()).toBe(0);
    expect(await stockOf(db, milkId)).toBe(12000);
    expect(await pendingOps(db, 1000)).toHaveLength(before);
  });

  it('leaves a reversed delivery out of the expiry list', async () => {
    const purchase = await receive('cash', { fromDrawer: false });
    expect(await expiringLots(db, '2026-11-12')).toHaveLength(1);
    await reversePurchase(db, { purchaseId: purchase.id, reason: 'x' }, later, actor);
    expect(await expiringLots(db, '2026-11-12')).toEqual([]);
  });
});

describe('correctPurchase', () => {
  it('reverses the old receipt and records the corrected one in its place', async () => {
    const old = await receive('on_account');
    const { reversal, purchase } = await correctPurchase(
      db,
      {
        purchaseId: old.id,
        input: {
          deviceCode: 'K2',
          supplierId,
          invoiceNo: 'F-78',
          payment: 'on_account',
          invoiceDate: '2026-11-10',
          lines: [{ productId: milkId, qtyMilli: 10000, buyPrice: 3200 }],
        },
      },
      later,
      actor,
    );
    expect(reversal.purchaseId).toBe(old.id);
    expect(purchase).toMatchObject({
      correctsId: old.id,
      invoiceNo: 'F-78',
      documentDate: '2026-11-10',
      total: 32000,
    });
    expect(await stockOf(db, milkId)).toBe(10000);
    expect(await stockOf(db, teaId)).toBe(0);
    expect(await supplierBalance(db, supplierId)).toBe(32000);
    expect((await db.auditLog.toArray()).map((entry) => entry.action)).toEqual([
      'purchase.correct',
    ]);
  });

  it('changes nothing when the corrected receipt cannot be saved', async () => {
    const old = await receive('on_account');
    const gone = await createProduct(db, { name: 'Gazoz', sellPrice: 1000, vatRate: 1 }, at);
    await deleteProduct(db, gone.id, at);
    await expect(
      correctPurchase(
        db,
        {
          purchaseId: old.id,
          input: {
            deviceCode: 'K2',
            supplierId,
            payment: 'on_account',
            lines: [{ productId: gone.id, qtyMilli: 1000 }],
          },
        },
        later,
        actor,
      ),
    ).rejects.toThrow(RecordNotFoundError);
    expect(await db.purchaseVoids.count()).toBe(0);
    expect(await db.purchases.count()).toBe(1);
    expect(await supplierBalance(db, supplierId)).toBe(old.total);
    expect(await stockOf(db, milkId)).toBe(12000);
  });

  it('refuses to correct a receipt already reversed', async () => {
    const old = await receive('card');
    await reversePurchase(db, { purchaseId: old.id, reason: 'x' }, later, actor);
    await expect(
      correctPurchase(
        db,
        {
          purchaseId: old.id,
          input: { deviceCode: 'K2', lines: [{ productId: milkId, qtyMilli: 1000 }] },
        },
        later,
        actor,
      ),
    ).rejects.toThrow(AlreadyReversedError);
  });
});

describe('reverseSupplierPayment', () => {
  async function pay(method: 'cash' | 'bank', fromDrawer = true) {
    await addSupplierInvoice(db, { supplierId, amount: 50000, purchaseId: 'p1' }, at);
    return recordSupplierPayment(
      db,
      { deviceCode: 'K1', supplierId, amount: 30000, method, fromDrawer },
      at,
    );
  }

  it('puts the payment back on what is owed, and the cash back in the drawer', async () => {
    const payment = await pay('cash');
    expect(await supplierBalance(db, supplierId)).toBe(20000);
    const counter = await reverseSupplierPayment(
      db,
      { entryId: payment.id, reason: 'İki kez girildi' },
      later,
      actor,
    );
    expect(counter).toMatchObject({
      kind: 'adjustment',
      amount: 30000,
      reversesId: payment.id,
      note: 'İki kez girildi',
    });
    expect(await supplierBalance(db, supplierId)).toBe(50000);
    const back = (await db.cashMovements.toArray()).filter((movement) => movement.kind === 'in');
    expect(back).toEqual([expect.objectContaining({ amount: 30000, deviceCode: 'K2' })]);
    expect(await reversedEntryIds(db, supplierId)).toEqual(new Set([payment.id]));
    expect((await db.auditLog.toArray()).map((entry) => entry.action)).toEqual([
      'supplierPayment.reverse',
    ]);
  });

  it('moves no cash for a bank payment', async () => {
    const payment = await pay('bank');
    await reverseSupplierPayment(db, { entryId: payment.id, reason: 'x' }, later, actor);
    expect(await db.cashMovements.count()).toBe(0);
  });

  it('reverses a payment once, and nothing but a payment', async () => {
    const payment = await pay('bank');
    const invoice = (await db.supplierLedger.toArray()).find((entry) => entry.kind === 'invoice');
    await expect(
      reverseSupplierPayment(db, { entryId: invoice?.id ?? '', reason: 'x' }, later, actor),
    ).rejects.toThrow(RangeError);
    await reverseSupplierPayment(db, { entryId: payment.id, reason: 'x' }, later, actor);
    await expect(
      reverseSupplierPayment(db, { entryId: payment.id, reason: 'x' }, later, actor),
    ).rejects.toThrow(AlreadyReversedError);
    expect(await supplierBalance(db, supplierId)).toBe(50000);
  });
});

describe('correctSupplierPayment', () => {
  it('reverses the old payment and records the corrected one', async () => {
    await addSupplierInvoice(db, { supplierId, amount: 50000, purchaseId: 'p1' }, at);
    const old = await recordSupplierPayment(
      db,
      { deviceCode: 'K1', supplierId, amount: 30000, method: 'bank' },
      at,
    );
    const { payment } = await correctSupplierPayment(
      db,
      {
        entryId: old.id,
        input: {
          deviceCode: 'K2',
          supplierId,
          amount: 25000,
          method: 'bank',
          paidOn: '2026-11-10',
          note: 'Havale',
        },
      },
      later,
      actor,
    );
    expect(payment).toMatchObject({
      amount: -25000,
      correctsId: old.id,
      documentDate: '2026-11-10',
    });
    expect(await supplierBalance(db, supplierId)).toBe(25000);
  });

  it('changes nothing when the corrected payment is wrong', async () => {
    await addSupplierInvoice(db, { supplierId, amount: 50000, purchaseId: 'p1' }, at);
    const old = await recordSupplierPayment(
      db,
      { deviceCode: 'K1', supplierId, amount: 30000, method: 'bank' },
      at,
    );
    await expect(
      correctSupplierPayment(
        db,
        {
          entryId: old.id,
          input: { deviceCode: 'K2', supplierId, amount: 0, method: 'bank' },
        },
        later,
        actor,
      ),
    ).rejects.toThrow(RangeError);
    expect(await supplierBalance(db, supplierId)).toBe(20000);
    expect(await db.supplierLedger.count()).toBe(2);
  });
});
