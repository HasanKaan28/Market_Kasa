import { businessDate } from '@/domain/businessDate';
import { assertSafeInteger, type Kurus } from '@/domain/money';
import type { MarketDb } from './db';
import { RecordNotFoundError } from './errors';
import { newId } from './ids';
import { appendOutbox } from './outbox';
import { withoutUndefined } from './records';
import type { SupplierLedgerRecord, SupplierPaymentMethod } from './types';

export type SupplierPaymentInput = {
  supplierId: string;
  /** What was paid, above zero; written on the ledger as a negative amount. */
  amount: Kurus;
  method: SupplierPaymentMethod;
  note?: string;
  cutoffMinutes?: number;
};

export type SupplierInvoiceInput = {
  supplierId: string;
  /** What the invoice asks for, above zero. */
  amount: Kurus;
  purchaseId: string;
  note?: string;
  cutoffMinutes?: number;
};

const METHODS: readonly SupplierPaymentMethod[] = ['cash', 'bank', 'card', 'cheque'];

/** Pays a live supplier, in cash, by bank, by card or by cheque, in one transaction. */
export async function recordSupplierPayment(
  db: MarketDb,
  input: SupplierPaymentInput,
  at: Date,
): Promise<SupplierLedgerRecord> {
  assertSafeInteger(input.amount, 'Supplier payment');
  if (input.amount <= 0) {
    throw new RangeError(`A payment must be above zero, got ${input.amount}`);
  }
  if (!METHODS.includes(input.method)) {
    throw new RangeError(`Unknown payment method: ${String(input.method)}`);
  }
  return db.transaction('rw', db.suppliers, db.supplierLedger, db.outbox, async () => {
    await requireActiveSupplier(db, input.supplierId);
    return addEntry(
      db,
      {
        supplierId: input.supplierId,
        kind: 'payment',
        amount: -input.amount,
        method: input.method,
        note: input.note?.trim() || undefined,
      },
      at,
      input.cutoffMinutes,
    );
  });
}

/**
 * Writes what a delivery on account is owed for. It runs inside the goods receipt's transaction,
 * which also covers the supplier and its ledger.
 */
export async function addSupplierInvoice(
  db: MarketDb,
  input: SupplierInvoiceInput,
  at: Date,
): Promise<SupplierLedgerRecord> {
  assertSafeInteger(input.amount, 'Supplier invoice');
  if (input.amount <= 0) {
    throw new RangeError(`An invoice must be above zero, got ${input.amount}`);
  }
  return db.transaction('rw', db.suppliers, db.supplierLedger, db.outbox, async () => {
    await requireActiveSupplier(db, input.supplierId);
    return addEntry(
      db,
      {
        supplierId: input.supplierId,
        kind: 'invoice',
        amount: input.amount,
        purchaseId: input.purchaseId,
        note: input.note?.trim() || undefined,
      },
      at,
      input.cutoffMinutes,
    );
  });
}

async function addEntry(
  db: MarketDb,
  entry: Omit<SupplierLedgerRecord, 'id' | 'occurredAt' | 'businessDate'>,
  at: Date,
  cutoffMinutes: number | undefined,
): Promise<SupplierLedgerRecord> {
  const record: SupplierLedgerRecord = withoutUndefined({
    id: newId(at.getTime()),
    ...entry,
    occurredAt: at.toISOString(),
    businessDate: businessDate(at, { cutoffMinutes }),
  });
  await db.supplierLedger.add(record);
  await appendOutbox(
    db,
    { kind: 'insert', table: 'supplierLedger', recordId: record.id, record },
    at,
  );
  return record;
}

async function requireActiveSupplier(db: MarketDb, supplierId: string): Promise<void> {
  const supplier = await db.suppliers.get(supplierId);
  if (!supplier || supplier.archivedAt) {
    throw new RecordNotFoundError('Supplier', supplierId);
  }
}
