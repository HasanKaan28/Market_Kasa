import { businessDate } from '@/domain/businessDate';
import { assertSafeInteger, type Kurus } from '@/domain/money';
import { lineTotal, MAX_UNIT_PRICE } from '@/domain/pricing';
import type { Actor } from './audit';
import { addCashMovement } from './cash';
import type { MarketDb } from './db';
import { RecordNotFoundError } from './errors';
import { newId } from './ids';
import { appendOutbox } from './outbox';
import { updateProduct, type ProductPatch } from './products';
import { withoutUndefined } from './records';
import { recordStockMovement } from './stock';
import { addSupplierInvoice } from './supplierLedger';
import type { ProductRecord, PurchaseLine, PurchasePayment, PurchaseRecord } from './types';

export type PurchaseInput = {
  deviceCode: string;
  lines: readonly {
    productId: string;
    qtyMilli: number;
    /** The new buy price; the product's own when absent. */
    buyPrice?: Kurus;
    /** A new sell price, set together with the receipt. */
    sellPrice?: Kurus;
    /** Came free: costs nothing and leaves the buy price as it is. A buy price of 0 is the same. */
    free?: boolean;
    /**
     * The line's cost when the invoice works it out otherwise than quantity × buy price: VAT
     * added to the line total, as a VAT-exclusive invoice does.
     */
    cost?: Kurus;
  }[];
  /** Who delivered; needed when the delivery is owed (`on_account`). */
  supplierId?: string;
  invoiceNo?: string;
  /** Cash when not said. */
  payment?: PurchasePayment;
  /** A cash payment came out of the register's drawer; false when paid from elsewhere. */
  fromDrawer?: boolean;
  note?: string;
  staffId?: string;
  cutoffMinutes?: number;
};

/**
 * Records goods received: the receipt, one `purchase` movement per line and any changed prices,
 * in one transaction. Every line is checked before the first write, so a bad line stops all. A
 * delivery on account also writes its invoice on the supplier's ledger, in the same transaction.
 */
