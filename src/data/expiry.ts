import type { MarketDb } from './db';
import type { ProductUnit } from './types';

/** One delivery with a son kullanma tarihi, and how much of it is likely still on the shelf. */
export type ExpiringLot = {
  productId: string;
  name: string;
  unit: ProductUnit;
  expiresOn: string;
  receivedAt: string;
  receivedMilli: number;
  /** An estimate: the oldest delivery is taken to be sold first. */
  remainingMilli: number;
  /** Negative once the date has passed. */
  daysLeft: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/**
 * Deliveries that expire within `withinDays` of `today` (or already have) and are likely still
 * on the shelf, the soonest first. What is on the shelf is the product's stock now, filled from
 * its newest deliveries back: whatever stock the newer ones do not cover is from the older ones.
 */
export async function expiringLots(
  db: MarketDb,
  today: string,
  withinDays = 30,
): Promise<ExpiringLot[]> {
  const [purchases, products, levels] = await Promise.all([
    db.purchases.toArray(),
    db.products.toArray(),
    db.stockLevels.toArray(),
  ]);
  const live = new Map(
    products.filter((product) => !product.deletedAt).map((product) => [product.id, product]),
  );
  const stock = new Map(levels.map((level) => [level.productId, level.qtyMilli]));

  const deliveries = new Map<string, { at: string; qtyMilli: number; expiresOn?: string }[]>();
  for (const purchase of purchases) {
    for (const line of purchase.lines) {
      if (!live.has(line.productId)) {
        continue;
      }
      const list = deliveries.get(line.productId) ?? [];
      list.push({
        at: purchase.occurredAt,
        qtyMilli: line.qtyMilli,
        ...(line.expiresOn ? { expiresOn: line.expiresOn } : {}),
      });
      deliveries.set(line.productId, list);
    }
  }

  const lots: ExpiringLot[] = [];
  for (const [productId, list] of deliveries) {
    const product = live.get(productId);
    if (!product) {
      continue;
    }
    let shelf = Math.max(0, stock.get(productId) ?? 0);
    for (const delivery of [...list].sort((a, b) => b.at.localeCompare(a.at))) {
      const remainingMilli = Math.min(delivery.qtyMilli, shelf);
      shelf -= remainingMilli;
      if (!delivery.expiresOn || remainingMilli <= 0) {
        continue;
      }
      const daysLeft = daysBetween(today, delivery.expiresOn);
      if (daysLeft > withinDays) {
        continue;
      }
      lots.push({
        productId,
        name: product.name,
        unit: product.unit,
        expiresOn: delivery.expiresOn,
        receivedAt: delivery.at,
        receivedMilli: delivery.qtyMilli,
        remainingMilli,
        daysLeft,
      });
    }
  }
  return lots.sort(
    (a, b) => a.expiresOn.localeCompare(b.expiresOn) || a.name.localeCompare(b.name, 'tr'),
  );
}
