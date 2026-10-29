import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import type { MarketDb } from './db';
import { DuplicateSupplierError, RecordNotFoundError } from './errors';
import { pendingOps } from './outbox';
import { addSupplierInvoice, recordSupplierPayment } from './supplierLedger';
import {
  archiveSupplier,
  createSupplier,
  searchSuppliers,
  supplierBalance,
  updateSupplier,
} from './suppliers';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const at = new Date('2026-10-29T09:00:00Z');

describe('suppliers', () => {
  it('adds, edits and archives a settled supplier', async () => {
    const supplier = await createSupplier(
      db,
      {
        name: ' Ülker Dağıtım ',
        phone: '0212 555 00 11',
        taxNo: '123 456 7890',
        taxOffice: 'Kadıköy',
      },
      at,
    );
    expect(supplier).toMatchObject({
      name: 'Ülker Dağıtım',
      phone: '02125550011',
      taxNo: '1234567890',
      taxOffice: 'Kadıköy',
    });
    const renamed = await updateSupplier(db, supplier.id, { name: 'Ülker A.Ş.' }, at);
    expect(renamed.name).toBe('Ülker A.Ş.');
    expect((await searchSuppliers(db, 'ülker')).map((found) => found.id)).toEqual([supplier.id]);
    await archiveSupplier(db, supplier.id, at);
    expect((await db.suppliers.get(supplier.id))?.archivedAt).toBe(at.toISOString());
    expect(await searchSuppliers(db, 'ülker')).toEqual([]);
    expect((await pendingOps(db)).map((op) => [op.table, op.kind])).toEqual([
      ['suppliers', 'insert'],
      ['suppliers', 'patch'],
      ['suppliers', 'patch'],
    ]);
  });

  it('refuses a second supplier with the same name', async () => {
    const first = await createSupplier(db, { name: 'Ülker Dağıtım' }, at);
    await expect(createSupplier(db, { name: 'ÜLKER DAĞITIM' }, at)).rejects.toBeInstanceOf(
      DuplicateSupplierError,
    );
    const other = await createSupplier(db, { name: 'Eti' }, at);
    await expect(
      updateSupplier(db, other.id, { name: 'ülker dağıtım' }, at),
    ).rejects.toBeInstanceOf(DuplicateSupplierError);
    await expect(createSupplier(db, { name: '  ' }, at)).rejects.toBeInstanceOf(RangeError);
    // Renaming a supplier to its own name in another case is no duplicate.
    await updateSupplier(db, first.id, { name: 'ÜLKER DAĞITIM' }, at);
  });
});

describe('supplier ledger', () => {
  it('records a supplier payment all or nothing', async () => {
    const supplier = await createSupplier(db, { name: 'Eti' }, at);
    await addSupplierInvoice(db, { supplierId: supplier.id, amount: 10000, purchaseId: 'p1' }, at);
    const payment = await recordSupplierPayment(
      db,
      { supplierId: supplier.id, amount: 4000, method: 'bank', note: ' havale ' },
      at,
    );
    expect(payment).toMatchObject({
      kind: 'payment',
      amount: -4000,
      method: 'bank',
      note: 'havale',
    });
    expect(await supplierBalance(db, supplier.id)).toBe(6000);

    const entries = await db.supplierLedger.count();
    db.outbox.hook('creating', () => {
      throw new Error('disk full');
    });
    await expect(
      recordSupplierPayment(db, { supplierId: supplier.id, amount: 1000, method: 'cash' }, at),
    ).rejects.toThrow('disk full');
    expect(await db.supplierLedger.count()).toBe(entries);
  });

  it('refuses an empty or unknown supplier payment', async () => {
    const supplier = await createSupplier(db, { name: 'Eti' }, at);
    const gone = await createSupplier(db, { name: 'Pınar' }, at);
    await archiveSupplier(db, gone.id, at);
    const pay = (supplierId: string, amount: number, method = 'cash') =>
      recordSupplierPayment(db, { supplierId, amount, method: method as 'cash' }, at);
    await expect(pay(supplier.id, 0)).rejects.toBeInstanceOf(RangeError);
    await expect(pay(supplier.id, -100)).rejects.toBeInstanceOf(RangeError);
    await expect(pay(supplier.id, 0.5)).rejects.toBeInstanceOf(RangeError);
    await expect(pay(supplier.id, 100, 'credit')).rejects.toBeInstanceOf(RangeError);
    await expect(pay('nobody', 100)).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(pay(gone.id, 100)).rejects.toBeInstanceOf(RecordNotFoundError);
    for (const method of ['cash', 'bank', 'card', 'cheque']) {
      await pay(supplier.id, 100, method);
    }
    expect(await supplierBalance(db, supplier.id)).toBe(-400);
  });

  it('refuses to archive a supplier with a balance', async () => {
    const supplier = await createSupplier(db, { name: 'Eti' }, at);
    await addSupplierInvoice(db, { supplierId: supplier.id, amount: 10000, purchaseId: 'p1' }, at);
    await expect(archiveSupplier(db, supplier.id, at)).rejects.toBeInstanceOf(RangeError);
    await recordSupplierPayment(db, { supplierId: supplier.id, amount: 10000, method: 'bank' }, at);
    await archiveSupplier(db, supplier.id, at);
    expect((await db.suppliers.get(supplier.id))?.archivedAt).toBe(at.toISOString());
  });
});
