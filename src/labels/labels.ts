import type { MarketDb } from '@/data/db';
import type { ProductRecord } from '@/data/types';

/** A shelf label (name, price, day) or a barcode label (bars, name, price). */
export type LabelKind = 'shelf' | 'barcode';

export type LabelItem = { product: ProductRecord; copies: number };

/** Ten A4 sheets of 24: more is surely a mistyped count. */
export const MAX_LABELS = 240;

/**
 * The products whose price changed on `day` (a business day, `YYYY-MM-DD`), each once, by name:
 * the shelf labels to renew. Read from the price changes on record, so it covers every register.
 */
export async function priceChangedOn(db: MarketDb, day: string): Promise<ProductRecord[]> {
  const changes = await db.auditLog
    .filter((entry) => entry.action === 'product.price' && entry.businessDate === day)
    .toArray();
  const ids = [
    ...new Set(
      changes.map((entry) => entry.entityId).filter((id): id is string => id !== undefined),
    ),
  ];
  const products = await db.products.bulkGet(ids);
  return products
    .filter((product): product is ProductRecord => !!product && !product.deletedAt)
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}

/** One product per label to print, in order, no more than `MAX_LABELS`. */
export function expandLabels(items: readonly LabelItem[]): ProductRecord[] {
  return items
    .flatMap(({ product, copies }) => Array.from({ length: Math.max(0, copies) }, () => product))
    .slice(0, MAX_LABELS);
}
