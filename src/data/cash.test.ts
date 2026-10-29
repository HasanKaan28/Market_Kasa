import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import {
  closeCashSession,
  currentCashSession,
  expectedCash,
  openCashSession,
  recordCashMovement,
} from './cash';
import { createCustomer } from './customers';
import type { MarketDb } from './db';
import { recordAdjustment, recordPayment } from './ledger';
import { pendingOps } from './outbox';
import { createProduct } from './products';
import { recordPurchase } from './purchases';
import { recordReturn } from './returns';
import { recordSale } from './sales';
import { recordSupplierPayment } from './supplierLedger';
import { createSupplier } from './suppliers';
import type { Payment } from './types';
import { voidSale } from './voids';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

// 09:00 in Istanbul.
const opened = new Date('2026-10-29T06:00:00Z');
const later = (minutes: number) => new Date(opened.getTime() + minutes * 60_000);

async function tea() {
  return createProduct(
    db,
    { name: 'Çay', sellPrice: 1000, buyPrice: 700, vatRate: 1 },
    later(-3000),
  );
}

function sell(
  productId: string,
  pieces: number,
  payments: Payment[],
  deviceCode: string,
  at: Date,
) {
  return recordSale(db, {
    deviceCode,
    at,
    lines: [{ productId, qtyMilli: pieces * 1000 }],
    payments,
  });
}

describe('expectedCash', () => {
  it('expects the cash this register took in the session', async () => {
    const product = await tea();
    // Before the drawer opened, and on another register: neither is in this drawer.
    await sell(product.id, 1, [{ method: 'cash', amount: 1000 }], 'K1', later(-30));
    await openCashSession(db, { deviceCode: 'K1', openingCash: 20000 }, opened);
    await sell(product.id, 5, [{ method: 'cash', amount: 5000 }], 'K1', later(10));
    await sell(product.id, 3, [{ method: 'cash', amount: 3000 }], 'K2', later(11));
    await sell(product.id, 3, [{ method: 'card', amount: 3000 }], 'K1', later(12));
    const split = await sell(
      product.id,
      3,
      [
        { method: 'cash', amount: 2000 },
        { method: 'card', amount: 1000 },
      ],
      'K1',
      later(13),
    );
    // A refund goes back by card first: of 2000, only 1000 leaves the drawer.
    await recordReturn(db, {
      saleId: split.id,
      lines: [{ productId: product.id, qtyMilli: 2000 }],
      deviceCode: 'K1',
      at: later(20),
    });
    await recordCashMovement(
      db,
      { deviceCode: 'K1', kind: 'in', amount: 500, reason: 'Bozuk para' },
      later(30),
    );
    await recordCashMovement(
      db,
      { deviceCode: 'K1', kind: 'out', amount: 300, reason: 'Ekmekçi' },
      later(31),
    );
    await recordCashMovement(
      db,
      { deviceCode: 'K2', kind: 'out', amount: 9900, reason: 'Başka kasa' },
      later(32),
    );

    expect((await expectedCash(db, 'K1', later(15))).expected).toBe(20000 + 7000);
    expect(await expectedCash(db, 'K1', later(60))).toMatchObject({
      session: { openingCash: 20000 },
      sales: 7000,
      voids: 0,
      refunds: 1000,
      movementsIn: 500,
      movementsOut: 300,
      expected: 20000 + 7000 - 1000 + 500 - 300,
    });
  });

  it('counts a void of an earlier sale as cash out today', async () => {
    const product = await tea();
    const yesterday = await sell(
      product.id,
      4,
      [{ method: 'cash', amount: 4000 }],
      'K1',
      later(-24 * 60),
    );
    await openCashSession(db, { deviceCode: 'K1', openingCash: 10000 }, opened);
    const today = await sell(product.id, 2, [{ method: 'cash', amount: 2000 }], 'K1', later(5));
    await voidSale(db, {
      saleId: yesterday.id,
      reason: 'Yanlış fiş',
      deviceCode: 'K1',
      at: later(10),
    });
    await voidSale(db, { saleId: today.id, reason: 'Vazgeçti', deviceCode: 'K1', at: later(11) });
    expect(await expectedCash(db, 'K1', later(20))).toMatchObject({
      sales: 2000,
      voids: 6000,
      expected: 10000 + 2000 - 6000,
    });
  });
});

