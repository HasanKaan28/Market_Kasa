import { businessDate } from '@/domain/businessDate';
import { addAudit, type Actor } from './audit';
import { addCashMovement } from './cash';
import type { MarketDb } from './db';
import { AlreadyReversedError, RecordNotFoundError } from './errors';
import { deriveId } from './ids';
import { appendOutbox } from './outbox';
import { recordPurchase, type PurchaseInput } from './purchases';
import { withoutUndefined } from './records';
import { recordStockMovement } from './stock';
import { addEntry, recordSupplierPayment, type SupplierPaymentInput } from './supplierLedger';
import type { PurchaseRecord, PurchaseVoidRecord, SupplierLedgerRecord } from './types';

/*
 * A goods receipt or a supplier payment typed wrong is never edited or deleted: it is taken back
 * by counter-entries (DESIGN §6.1), and a correction is that reversal plus the right record, in
 * one transaction. The ids of a reversal's records come from what it reverses, as a sale's void
 * does, so the same reversal made on two registers before they synced is one reversal.
 */

/** Why a correction reversed the old record, when nobody typed a reason. */
const CORRECTION_REASON = 'Düzeltme';

export type ReversePurchaseInput = { purchaseId: string; reason: string };

export type CorrectPurchaseInput = {
  purchaseId: string;
  /** The receipt as it should have been; it is recorded as correcting the old one. */
  input: Omit<PurchaseInput, 'correctsId'>;
  reason?: string;
};

export type ReverseSupplierPaymentInput = { entryId: string; reason: string };

export type CorrectSupplierPaymentInput = {
  entryId: string;
  /** The payment as it should have been, to the same supplier. */
  input: Omit<SupplierPaymentInput, 'correctsId' | 'supplierId'> & { supplierId?: string };
  reason?: string;
};

const purchaseTables = (db: MarketDb) => [
  db.purchases,
  db.purchaseVoids,
  db.products,
  db.suppliers,
  db.supplierLedger,
  db.stockMovements,
  db.stockLevels,
  db.cashMovements,
  db.outbox,
  db.meta,
  db.auditLog,
];

const paymentTables = (db: MarketDb) => [
  db.suppliers,
  db.supplierLedger,
  db.cashMovements,
  db.outbox,
  db.meta,
  db.auditLog,
];

/**
 * Takes a goods receipt back in one transaction: the reversal record, a `purchaseVoid` movement
 * per line taking its stock back out, a counter-entry for its invoice when it was on account,
 * and its cash back into this register's drawer when it had been paid from a drawer. The prices
 * the receipt set on its products are left as they are: they may have been sold at since, and
 * a price is changed on the product, by a person, with its own audit entry.
 */
export async function reversePurchase(
  db: MarketDb,
  { purchaseId, reason }: ReversePurchaseInput,
  at: Date,
  actor: Actor,
): Promise<PurchaseVoidRecord> {
  const why = requireReason(reason);
  return db.transaction('rw', purchaseTables(db), async () => {
    const { record, purchase } = await writePurchaseReversal(db, purchaseId, why, at, actor);
    await addAudit(
      db,
      {
        action: 'purchase.reverse',
        entity: 'purchase',
        entityId: purchase.id,
        before: withoutUndefined({ total: purchase.total, invoiceNo: purchase.invoiceNo }),
        after: { reason: why },
      },
      actor,
      at,
    );
    return record;
  });
}

/**
 * Replaces a goods receipt typed wrong: the old one is reversed as `reversePurchase` does and the
 * corrected one recorded as correcting it, all or nothing. A corrected receipt that cannot be
 * saved (a product deleted since, say) leaves the old one standing.
 */
export async function correctPurchase(
  db: MarketDb,
  { purchaseId, input, reason }: CorrectPurchaseInput,
  at: Date,
  actor: Actor,
): Promise<{ reversal: PurchaseVoidRecord; purchase: PurchaseRecord }> {
  const why = reason?.trim() || CORRECTION_REASON;
  return db.transaction('rw', purchaseTables(db), async () => {
    const { record, purchase: old } = await writePurchaseReversal(db, purchaseId, why, at, actor);
    const purchase = await recordPurchase(db, { ...input, correctsId: old.id }, at, actor);
    await addAudit(
      db,
      {
        action: 'purchase.correct',
        entity: 'purchase',
        entityId: old.id,
        before: withoutUndefined({ total: old.total, invoiceNo: old.invoiceNo }),
        after: withoutUndefined({
          total: purchase.total,
          invoiceNo: purchase.invoiceNo,
          purchaseId: purchase.id,
        }),
      },
      actor,
      at,
    );
    return { reversal: record, purchase };
  });
}

