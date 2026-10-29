import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import { closeCashSession, openCashSession, recordCashMovement } from './cash';
import { recordCount } from './counts';
import { createCustomer } from './customers';
import type { MarketDb } from './db';
import { recordAdjustment, recordPayment } from './ledger';
import { createProduct } from './products';
import { recordPurchase } from './purchases';
import { recordReturn } from './returns';
import { recordSale } from './sales';
import { recordSupplierAdjustment, recordSupplierPayment } from './supplierLedger';
import { createSupplier } from './suppliers';
import { voidSale } from './voids';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const at = new Date('2026-10-29T09:00:00Z');
const later = (minutes: number) => new Date(at.getTime() + minutes * 60_000);
const AYSE = 'staff-ayse';

describe('who did it', () => {
  it('stamps who did it on every event', async () => {
    const tea = await createProduct(
      db,
      { name: 'Çay', sellPrice: 1000, buyPrice: 700, vatRate: 1 },
      at,
    );
    const ahmet = await createCustomer(db, { name: 'Ahmet' }, at);
    const eti = await createSupplier(db, { name: 'Eti' }, at);
    await openCashSession(db, { deviceCode: 'K1', openingCash: 0 }, at);
    const cashSale = await recordSale(db, {
      deviceCode: 'K1',
      at: later(1),
      staffId: AYSE,
      lines: [{ productId: tea.id, qtyMilli: 2000 }],
      payments: [{ method: 'cash', amount: 2000 }],
    });
    const creditSale = await recordSale(db, {
      deviceCode: 'K1',
      at: later(2),
      staffId: AYSE,
      customerId: ahmet.id,
      lines: [{ productId: tea.id, qtyMilli: 1000 }],
      payments: [{ method: 'credit', amount: 1000 }],
    });
    await recordReturn(db, {
      saleId: creditSale.id,
      lines: [{ productId: tea.id, qtyMilli: 1000 }],
      deviceCode: 'K1',
      at: later(3),
      staffId: AYSE,
    });
    await voidSale(db, {
      saleId: cashSale.id,
      reason: 'Yanlış ürün',
      deviceCode: 'K1',
      at: later(4),
      staffId: AYSE,
    });
    await recordAdjustment(
      db,
      { staffId: AYSE, customerId: ahmet.id, amount: 3000, note: 'Eski borç' },
      later(5),
    );
    await recordPayment(
      db,
      { deviceCode: 'K1', staffId: AYSE, customerId: ahmet.id, amount: 500, method: 'cash' },
      later(6),
    );
    await recordSupplierAdjustment(
      db,
      { staffId: AYSE, supplierId: eti.id, amount: 1000, note: 'Açılış bakiyesi' },
      later(7),
    );
    await recordSupplierPayment(
      db,
      { deviceCode: 'K1', staffId: AYSE, supplierId: eti.id, amount: 400, method: 'cash' },
      later(8),
    );
    await recordPurchase(
      db,
      {
        deviceCode: 'K1',
        staffId: AYSE,
        supplierId: eti.id,
        lines: [{ productId: tea.id, qtyMilli: 1000 }],
        payment: 'on_account',
      },
      later(9),
    );
    await recordPurchase(
      db,
      {
        deviceCode: 'K1',
        staffId: AYSE,
        lines: [{ productId: tea.id, qtyMilli: 1000 }],
        payment: 'cash',
      },
      later(10),
    );
    await recordCount(
      db,
      { deviceCode: 'K1', staffId: AYSE, lines: [{ productId: tea.id, countedMilli: 5000 }] },
      later(11),
    );
    await recordCashMovement(
      db,
      { deviceCode: 'K1', staffId: AYSE, kind: 'in', amount: 100, reason: 'Bozuk para' },
      later(12),
    );
    await closeCashSession(db, { deviceCode: 'K1', staffId: AYSE, countedCash: 0 }, later(13));

    const tables = [
      db.sales,
      db.saleVoids,
      db.returns,
      db.ledger,
      db.supplierLedger,
      db.purchases,
      db.stockCounts,
      db.cashMovements,
      db.cashSessions,
    ];
    for (const table of tables) {
      const stamps = (await table.toArray()).map((record) => record.staffId);
      expect(stamps.length).toBeGreaterThan(0);
      expect([table.name, ...stamps]).toEqual([table.name, ...stamps.map(() => AYSE)]);
    }
  });
});
