import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import { createCustomer, customerBalance } from './customers';
import type { MarketDb } from './db';
import { CreditLimitError, RecordNotFoundError, PaymentMismatchError } from './errors';
import { pendingCount, pendingOps } from './outbox';
import { createProduct, deleteProduct } from './products';
import { findSaleByReceiptNo, recentSales, recordSale } from './sales';
import { stockOf } from './stock';

let db: MarketDb;
let ids: { ekmek: string; ayran: string; peynir: string; cay: string };
const setupAt = new Date('2026-10-28T06:00:00Z');

beforeEach(async () => {
  db = makeTestDb();
  const make = async (name: string, sellPrice: number) =>
    (await createProduct(db, { name, sellPrice, vatRate: 1 }, setupAt)).id;
  ids = {
    ekmek: await make('Ekmek', 1500),
    ayran: await make('Ayran', 2250),
    peynir: await make('Beyaz Peynir', 18990),
    cay: await make('Siyah Çay', 27900),
  };
});
afterEach(async () => {
  await db.delete();
});

const cartLines = () => [
  { productId: ids.ekmek, qtyMilli: 2000 },
  { productId: ids.ayran, qtyMilli: 3000 },
  { productId: ids.peynir, qtyMilli: 1000 },
  { productId: ids.cay, qtyMilli: 1000 },
];
const cashSale = (at: string) => ({
  deviceCode: 'K1',
  at: new Date(at),
  lines: cartLines(),
  payments: [{ method: 'cash' as const, amount: 56640 }],
});

describe('recordSale', () => {
  it('records a cash sale with totals, change and stock movements', async () => {
    const sale = await recordSale(db, { ...cashSale('2026-10-28T09:00:00Z'), cashGiven: 60000 });
    expect(sale).toMatchObject({
      receiptNo: 'K1-20261028-0001',
      total: 56640,
      vatTotal: 561,
      change: 3360,
    });
    expect(await stockOf(db, ids.ekmek)).toBe(-2000);
    expect(await stockOf(db, ids.ayran)).toBe(-3000);
    expect(await findSaleByReceiptNo(db, 'K1-20261028-0001')).toMatchObject({ id: sale.id });
  });

  it('queues every sale record as an insert', async () => {
    const before = await pendingCount(db);
    await recordSale(db, cashSale('2026-10-28T09:00:00Z'));
    const ops = (await pendingOps(db)).slice(before);
    expect(ops.map((op) => [op.kind, op.table])).toEqual([
      ['insert', 'stockMovements'],
      ['insert', 'stockMovements'],
      ['insert', 'stockMovements'],
      ['insert', 'stockMovements'],
      ['insert', 'sales'],
    ]);
  });

  it('numbers receipts per device and business day', async () => {
    const no = async (at: string) => (await recordSale(db, cashSale(at))).receiptNo;
    expect(await no('2026-10-28T09:00:00Z')).toBe('K1-20261028-0001');
    expect(await no('2026-10-28T10:00:00Z')).toBe('K1-20261028-0002');
    expect(await no('2026-10-28T21:30:00Z')).toBe('K1-20261029-0001');
    expect(await no('2026-10-28T20:00:00Z')).toBe('K1-20261028-0003');
  });

  it('writes the credit part of a split payment to the ledger', async () => {
    const c = await createCustomer(db, { name: 'Ahmet' }, setupAt);
    await recordSale(db, {
      ...cashSale('2026-10-28T09:00:00Z'),
      customerId: c.id,
      payments: [
        { method: 'cash', amount: 20000 },
        { method: 'credit', amount: 36640 },
      ],
    });
    expect(await customerBalance(db, c.id)).toBe(36640);
  });

  it('enforces the credit limit unless allowed', async () => {
    const c = await createCustomer(db, { name: 'Ahmet', creditLimit: 30000 }, setupAt);
    const credit = {
      ...cashSale('2026-10-28T09:00:00Z'),
      customerId: c.id,
      payments: [{ method: 'credit' as const, amount: 56640 }],
    };
    await expect(recordSale(db, credit)).rejects.toBeInstanceOf(CreditLimitError);
    await recordSale(db, { ...credit, allowOverLimit: true });
    expect(await customerBalance(db, c.id)).toBe(56640);
  });

  it('requires an active customer for credit', async () => {
    const credit = {
      ...cashSale('2026-10-28T09:00:00Z'),
      payments: [{ method: 'credit' as const, amount: 56640 }],
    };
    await expect(recordSale(db, credit)).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  it('rejects payments that do not add up', async () => {
    await expect(
      recordSale(db, {
        ...cashSale('2026-10-28T09:00:00Z'),
        payments: [{ method: 'cash', amount: 50000 }],
      }),
    ).rejects.toBeInstanceOf(PaymentMismatchError);
    await expect(
      recordSale(db, { ...cashSale('2026-10-28T09:00:00Z'), cashGiven: 50000 }),
    ).rejects.toBeInstanceOf(PaymentMismatchError);
  });

  it('rejects fractional payment amounts', async () =>
    expect(
      recordSale(db, {
        ...cashSale('2026-10-28T09:00:00Z'),
        payments: [
          { method: 'cash', amount: 56639.5 },
          { method: 'card', amount: 0.5 },
        ],
      }),
    ).rejects.toThrow(RangeError));

  it('rejects unknown and deleted products without writing anything', async () => {
    await deleteProduct(db, ids.cay, setupAt);
    const before = await pendingCount(db);
    await expect(recordSale(db, cashSale('2026-10-28T09:00:00Z'))).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
    expect(await pendingCount(db)).toBe(before);
    expect(await stockOf(db, ids.ekmek)).toBe(0);
  });

  it('rolls back every write when the sale itself cannot be stored', async () => {
    await recordSale(db, cashSale('2026-10-27T09:00:00Z'));
    const before = await pendingCount(db);
    // The sale is the transaction's last write; make storing it fail.
    db.sales.hook('creating', () => {
      throw new Error('disk full');
    });
    await expect(recordSale(db, cashSale('2026-10-28T09:00:00Z'))).rejects.toThrow('disk full');
    expect(await pendingCount(db)).toBe(before);
    expect(await stockOf(db, ids.ekmek)).toBe(-2000);
  });

  it('records a sale only once when the same id is submitted again', async () => {
    const id = '01a181bc-da80-7001-8203-040506070809';
    const first = await recordSale(db, { ...cashSale('2026-10-28T09:00:00Z'), id });
    const before = await pendingCount(db);
    const again = await recordSale(db, { ...cashSale('2026-10-28T09:00:01Z'), id });
    expect(again).toEqual(first);
    expect(await db.sales.count()).toBe(1);
    expect(await stockOf(db, ids.ekmek)).toBe(-2000);
    expect(await pendingCount(db)).toBe(before);
  });

  it('lists recent sales newest first', async () => {
    await recordSale(db, cashSale('2026-10-28T09:00:00Z'));
    await recordSale(db, cashSale('2026-10-28T10:00:00Z'));
    expect((await recentSales(db)).map((s) => s.receiptNo)).toEqual([
      'K1-20261028-0002',
      'K1-20261028-0001',
    ]);
  });
});
