import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { supplierStatement } from '@/suppliers/statement';
import { makeTestDb } from '@/test/db';
import type { MarketDb } from './db';
import { createProduct } from './products';
import { listSupplierPurchases, recordPurchase } from './purchases';
import { recordSupplierPayment } from './supplierLedger';
import { createSupplier } from './suppliers';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

// 14:00 on 10 November in Istanbul: an invoice from the 9th is typed in today.
const today = new Date('2026-11-10T11:00:00Z');

async function setup() {
  const supplier = await createSupplier(db, { name: 'Toptancı' }, today);
  const milk = await createProduct(
    db,
    { name: 'Süt', sellPrice: 4250, buyPrice: 3000, vatRate: 1 },
    today,
  );
  return { supplier, milk };
}

describe('a document date on goods receipts and supplier payments', () => {
  it('keeps the invoice’s own date, on the receipt and on what the supplier is owed', async () => {
    const { supplier, milk } = await setup();
    const purchase = await recordPurchase(
      db,
      {
        deviceCode: 'K1',
        supplierId: supplier.id,
        payment: 'on_account',
        invoiceNo: 'F-77',
        invoiceDate: '2026-11-09',
        lines: [{ productId: milk.id, qtyMilli: 10000 }],
      },
      today,
    );
    expect(purchase.documentDate).toBe('2026-11-09');
    // When it was typed in stays as it was.
    expect(purchase.businessDate).toBe('2026-11-10');
    const [line] = await supplierStatement(db, supplier.id);
    expect(line?.entry.documentDate).toBe('2026-11-09');
  });

  it('keeps a payment’s own date', async () => {
    const { supplier } = await setup();
    const payment = await recordSupplierPayment(
      db,
      {
        deviceCode: 'K1',
        supplierId: supplier.id,
        amount: 5000,
        method: 'bank',
        paidOn: '2026-11-08',
      },
      today,
    );
    expect(payment.documentDate).toBe('2026-11-08');
  });

  it('orders the statement and the invoices by their own dates', async () => {
    const { supplier, milk } = await setup();
    const receive = (invoiceNo: string, invoiceDate: string) =>
      recordPurchase(
        db,
        {
          deviceCode: 'K1',
          supplierId: supplier.id,
          payment: 'on_account',
          invoiceNo,
          invoiceDate,
          lines: [{ productId: milk.id, qtyMilli: 1000 }],
        },
        today,
      );
    // Typed in today, the later invoice first.
    await receive('B', '2026-11-09');
    await receive('A', '2026-11-05');
    await recordSupplierPayment(
      db,
      {
        deviceCode: 'K1',
        supplierId: supplier.id,
        amount: 1000,
        method: 'bank',
        paidOn: '2026-11-07',
      },
      today,
    );
    expect((await supplierStatement(db, supplier.id)).map((line) => line.description)).toEqual([
      'Fatura A',
      'Ödeme (banka)',
      'Fatura B',
    ]);
    expect((await listSupplierPurchases(db, supplier.id)).map((p) => p.invoiceNo)).toEqual([
      'B',
      'A',
    ]);
  });

  it('refuses a date that is not a day, or one still to come', async () => {
    const { supplier, milk } = await setup();
    for (const invoiceDate of ['09.11.2026', '2026-11-11']) {
      await expect(
        recordPurchase(
          db,
          { deviceCode: 'K1', invoiceDate, lines: [{ productId: milk.id, qtyMilli: 1000 }] },
          today,
        ),
        invoiceDate,
      ).rejects.toThrow(RangeError);
    }
    await expect(
      recordSupplierPayment(
        db,
        {
          deviceCode: 'K1',
          supplierId: supplier.id,
          amount: 1000,
          method: 'bank',
          paidOn: '2026-11-11',
        },
        today,
      ),
    ).rejects.toThrow(RangeError);
  });
});