export async function recordPurchase(
  db: MarketDb,
  input: PurchaseInput,
  at: Date,
  actor?: Actor,
): Promise<PurchaseRecord> {
  if (input.lines.length === 0) {
    throw new RangeError('A goods receipt needs at least one line');
  }
  const payment = input.payment ?? 'cash';
  if (payment === 'on_account' && !input.supplierId) {
    throw new RangeError('A delivery on account needs its supplier');
  }
  const id = newId(at.getTime());
  const tables = [
    db.purchases,
    db.products,
    db.stockMovements,
    db.stockLevels,
    db.suppliers,
    db.supplierLedger,
    db.cashMovements,
    db.outbox,
    db.meta,
    // A price changed by a person is logged (see updateProduct).
    ...(actor ? [db.auditLog] : []),
  ];
  return db.transaction('rw', tables, async () => {
    const supplier =
      input.supplierId === undefined ? undefined : await db.suppliers.get(input.supplierId);
    if (input.supplierId !== undefined && (!supplier || supplier.archivedAt)) {
      throw new RecordNotFoundError('Supplier', input.supplierId);
    }
    const checked: { product: ProductRecord; line: PurchaseLine; patch: ProductPatch }[] = [];
    for (const line of input.lines) {
      const product = await db.products.get(line.productId);
      if (!product || product.deletedAt) {
        throw new RecordNotFoundError('Product', line.productId);
      }
      assertQuantity(line.qtyMilli, product.unit);
      // A buy price typed as nothing is free goods: a receipt never sets a buy price to 0.
      const free = line.free === true || line.buyPrice === 0;
      const buyPrice = free ? 0 : (line.buyPrice ?? product.buyPrice);
      assertPrice(buyPrice);
      if (line.sellPrice !== undefined) {
        assertPrice(line.sellPrice);
      }
      const patch: ProductPatch = {};
      if (!free && line.buyPrice !== undefined && line.buyPrice !== product.buyPrice) {
        patch.buyPrice = line.buyPrice;
      }
      if (line.sellPrice !== undefined && line.sellPrice !== product.sellPrice) {
        patch.sellPrice = line.sellPrice;
      }
      checked.push({
        product,
        patch,
        line: {
          productId: product.id,
          name: product.name,
          unit: product.unit,
          qtyMilli: line.qtyMilli,
          buyPrice,
          cost: free ? 0 : lineCost(line.cost, line.qtyMilli, buyPrice),
          ...(free ? { free: true } : {}),
        },
      });
    }

    const record: PurchaseRecord = withoutUndefined({
      id,
      deviceCode: input.deviceCode,
      lines: checked.map(({ line }) => line),
      total: checked.reduce((sum, { line }) => sum + line.cost, 0),
      supplierId: input.supplierId,
      invoiceNo: input.invoiceNo?.trim() || undefined,
      payment,
      note: input.note?.trim() || undefined,
      staffId: input.staffId,
      occurredAt: at.toISOString(),
      businessDate: businessDate(at, { cutoffMinutes: input.cutoffMinutes }),
    });
    // The receipt goes first, so whatever refers to it is never queued before it.
    await db.purchases.add(record);
    await appendOutbox(db, { kind: 'insert', table: 'purchases', recordId: id, record }, at);
    for (const { product, line, patch } of checked) {
      if (Object.keys(patch).length > 0) {
        await updateProduct(db, product.id, patch, at, actor);
      }
      await recordStockMovement(db, {
        productId: product.id,
        delta: line.qtyMilli,
        kind: 'purchase',
        refId: id,
        at,
        cutoffMinutes: input.cutoffMinutes,
      });
    }
    // Paid in cash, it comes out of the register's drawer; free goods alone take nothing out.
    if (payment === 'cash' && record.total > 0 && input.fromDrawer !== false) {
      await addCashMovement(
        db,
        {
          deviceCode: input.deviceCode,
          kind: 'out',
          amount: record.total,
          reason: supplier ? `Mal kabul · ${supplier.name}` : 'Mal kabul',
          refId: id,
          staffId: input.staffId,
          cutoffMinutes: input.cutoffMinutes,
        },
        at,
      );
    }
    // Free goods alone owe nothing, so they write no invoice.
    if (payment === 'on_account' && input.supplierId && record.total > 0) {
      await addSupplierInvoice(
        db,
        {
          supplierId: input.supplierId,
          amount: record.total,
          purchaseId: id,
          note: record.invoiceNo,
          staffId: input.staffId,
          cutoffMinutes: input.cutoffMinutes,
        },
        at,
      );
    }
    return record;
  });
}

/** The cost a line was given, checked, or quantity × buy price. */
function lineCost(given: Kurus | undefined, qtyMilli: number, buyPrice: Kurus): Kurus {
  if (given === undefined) {
    return lineTotal(qtyMilli, buyPrice);
  }
  assertSafeInteger(given, 'Line cost');
  if (given < 0) {
    throw new RangeError(`A line cost cannot be below zero, got ${given}`);
  }
  return given;
}

/** More than nothing, and whole pieces for a piece product. */
function assertQuantity(qtyMilli: number, unit: ProductRecord['unit']): void {
  assertSafeInteger(qtyMilli, 'Quantity (thousandths)');
  if (qtyMilli <= 0) {
    throw new RangeError(`A received quantity must be more than zero, got ${qtyMilli}`);
  }
  if (unit === 'piece' && qtyMilli % 1000 !== 0) {
    throw new RangeError('A piece product takes whole quantities');
  }
}

function assertPrice(price: Kurus): void {
  assertSafeInteger(price, 'Price');
  if (price < 0 || price > MAX_UNIT_PRICE) {
    throw new RangeError(`A price must be between 0 and ${MAX_UNIT_PRICE}, got ${price}`);
  }
}
