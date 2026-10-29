import { businessDate } from '@/domain/businessDate';
import { assertSafeInteger, type Kurus } from '@/domain/money';
import { lineTotal, MAX_UNIT_PRICE } from '@/domain/pricing';
import type { MarketDb } from './db';
import { RecordNotFoundError } from './errors';
import { newId } from './ids';
import { appendOutbox } from './outbox';
import { updateProduct, type ProductPatch } from './products';
import { withoutUndefined } from './records';
import { recordStockMovement } from './stock';
import type { ProductRecord, PurchaseLine, PurchaseRecord } from './types';

export type PurchaseInput = {
  deviceCode: string;
  lines: readonly {
    productId: string;
    qtyMilli: number;
    /** The new buy price; the product's own when absent. */
    buyPrice?: Kurus;
    /** A new sell price, set together with the receipt. */
    sellPrice?: Kurus;
  }[];
  note?: string;
  cutoffMinutes?: number;
};

/**
 * Records goods received: the receipt, one `purchase` movement per line and any changed prices,
 * in one transaction. Every line is checked before the first write, so a bad line stops all.
 */
export async function recordPurchase(
  db: MarketDb,
  input: PurchaseInput,
  at: Date,
): Promise<PurchaseRecord> {
  if (input.lines.length === 0) {
    throw new RangeError('A goods receipt needs at least one line');
  }
  const id = newId(at.getTime());
  const tables = [db.purchases, db.products, db.stockMovements, db.stockLevels, db.outbox];
  return db.transaction('rw', tables, async () => {
    const checked: { product: ProductRecord; line: PurchaseLine; patch: ProductPatch }[] = [];
    for (const line of input.lines) {
      const product = await db.products.get(line.productId);
      if (!product || product.deletedAt) {
        throw new RecordNotFoundError('Product', line.productId);
      }
      assertQuantity(line.qtyMilli, product.unit);
      const buyPrice = line.buyPrice ?? product.buyPrice;
      assertPrice(buyPrice);
      if (line.sellPrice !== undefined) {
        assertPrice(line.sellPrice);
      }
      const patch: ProductPatch = {};
      if (line.buyPrice !== undefined && line.buyPrice !== product.buyPrice) {
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
          cost: lineTotal(line.qtyMilli, buyPrice),
        },
      });
    }

    const record: PurchaseRecord = withoutUndefined({
      id,
      deviceCode: input.deviceCode,
      lines: checked.map(({ line }) => line),
      total: checked.reduce((sum, { line }) => sum + line.cost, 0),
      note: input.note?.trim() || undefined,
      occurredAt: at.toISOString(),
      businessDate: businessDate(at, { cutoffMinutes: input.cutoffMinutes }),
    });
    // The receipt goes first, so whatever refers to it is never queued before it.
    await db.purchases.add(record);
    await appendOutbox(db, { kind: 'insert', table: 'purchases', recordId: id, record }, at);
    for (const { product, line, patch } of checked) {
      if (Object.keys(patch).length > 0) {
        await updateProduct(db, product.id, patch, at);
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
    return record;
  });
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
