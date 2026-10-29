import { businessDate } from '@/domain/businessDate';
import { stockLevel } from '@/domain/ledger';
import { assertSafeInteger } from '@/domain/money';
import type { MarketDb } from './db';
import { newId } from './ids';
import { appendOutbox } from './outbox';
import { withoutUndefined } from './records';
import type { StockMovementKind, StockMovementRecord } from './types';

export type NewStockMovement = {
  /** Set only when the id must be the same on every device (see `deriveId`). */
  id?: string;
  productId: string;
  delta: number;
  kind: StockMovementKind;
  refId?: string;
  at: Date;
  cutoffMinutes?: number;
};

/**
 * Appends a movement and updates the cached level in one transaction. Inside a caller's
 * transaction that covers the same tables, Dexie runs it as part of that transaction.
 */
export async function recordStockMovement(
  db: MarketDb,
  input: NewStockMovement,
): Promise<StockMovementRecord> {
  assertSafeInteger(input.delta, 'Stock delta (thousandths)');
  if (input.delta === 0) {
    throw new RangeError('A stock movement cannot be zero');
  }
  const movement: StockMovementRecord = withoutUndefined({
    id: input.id ?? newId(input.at.getTime()),
    productId: input.productId,
    delta: input.delta,
    kind: input.kind,
    refId: input.refId,
    occurredAt: input.at.toISOString(),
    businessDate: businessDate(input.at, { cutoffMinutes: input.cutoffMinutes }),
  });

  await db.transaction('rw', db.stockMovements, db.stockLevels, db.outbox, async () => {
    await db.stockMovements.add(movement);
    const current = (await db.stockLevels.get(movement.productId))?.qtyMilli ?? 0;
    await db.stockLevels.put({ productId: movement.productId, qtyMilli: current + movement.delta });
    await appendOutbox(
      db,
      { kind: 'insert', table: 'stockMovements', recordId: movement.id, record: movement },
      input.at,
    );
  });
  return movement;
}

/** Current stock in thousandths of a unit, from the cache; 0 when the product has no movements. */
export async function stockOf(db: MarketDb, productId: string): Promise<number> {
  return (await db.stockLevels.get(productId))?.qtyMilli ?? 0;
}

/** Rebuilds the cached level from the movements and returns it. */
export async function recomputeStock(db: MarketDb, productId: string): Promise<number> {
  return db.transaction('rw', db.stockMovements, db.stockLevels, async () => {
    const qtyMilli = stockLevel(
      await db.stockMovements.where('productId').equals(productId).toArray(),
    );
    await db.stockLevels.put({ productId, qtyMilli });
    return qtyMilli;
  });
}
