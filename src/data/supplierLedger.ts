import { businessDate } from '@/domain/businessDate';
import { assertSafeInteger, type Kurus } from '@/domain/money';
import { addCashMovement } from './cash';
import type { MarketDb } from './db';
import { RecordNotFoundError } from './errors';
import { newId } from './ids';
import { appendOutbox } from './outbox';
import { withoutUndefined } from './records';
import type { SupplierLedgerRecord, SupplierPaymentMethod, SupplierRecord } from './types';

export type SupplierPaymentInput = {
  /** The register that paid: cash comes out of its drawer. */
  deviceCode: string;
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

/**
 * Pays a supplier, in cash, by bank, by card or by cheque, in one transaction; cash comes out of
 * the register's drawer as a cash movement in the same transaction. An archived supplier still
 * owed money (another register's delivery on account) can be paid too.
 */
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
  const tables = [db.suppliers, db.supplierLedger, db.cashMovements, db.outbox, db.meta];
  return db.transaction('rw', tables, async () => {
    const supplier = await requireSupplier(db, input.supplierId, { active: false });
    const entry = await addEntry(
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
    if (input.method === 'cash') {
      await addCashMovement(
        db,
        {
          deviceCode: input.deviceCode,
          kind: 'out',
          amount: input.amount,
          reason: `Tedarikçi ödemesi · ${supplier.name}`,
          refId: entry.id,
          cutoffMinutes: input.cutoffMinutes,
        },
        at,
      );
    }
    return entry;
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
    await requireSupplier(db, input.supplierId, { active: true });
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

export type SupplierAdjustmentInput = {
  supplierId: string;
  /** Signed: a positive amount adds to what the market owes, a negative one takes it off. */
  amount: Kurus;
  /** Why, always: an opening balance, a mistyped invoice, a payment recorded twice. */
  note: string;
  cutoffMinutes?: number;
};

/**
 * Corrects what the market owes a supplier by a counter-entry (DESIGN §6.1), with its reason, in
 * one transaction: an opening balance, a mistyped invoice, a payment recorded twice.
 */
export async function recordSupplierAdjustment(
  db: MarketDb,
  input: SupplierAdjustmentInput,
  at: Date,
): Promise<SupplierLedgerRecord> {
  assertSafeInteger(input.amount, 'Supplier adjustment');
  if (input.amount === 0) {
    throw new RangeError('An adjustment cannot be zero');
  }
  const note = input.note.trim();
  if (note === '') {
    throw new RangeError('An adjustment needs a note');
  }
  return db.transaction('rw', db.suppliers, db.supplierLedger, db.outbox, async () => {
    await requireSupplier(db, input.supplierId, { active: false });
    return addEntry(
      db,
      { supplierId: input.supplierId, kind: 'adjustment', amount: input.amount, note },
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

async function requireSupplier(
  db: MarketDb,
  supplierId: string,
  { active }: { active: boolean },
): Promise<SupplierRecord> {
  const supplier = await db.suppliers.get(supplierId);
  if (!supplier || (active && supplier.archivedAt)) {
    throw new RecordNotFoundError('Supplier', supplierId);
  }
  return supplier;
}
