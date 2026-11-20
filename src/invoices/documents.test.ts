import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { reversePurchase } from '@/data/corrections';
import { createCustomer } from '@/data/customers';
import type { MarketDb } from '@/data/db';
import { createProduct } from '@/data/products';
import { recordPurchase } from '@/data/purchases';
import { recordSale } from '@/data/sales';
import { createSupplier } from '@/data/suppliers';
import { voidSale } from '@/data/voids';
import { makeTestDb } from '@/test/db';
import { listDocuments } from './documents';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

// 09:00 UTC is noon in Istanbul: the business day is the date itself.
const on = (day: string, hour = 9) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00Z`);

async function aWeek() {
  const tea = await createProduct(
    db,
    { name: 'Çay', sellPrice: 9000, buyPrice: 7000, vatRate: 1 },
    on('2026-11-01'),
  );
  const ayse = await createCustomer(db, { name: 'Ayşe' }, on('2026-11-01'));
  const eti = await createSupplier(db, { name: 'Eti' }, on('2026-11-01'));
  const sell = (day: string, qty: number, customerId?: string) =>
    recordSale(db, {
      deviceCode: 'K1',
      at: on(day),
      lines: [{ productId: tea.id, qtyMilli: qty * 1000 }],
      ...(customerId
        ? { customerId, payments: [{ method: 'credit' as const, amount: qty * 9000 }] }
        : { payments: [{ method: 'cash' as const, amount: qty * 9000 }] }),
    });
  const receive = (
    typedOn: string,
    invoiceNo: string,
    qty: number,
    invoiceDate?: string,
    hour = 9,
  ) =>
    recordPurchase(
      db,
      {
        deviceCode: 'K1',
        supplierId: eti.id,
        invoiceNo,
        payment: 'on_account',
        ...(invoiceDate ? { invoiceDate } : {}),
        lines: [{ productId: tea.id, qtyMilli: qty * 1000 }],
      },
      on(typedOn, hour),
    );
  const early = await sell('2026-11-02', 1);
  const credit = await sell('2026-11-03', 2, ayse.id);
  const voided = await sell('2026-11-04', 3);
  await voidSale(db, {
    saleId: voided.id,
    reason: 'Yanlış',
    deviceCode: 'K1',
    at: on('2026-11-04', 10),
  });
  // Typed on the 5th, dated the 3rd: it is listed on the 3rd.
  const late = await receive('2026-11-05', 'F-1', 10, '2026-11-03');
  // An hour before that day's sale, so the sale is the newer of the two.
  const wrong = await receive('2026-11-04', 'F-2', 5, undefined, 8);
  await reversePurchase(db, { purchaseId: wrong.id, reason: 'Yanlış' }, on('2026-11-04', 10), {
    deviceCode: 'K1',
  });
  const outside = await sell('2026-11-06', 4);
  return { early, credit, voided, late, wrong, outside };
}

describe('listDocuments', () => {
  it('lists sales and purchases of the range together, newest first, by their own dates', async () => {
    const { credit, voided, late, wrong } = await aWeek();
    const { rows, totals } = await listDocuments(db, {
      from: '2026-11-03',
      to: '2026-11-05',
      kind: 'all',
    });
    expect(
      rows.map((row) => [
        row.day,
        row.kind,
        row.number,
        row.counterparty,
        row.payment,
        row.total,
        row.cancelled,
      ]),
    ).toEqual([
      ['2026-11-04', 'sale', voided.receiptNo, undefined, 'Nakit', 27000, true],
      ['2026-11-04', 'purchase', 'F-2', 'Eti', 'Veresiye', 35000, true],
      ['2026-11-03', 'purchase', 'F-1', 'Eti', 'Veresiye', 70000, false],
      ['2026-11-03', 'sale', credit.receiptNo, 'Ayşe', 'Veresiye', 18000, false],
    ]);
    expect(rows.find((row) => row.kind === 'purchase' && row.id === late.id)).toBeDefined();
    expect(rows.find((row) => row.id === wrong.id)?.cancelled).toBe(true);
    // What was voided or taken back is not counted.
    expect(totals).toEqual({
      sale: { count: 1, total: 18000 },
      purchase: { count: 1, total: 70000 },
    });
  });

  it('filters to sales or to purchases, keeping the totals of both', async () => {
    await aWeek();
    const sales = await listDocuments(db, { from: '2026-11-01', to: '2026-11-30', kind: 'sale' });
    expect(new Set(sales.rows.map((row) => row.kind))).toEqual(new Set(['sale']));
    expect(sales.rows).toHaveLength(4);
    expect(sales.totals.purchase).toEqual({ count: 1, total: 70000 });
    const purchases = await listDocuments(db, {
      from: '2026-11-01',
      to: '2026-11-30',
      kind: 'purchase',
    });
    expect(purchases.rows.map((row) => row.number)).toEqual(['F-2', 'F-1']);
  });

  it('leaves purchases out for a person not allowed to see them', async () => {
    await aWeek();
    const { rows, totals } = await listDocuments(db, {
      from: '2026-11-01',
      to: '2026-11-30',
      kind: 'all',
      purchases: false,
    });
    expect(rows.every((row) => row.kind === 'sale')).toBe(true);
    expect(totals.purchase).toEqual({ count: 0, total: 0 });
  });
});