/**
 * Takes a supplier payment back in one transaction: a counter-entry putting its amount back on
 * what is owed, marked as reversing it, and its cash back into this register's drawer when it
 * had been paid from a drawer.
 */
export async function reverseSupplierPayment(
  db: MarketDb,
  { entryId, reason }: ReverseSupplierPaymentInput,
  at: Date,
  actor: Actor,
): Promise<SupplierLedgerRecord> {
  const why = requireReason(reason);
  return db.transaction('rw', paymentTables(db), async () => {
    const { counter, payment } = await writePaymentReversal(db, entryId, why, at, actor);
    await addAudit(
      db,
      {
        action: 'supplierPayment.reverse',
        entity: 'supplierLedger',
        entityId: payment.id,
        before: { amount: -payment.amount },
        after: { reason: why },
      },
      actor,
      at,
    );
    return counter;
  });
}

/** Replaces a supplier payment typed wrong: the old one reversed, the right one recorded. */
export async function correctSupplierPayment(
  db: MarketDb,
  { entryId, input, reason }: CorrectSupplierPaymentInput,
  at: Date,
  actor: Actor,
): Promise<{ reversal: SupplierLedgerRecord; payment: SupplierLedgerRecord }> {
  const why = reason?.trim() || CORRECTION_REASON;
  return db.transaction('rw', paymentTables(db), async () => {
    const { counter, payment: old } = await writePaymentReversal(db, entryId, why, at, actor);
    const payment = await recordSupplierPayment(
      db,
      { ...input, supplierId: old.supplierId, correctsId: old.id },
      at,
    );
    await addAudit(
      db,
      {
        action: 'supplierPayment.correct',
        entity: 'supplierLedger',
        entityId: old.id,
        before: { amount: -old.amount },
        after: { amount: -payment.amount, entryId: payment.id },
      },
      actor,
      at,
    );
    return { reversal: counter, payment };
  });
}

/** Which of the given goods receipts, or of all of them, have been taken back. */
export async function reversedPurchaseIds(
  db: MarketDb,
  purchaseIds?: readonly string[],
): Promise<Set<string>> {
  const voids =
    purchaseIds === undefined
      ? await db.purchaseVoids.toArray()
      : await db.purchaseVoids.where('purchaseId').anyOf(purchaseIds).toArray();
  return new Set(voids.map((record) => record.purchaseId));
}

/** The supplier's ledger entries that a counter-entry has taken back. */
export async function reversedEntryIds(db: MarketDb, supplierId: string): Promise<Set<string>> {
  const entries = await db.supplierLedger.where('supplierId').equals(supplierId).toArray();
  return new Set(
    entries.flatMap((entry) => (entry.reversesId === undefined ? [] : [entry.reversesId])),
  );
}

function requireReason(reason: string): string {
  const why = reason.trim();
  if (why === '') {
    throw new RangeError('A reversal needs a reason');
  }
  return why;
}

