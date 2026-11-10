import { businessDate } from '@/domain/businessDate';
import { assertSafeInteger, type Kurus } from '@/domain/money';
import { refundShare } from '@/domain/returns';
import type { MarketDb } from './db';
import { RecordNotFoundError, ReturnExceedsSaleError, SaleVoidedError } from './errors';
import { newId } from './ids';
import { addLedgerEntry } from './ledger';
import { appendOutbox } from './outbox';
import { recordStockMovement } from './stock';
import type { Payment, PaymentMethod, ReturnLine, ReturnRecord, SaleRecord } from './types';
import { isVoided } from './voids';

export type ReturnInput = {
  saleId: string;
  lines: { productId: string; qtyMilli: number }[];
  deviceCode: string;
  /** Who does it, for the record. */
  staffId?: string;
  at: Date;
  cutoffMinutes?: number;
};

// Debt is cleared first, then the card, and cash leaves the drawer last.
const REFUND_ORDER: readonly PaymentMethod[] = ['credit', 'card', 'cash'];

/**
 * How a refund goes back: the way the sale was paid, each method at most what it brought in
 * minus what earlier returns already gave back that way. Throws when the methods cannot cover it.
 */
export function planRefund(
  payments: readonly Payment[],
  earlierRefunds: readonly Payment[],
  amount: Kurus,
): Payment[] {
  const total = (list: readonly Payment[], method: PaymentMethod) =>
    list.filter((payment) => payment.method === method).reduce((sum, p) => sum + p.amount, 0);
  let rest = amount;
  const plan: Payment[] = [];
  for (const method of REFUND_ORDER) {
    const share = Math.min(
      rest,
      Math.max(0, total(payments, method) - total(earlierRefunds, method)),
    );
    if (share > 0) {
      plan.push({ method, amount: share });
      rest -= share;
    }
  }
  if (rest > 0) {
    throw new RangeError(`Cannot refund ${amount}: only ${amount - rest} is left to give back`);
  }
  return plan;
}

/** The refunds of earlier returns; returns stored before refunds were split carry one method. */
export function refundsOf(records: readonly ReturnRecord[]): Payment[] {
  return records.flatMap((record) => {
    if (Array.isArray(record.refunds)) {
      return record.refunds;
    }
    const legacy = (record as { refundMethod?: PaymentMethod }).refundMethod;
    return legacy ? [{ method: legacy, amount: record.amount }] : [];
  });
}

/** What has been returned from a sale so far, per product, in thousandths of a unit. */
export async function returnedQuantities(
  db: MarketDb,
  saleId: string,
): Promise<Map<string, number>> {
  return quantitiesOf(await db.returns.where('saleId').equals(saleId).toArray());
}

/** Per product, what the given returns took back, in thousandths of a unit. */
export function quantitiesOf(records: readonly ReturnRecord[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const record of records) {
    for (const line of record.lines) {
      totals.set(line.productId, (totals.get(line.productId) ?? 0) + line.qtyMilli);
    }
  }
  return totals;
}

export type SaleStatus = {
  voided: boolean;
  returned: Map<string, number>;
  /**
   * Two devices acted on the sale before they synced: it was voided and also returned, or more
   * was returned than sold. Every record stays (the money changed hands); a person must check.
   */
  conflict: boolean;
};

export async function saleStatus(db: MarketDb, saleId: string): Promise<SaleStatus> {
  const voided = await isVoided(db, saleId);
  const returned = await returnedQuantities(db, saleId);
  const sale = await db.sales.get(saleId);
  const overReturned =
    sale !== undefined &&
    [...returned].some(([productId, qtyMilli]) => {
      const sold = sale.lines
        .filter((line) => line.productId === productId)
        .reduce((sum, line) => sum + line.qtyMilli, 0);
      return qtyMilli > sold;
    });
  return { voided, returned, conflict: (voided && returned.size > 0) || overReturned };
}

/**
 * Takes goods back against a receipt in one transaction: the return record, a stock movement per
 * line, and for a credit refund an adjustment lowering the customer's debt. Each line's money is
 * its share of the sold line, so all partial returns of a line add up to exactly what was paid.
 */
export async function recordReturn(db: MarketDb, input: ReturnInput): Promise<ReturnRecord> {
  if (input.lines.length === 0) {
    throw new RangeError('A return needs at least one line');
  }
  const productIds = input.lines.map((line) => line.productId);
  if (new Set(productIds).size !== productIds.length) {
    throw new RangeError('A product can appear only once in a return');
  }
  const tables = [
    db.sales,
    db.saleVoids,
    db.returns,
    db.stockMovements,
    db.stockLevels,
    db.ledger,
    db.outbox,
  ];
  return db.transaction('rw', tables, async () => {
    const sale = await db.sales.get(input.saleId);
    if (!sale) {
      throw new RecordNotFoundError('Sale', input.saleId);
    }
    if (await isVoided(db, sale.id)) {
      throw new SaleVoidedError(sale.receiptNo);
    }
    const earlier = await db.returns.where('saleId').equals(sale.id).toArray();
    const lines = returnLines(sale, input.lines, quantitiesOf(earlier));
    const amount = lines.reduce((sum, line) => sum + line.net, 0);
    const refunds = planRefund(sale.payments, refundsOf(earlier), amount);
    const record: ReturnRecord = {
      id: newId(input.at.getTime()),
      saleId: sale.id,
      deviceCode: input.deviceCode,
      ...(input.staffId ? { staffId: input.staffId } : {}),
      lines,
      refunds,
      amount,
      vat: lines.reduce((sum, line) => sum + line.vat, 0),
      occurredAt: input.at.toISOString(),
      businessDate: businessDate(input.at, { cutoffMinutes: input.cutoffMinutes }),
    };
    await db.returns.add(record);
    await appendOutbox(
      db,
      { kind: 'insert', table: 'returns', recordId: record.id, record },
      input.at,
    );
    for (const line of lines) {
      await recordStockMovement(db, {
        productId: line.productId,
        delta: line.qtyMilli,
        kind: 'return',
        refId: record.id,
        at: input.at,
        cutoffMinutes: input.cutoffMinutes,
      });
    }
    const credit = refunds.find((refund) => refund.method === 'credit')?.amount ?? 0;
    if (credit > 0 && sale.customerId) {
      await addLedgerEntry(
        db,
        {
          customerId: sale.customerId,
          kind: 'adjustment',
          amount: -credit,
          saleId: sale.id,
          note: 'İade',
          staffId: input.staffId,
          cutoffMinutes: input.cutoffMinutes,
        },
        input.at,
      );
    }
    return record;
  });
}

function returnLines(
  sale: SaleRecord,
  requested: ReturnInput['lines'],
  returned: ReadonlyMap<string, number>,
): ReturnLine[] {
  return requested.map(({ productId, qtyMilli }) => {
    assertSafeInteger(qtyMilli, 'Return quantity (thousandths)');
    if (qtyMilli <= 0) {
      throw new RangeError(`A return line needs a positive quantity, got ${qtyMilli}`);
    }
    const sold = sale.lines.find((line) => line.productId === productId);
    if (!sold) {
      throw new RangeError(`Product ${productId} is not on sale ${sale.receiptNo}`);
    }
    const already = returned.get(productId) ?? 0;
    if (already + qtyMilli > sold.qtyMilli) {
      throw new ReturnExceedsSaleError(sale.receiptNo, productId);
    }
    return {
      productId,
      name: sold.name,
      qtyMilli,
      net: refundShare(sold.net, sold.qtyMilli, already, qtyMilli),
      vat: refundShare(sold.vat, sold.qtyMilli, already, qtyMilli),
    };
  });
}
