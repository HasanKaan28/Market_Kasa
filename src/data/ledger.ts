import { businessDate } from '@/domain/businessDate';
import type { LedgerKind } from '@/domain/ledger';
import { assertSafeInteger, type Kurus } from '@/domain/money';
import { addCashMovement } from './cash';
import type { MarketDb } from './db';
import { RecordNotFoundError } from './errors';
import { newId } from './ids';
import { appendOutbox } from './outbox';
import { withoutUndefined } from './records';
import type { CustomerRecord, LedgerMethod, LedgerRecord } from './types';

export type NewLedgerEntry = {
  /** Set only when the id must be the same on every device (see `deriveId`). */
  id?: string;
  customerId: string;
  kind: LedgerKind;
  /** Signed: debts positive, payments negative, adjustments either way. */
  amount: Kurus;
  method?: LedgerMethod;
  saleId?: string;
  note?: string;
  staffId?: string;
  cutoffMinutes?: number;
};

export type PaymentInput = {
  /** The register that took it: a cash payment goes into its drawer. */
  deviceCode: string;
  customerId: string;
  /** What was paid, above zero; written on the ledger as a negative amount. */
  amount: Kurus;
  method: LedgerMethod;
  note?: string;
  staffId?: string;
  cutoffMinutes?: number;
};

export type AdjustmentInput = {
  customerId: string;
  /** Signed: a positive amount adds to the debt, a negative one takes it off. */
  amount: Kurus;
  /** Why, always: an adjustment without a reason cannot be checked later. */
  note: string;
  staffId?: string;
  cutoffMinutes?: number;
};

const METHODS: readonly LedgerMethod[] = ['cash', 'card'];

/** Writes one entry on a customer's ledger and queues it; runs inside the caller's transaction. */
export async function addLedgerEntry(
  db: MarketDb,
  entry: NewLedgerEntry,
  at: Date,
): Promise<LedgerRecord> {
  assertSafeInteger(entry.amount, 'Ledger amount');
  const record: LedgerRecord = withoutUndefined({
    id: entry.id ?? newId(at.getTime()),
    customerId: entry.customerId,
    kind: entry.kind,
    amount: entry.amount,
    method: entry.method,
    saleId: entry.saleId,
    note: entry.note,
    staffId: entry.staffId,
    occurredAt: at.toISOString(),
    businessDate: businessDate(at, { cutoffMinutes: entry.cutoffMinutes }),
  });
  await db.ledger.add(record);
  await appendOutbox(db, { kind: 'insert', table: 'ledger', recordId: record.id, record }, at);
  return record;
}

/**
 * Takes a payment from a customer, in cash or by card, in one transaction; cash goes into the
 * register's drawer as a cash movement in the same transaction. An archived customer who still
 * owes (a return or another register's sale after archiving) can pay too.
 */
export async function recordPayment(
  db: MarketDb,
  input: PaymentInput,
  at: Date,
): Promise<LedgerRecord> {
  assertSafeInteger(input.amount, 'Payment');
  if (input.amount <= 0) {
    throw new RangeError(`A payment must be above zero, got ${input.amount}`);
  }
  if (!METHODS.includes(input.method)) {
    throw new RangeError(`A payment is made in cash or by card, got ${String(input.method)}`);
  }
  const tables = [db.customers, db.ledger, db.cashMovements, db.outbox, db.meta];
  return db.transaction('rw', tables, async () => {
    const customer = await requireCustomer(db, input.customerId);
    const entry = await addLedgerEntry(
      db,
      {
        customerId: input.customerId,
        kind: 'payment',
        amount: -input.amount,
        method: input.method,
        note: input.note?.trim() || undefined,
        staffId: input.staffId,
        cutoffMinutes: input.cutoffMinutes,
      },
      at,
    );
    if (input.method === 'cash') {
      await addCashMovement(
        db,
        {
          deviceCode: input.deviceCode,
          kind: 'in',
          amount: input.amount,
          reason: `Tahsilat · ${customer.name}`,
          refId: entry.id,
          staffId: input.staffId,
          cutoffMinutes: input.cutoffMinutes,
        },
        at,
      );
    }
    return entry;
  });
}

/** Adds to or takes off a customer's debt by hand, with the reason, in one transaction. */
export async function recordAdjustment(
  db: MarketDb,
  input: AdjustmentInput,
  at: Date,
): Promise<LedgerRecord> {
  assertSafeInteger(input.amount, 'Adjustment');
  if (input.amount === 0) {
    throw new RangeError('An adjustment cannot be zero');
  }
  const note = input.note.trim();
  if (note === '') {
    throw new RangeError('An adjustment needs a note');
  }
  return db.transaction('rw', db.customers, db.ledger, db.outbox, async () => {
    await requireCustomer(db, input.customerId);
    return addLedgerEntry(
      db,
      {
        customerId: input.customerId,
        kind: 'adjustment',
        amount: input.amount,
        note,
        staffId: input.staffId,
        cutoffMinutes: input.cutoffMinutes,
      },
      at,
    );
  });
}

async function requireCustomer(db: MarketDb, customerId: string): Promise<CustomerRecord> {
  const customer = await db.customers.get(customerId);
  if (!customer) {
    throw new RecordNotFoundError('Customer', customerId);
  }
  return customer;
}