/** The reversal of a receipt and its counter-entries, inside the caller's transaction. */
async function writePurchaseReversal(
  db: MarketDb,
  purchaseId: string,
  reason: string,
  at: Date,
  actor: Actor,
): Promise<{ record: PurchaseVoidRecord; purchase: PurchaseRecord }> {
  const purchase = await db.purchases.get(purchaseId);
  if (!purchase) {
    throw new RecordNotFoundError('Purchase', purchaseId);
  }
  if ((await db.purchaseVoids.where('purchaseId').equals(purchaseId).count()) > 0) {
    throw new AlreadyReversedError('purchase', purchaseId);
  }
  const cutoffMinutes = actor.cutoffMinutes;
  const record: PurchaseVoidRecord = withoutUndefined({
    id: deriveId(purchase.id, 'purchaseVoid'),
    purchaseId: purchase.id,
    reason,
    deviceCode: actor.deviceCode,
    staffId: actor.staffId,
    occurredAt: at.toISOString(),
    businessDate: businessDate(at, { cutoffMinutes }),
  });
  // The reversal goes first, so whatever refers to it is never queued before it.
  await db.purchaseVoids.add(record);
  await appendOutbox(
    db,
    { kind: 'insert', table: 'purchaseVoids', recordId: record.id, record },
    at,
  );
  for (const [index, line] of purchase.lines.entries()) {
    await recordStockMovement(db, {
      id: deriveId(record.id, 'stock', String(index)),
      productId: line.productId,
      delta: -line.qtyMilli,
      kind: 'purchaseVoid',
      refId: record.id,
      at,
      cutoffMinutes,
    });
  }
  const supplier =
    purchase.supplierId === undefined ? undefined : await db.suppliers.get(purchase.supplierId);
  if (purchase.payment === 'on_account' && purchase.supplierId && purchase.total > 0) {
    // The invoice may not have arrived from the register that wrote it yet; its amount is the
    // receipt's total either way, and the counter-entry names the receipt.
    const invoice = (
      await db.supplierLedger.where('supplierId').equals(purchase.supplierId).toArray()
    ).find((entry) => entry.kind === 'invoice' && entry.purchaseId === purchase.id);
    await addEntry(
      db,
      {
        id: deriveId(record.id, 'ledger'),
        supplierId: purchase.supplierId,
        kind: 'adjustment',
        amount: -(invoice?.amount ?? purchase.total),
        purchaseId: purchase.id,
        reversesId: invoice?.id,
        note: reason,
        staffId: actor.staffId,
      },
      at,
      cutoffMinutes,
    );
  }
  // Cash comes back only if it went out of a drawer: a receipt paid from elsewhere has no
  // movement. It goes into the drawer of the register doing the reversal, where it is handed in.
  const paidOut = await drawerPayment(db, purchase.id, purchase.occurredAt);
  if (paidOut) {
    await addCashMovement(
      db,
      {
        id: deriveId(record.id, 'cash'),
        deviceCode: actor.deviceCode,
        kind: 'in',
        amount: paidOut.amount,
        reason: supplier ? `Mal kabul geri alındı · ${supplier.name}` : 'Mal kabul geri alındı',
        refId: record.id,
        staffId: actor.staffId,
        cutoffMinutes,
      },
      at,
    );
  }
  return { record, purchase };
}

/** The reversal of a payment and its cash, inside the caller's transaction. */
async function writePaymentReversal(
  db: MarketDb,
  entryId: string,
  reason: string,
  at: Date,
  actor: Actor,
): Promise<{ counter: SupplierLedgerRecord; payment: SupplierLedgerRecord }> {
  const payment = await db.supplierLedger.get(entryId);
  if (!payment) {
    throw new RecordNotFoundError('Supplier ledger entry', entryId);
  }
  if (payment.kind !== 'payment') {
    throw new RangeError(`Only a payment can be reversed, got ${payment.kind}`);
  }
  if ((await reversedEntryIds(db, payment.supplierId)).has(payment.id)) {
    throw new AlreadyReversedError('supplierPayment', payment.id);
  }
  const counter = await addEntry(
    db,
    {
      id: deriveId(payment.id, 'reverse'),
      supplierId: payment.supplierId,
      kind: 'adjustment',
      // A payment is written negative; taking it back puts the amount back on what is owed.
      amount: -payment.amount,
      reversesId: payment.id,
      note: reason,
      staffId: actor.staffId,
    },
    at,
    actor.cutoffMinutes,
  );
  const paidOut = await drawerPayment(db, payment.id, payment.occurredAt);
  if (paidOut) {
    const supplier = await db.suppliers.get(payment.supplierId);
    await addCashMovement(
      db,
      {
        id: deriveId(counter.id, 'cash'),
        deviceCode: actor.deviceCode,
        kind: 'in',
        amount: paidOut.amount,
        reason: supplier
          ? `Tedarikçi ödemesi geri alındı · ${supplier.name}`
          : 'Tedarikçi ödemesi geri alındı',
        refId: counter.id,
        staffId: actor.staffId,
        cutoffMinutes: actor.cutoffMinutes,
      },
      at,
    );
  }
  return { counter, payment };
}

/**
 * The cash a record took out of a drawer, if it did. That movement was written in the record's
 * own transaction at the same instant, so it is looked up by that time instead of read in full.
 */
async function drawerPayment(db: MarketDb, refId: string, occurredAt: string) {
  const movements = await db.cashMovements.where('occurredAt').equals(occurredAt).toArray();
  return movements.find((movement) => movement.refId === refId && movement.kind === 'out');
}
