import { businessDate } from '@/domain/businessDate';
import { assertSafeInteger } from '@/domain/money';
import { refundShare } from '@/domain/returns';
import type { MarketDb } from './db';
import { RecordNotFoundError, ReturnExceedsSaleError, SaleVoidedError } from './errors';
import { newId } from './ids';
import { addLedgerEntry } from './ledger';
import { appendOutbox } from './outbox';
import { recordStockMovement } from './stock';
import type { PaymentMethod, ReturnLine, ReturnRecord, SaleRecord } from './types';
import { isVoided } from './voids';

export type ReturnInput = {
  saleId: string;
  lines: { productId: string; qtyMilli: number }[];
  refundMethod: PaymentMethod;
  deviceCode: string;
  at: Date;
  cutoffMinutes?: number;
};

/** What has been returned from a sale so far, per product, in thousandths of a unit. */
export async function returnedQuantities(
  db: MarketDb,
  saleId: string,
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  for (const record of await db.returns.where('saleId').equals(saleId).toArray()) {
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
    if (!sale.payments.some((payment) => payment.method === input.refundMethod)) {
      throw new RangeError(`Sale ${sale.receiptNo} was not paid by ${input.refundMethod}`);
    }
    const lines = returnLines(sale, input.lines, await returnedQuantities(db, sale.id));
    const record: ReturnRecord = {
      id: newId(input.at.getTime()),
      saleId: sale.id,
      deviceCode: input.deviceCode,
      lines,
      refundMethod: input.refundMethod,
      amount: lines.reduce((sum, line) => sum + line.net, 0),
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
    if (input.refundMethod === 'credit' && sale.customerId && record.amount > 0) {
      await addLedgerEntry(
        db,
        {
          customerId: sale.customerId,
          kind: 'adjustment',
          amount: -record.amount,
          saleId: sale.id,
          note: 'İade',
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
