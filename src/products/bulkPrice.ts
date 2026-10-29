import type { Actor } from '@/data/audit';
import type { MarketDb } from '@/data/db';
import { updateProduct } from '@/data/products';
import { divRoundHalfUp, formatTRY, type Kurus } from '@/domain/money';
import { MAX_UNIT_PRICE } from '@/domain/pricing';

/**
 * A change to one price of many products. `value` is signed: thousandths for a percentage
 * (10% is 100), kuruş for an amount. `roundTo` is the step in kuruş the result is rounded to.
 */
export type PriceChange = {
  target: 'sellPrice' | 'buyPrice';
  by: 'percent' | 'amount';
  value: number;
  roundTo: 0 | 25 | 50 | 100;
};

/** The new price: never below zero; above the limit is refused rather than cut. */
export function changedPrice(price: Kurus, change: PriceChange): Kurus {
  const raw =
    change.by === 'percent'
      ? price + divRoundHalfUp(price * change.value, 1000)
      : price + change.value;
  const rounded = change.roundTo === 0 ? raw : divRoundHalfUp(raw, change.roundTo) * change.roundTo;
  const next = Math.max(0, rounded);
  if (next > MAX_UNIT_PRICE) {
    throw new RangeError(`A price cannot exceed ${formatTRY(MAX_UNIT_PRICE)}`);
  }
  return next;
}

/**
 * Applies the change to the live products among `productIds` in one transaction, so a price that
 * would pass the limit stops them all. Returns how many prices changed.
 */
export async function bulkUpdatePrices(
  db: MarketDb,
  productIds: readonly string[],
  change: PriceChange,
  at: Date,
  actor?: Actor,
): Promise<number> {
  const tables = [db.products, db.outbox, ...(actor ? [db.auditLog] : [])];
  return db.transaction('rw', tables, async () => {
    let changed = 0;
    for (const id of productIds) {
      const product = await db.products.get(id);
      // An unknown buy price (₺0) stays unknown; a change to it would invent one.
      if (!product || product.deletedAt || unknownBuyPrice(product, change.target)) {
        continue;
      }
      const next = changedPrice(product[change.target], change);
      if (next !== product[change.target]) {
        await updateProduct(db, id, { [change.target]: next }, at, actor);
        changed += 1;
      }
    }
    return changed;
  });
}

/** A buy price of ₺0 means nobody entered one. */
export function unknownBuyPrice(
  product: { buyPrice: Kurus },
  target: PriceChange['target'],
): boolean {
  return target === 'buyPrice' && product.buyPrice === 0;
}
