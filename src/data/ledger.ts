import { businessDate } from '@/domain/businessDate';
import type { LedgerKind } from '@/domain/ledger';
import { assertSafeInteger, type Kurus } from '@/domain/money';
import type { MarketDb } from './db';
import { newId } from './ids';
import { appendOutbox } from './outbox';
import { withoutUndefined } from './records';
import type { LedgerRecord } from './types';

export type NewLedgerEntry = {
  /** Set only when the id must be the same on every device (see `deriveId`). */
  id?: string;
  customerId: string;
  kind: LedgerKind;
  /** Signed: debts positive, payments negative, adjustments either way. */
  amount: Kurus;
  saleId?: string;
  note?: string;
  cutoffMinutes?: number;
};

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
    saleId: entry.saleId,
    note: entry.note,
    occurredAt: at.toISOString(),
    businessDate: businessDate(at, { cutoffMinutes: entry.cutoffMinutes }),
  });
  await db.ledger.add(record);
  await appendOutbox(db, { kind: 'insert', table: 'ledger', recordId: record.id, record }, at);
  return record;
}