describe('closeCashSession', () => {
  it('closes the session into one Z record', async () => {
    const product = await tea();
    await openCashSession(db, { deviceCode: 'K1', openingCash: 10000 }, opened);
    expect(await currentCashSession(db, 'K1')).toMatchObject({
      openingCash: 10000,
      openedAt: opened.toISOString(),
    });
    await expect(
      openCashSession(db, { deviceCode: 'K1', openingCash: 0 }, later(1)),
    ).rejects.toThrow();
    await sell(product.id, 3, [{ method: 'cash', amount: 3000 }], 'K1', later(10));

    // The outbox write fails: nothing of the close may stay behind, and the drawer stays open.
    const fail = () => {
      throw new Error('disk full');
    };
    db.outbox.hook('creating', fail);
    await expect(
      closeCashSession(db, { deviceCode: 'K1', countedCash: 12950 }, later(60)),
    ).rejects.toThrow('disk full');
    db.outbox.hook('creating').unsubscribe(fail);
    expect(await db.cashSessions.count()).toBe(0);
    expect(await currentCashSession(db, 'K1')).toBeDefined();

    const z = await closeCashSession(db, { deviceCode: 'K1', countedCash: 12950 }, later(60));
    expect(z).toMatchObject({
      deviceCode: 'K1',
      openedAt: opened.toISOString(),
      openingCash: 10000,
      closedAt: later(60).toISOString(),
      expectedCash: 13000,
      countedCash: 12950,
      difference: -50,
      businessDate: '2026-10-29',
    });
    expect(z.summary).toMatchObject({ salesCount: 1, net: 3000 });
    expect(await db.cashSessions.toArray()).toEqual([z]);
    expect((await pendingOps(db)).at(-1)).toMatchObject({ table: 'cashSessions', recordId: z.id });
    expect(await currentCashSession(db, 'K1')).toBeUndefined();

    // Closed again without opening: no opening cash, and only what came after the last close.
    await sell(product.id, 2, [{ method: 'cash', amount: 2000 }], 'K1', later(90));
    const next = await closeCashSession(db, { deviceCode: 'K1', countedCash: 2000 }, later(120));
    expect(next).toMatchObject({ openingCash: 0, expectedCash: 2000, difference: 0 });
    expect(next.openedAt).toBeUndefined();
    expect(next.summary.salesCount).toBe(1);
  });
});

describe('cash movements', () => {
  it('refuses a movement without an amount or a reason', async () => {
    await expect(
      recordCashMovement(db, { deviceCode: 'K1', kind: 'out', amount: 0, reason: 'Boş' }, opened),
    ).rejects.toThrow(RangeError);
    await expect(
      recordCashMovement(db, { deviceCode: 'K1', kind: 'in', amount: 100, reason: '  ' }, opened),
    ).rejects.toThrow(RangeError);
    expect(await db.cashMovements.count()).toBe(0);
  });

  it('puts cash collections and cash payments in the drawer', async () => {
    const product = await tea();
    const customer = await createCustomer(db, { name: 'Ahmet' }, later(-60));
    await recordAdjustment(
      db,
      { customerId: customer.id, amount: 10000, note: 'Eski borç' },
      later(-60),
    );
    const supplier = await createSupplier(db, { name: 'Eti' }, later(-60));
    await openCashSession(db, { deviceCode: 'K1', openingCash: 0 }, opened);

    const collected = await recordPayment(
      db,
      { deviceCode: 'K1', customerId: customer.id, amount: 4000, method: 'cash' },
      later(1),
    );
    await recordPayment(
      db,
      { deviceCode: 'K1', customerId: customer.id, amount: 1000, method: 'card' },
      later(2),
    );
    const paid = await recordSupplierPayment(
      db,
      { deviceCode: 'K1', supplierId: supplier.id, amount: 1500, method: 'cash' },
      later(3),
    );
    await recordSupplierPayment(
      db,
      { deviceCode: 'K1', supplierId: supplier.id, amount: 700, method: 'bank' },
      later(4),
    );
    const bought = await recordPurchase(
      db,
      {
        deviceCode: 'K1',
        supplierId: supplier.id,
        lines: [{ productId: product.id, qtyMilli: 2000 }],
        payment: 'cash',
      },
      later(5),
    );
    await recordPurchase(
      db,
      {
        deviceCode: 'K1',
        supplierId: supplier.id,
        lines: [{ productId: product.id, qtyMilli: 1000 }],
        payment: 'on_account',
      },
      later(6),
    );
    await recordPurchase(
      db,
      { deviceCode: 'K1', lines: [{ productId: product.id, qtyMilli: 1000 }], payment: 'card' },
      later(7),
    );

    const movements = await db.cashMovements.orderBy('occurredAt').toArray();
    expect(movements.map(({ kind, amount, refId }) => ({ kind, amount, refId }))).toEqual([
      { kind: 'in', amount: 4000, refId: collected.id },
      { kind: 'out', amount: 1500, refId: paid.id },
      { kind: 'out', amount: 1400, refId: bought.id },
    ]);
    expect(movements.map((movement) => movement.reason)).toEqual([
      'Tahsilat · Ahmet',
      'Tedarikçi ödemesi · Eti',
      'Mal kabul · Eti',
    ]);
    expect(await expectedCash(db, 'K1', later(10))).toMatchObject({
      movementsIn: 4000,
      movementsOut: 2900,
      expected: 1100,
    });
    expect((await pendingOps(db)).filter((op) => op.table === 'cashMovements')).toHaveLength(3);
  });
});
