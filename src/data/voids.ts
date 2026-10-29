import { businessDate } from '@/domain/businessDate';
import type { MarketDb } from './db';
import { RecordNotFoundError, SaleReturnedError, SaleVoidedError } from './errors';
import { deriveId } from './ids';
import { addLedgerEntry } from './ledger';
import { appendOutbox } from './outbox';
import { recordStockMovement } from './stock';
import type { SaleVoidRecord } from './types';

export type VoidSaleInput = {
  saleId: string;
  reason: string;
  deviceCode: string;
  /** Who does it, for the record. */
  staffId?: string;
  at: Date;
  cutoffMinutes?: number;
};

/**
 * Cancels a whole sale in one transaction: the void record, a stock movement putting each line
 * back, and an adjustment taking the credit part off the customer's ledger. A sale is voided at
 * most once, and never after goods from it were returned.
 */
export async function voidSale(db: MarketDb, input: VoidSaleInput): Promise<SaleVoidRecord> {
  const reason = input.reason.trim();
  if (reason === '') {
    throw new RangeError('A void needs a reason');
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
    if ((await db.returns.where('saleId').equals(sale.id).count()) > 0) {
      throw new SaleReturnedError(sale.receiptNo);
    }
    // Ids come from the sale: a void made on two devices before they synced is one void.
    const record: SaleVoidRecord = {
      id: deriveId(sale.id, 'void'),
      saleId: sale.id,
      reason,
      deviceCode: input.deviceCode,
      ...(input.staffId ? { staffId: input.staffId } : {}),
      occurredAt: input.at.toISOString(),
      businessDate: businessDate(input.at, { cutoffMinutes: input.cutoffMinutes }),
    };
    await db.saleVoids.add(record);
    await appendOutbox(
      db,
      { kind: 'insert', table: 'saleVoids', recordId: record.id, record },
      input.at,
    );
    for (const [index, line] of sale.lines.entries()) {
      await recordStockMovement(db, {
        id: deriveId(record.id, 'stock', String(index)),
        productId: line.productId,
        delta: line.qtyMilli,
        kind: 'void',
        refId: record.id,
        at: input.at,
        cutoffMinutes: input.cutoffMinutes,
      });
    }
    const credit = sale.payments
      .filter((payment) => payment.method === 'credit')
      .reduce((sum, payment) => sum + payment.amount, 0);
    if (credit > 0 && sale.customerId) {
      await addLedgerEntry(
        db,
        {
          id: deriveId(record.id, 'ledger'),
          customerId: sale.customerId,
          kind: 'adjustment',
          amount: -credit,
          saleId: sale.id,
          note: 'Satış iptali',
          staffId: input.staffId,
          cutoffMinutes: input.cutoffMinutes,
        },
        input.at,
      );
    }
    return record;
  });
}

export async function isVoided(db: MarketDb, saleId: string): Promise<boolean> {
  return (await db.saleVoids.where('saleId').equals(saleId).count()) > 0;
}
