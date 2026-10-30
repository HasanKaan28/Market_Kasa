import Dexie from 'dexie';
import { businessDate } from '@/domain/businessDate';
import { stockLevel } from '@/domain/ledger';
import { assertSafeInteger } from '@/domain/money';
import type { MarketDb } from './db';
import { RecordNotFoundError } from './errors';
import { newId } from './ids';
import { appendOutbox } from './outbox';
import { withoutUndefined } from './records';
import type { StockMovementKind, StockMovementRecord } from './types';

const DEFAULT_MOVEMENT_LIMIT = 200;

export type NewStockMovement = {
  /** Set only when the id must be the same on every device (see `deriveId`). */
  id?: string;
  productId: string;
  delta: number;
  kind: StockMovementKind;
  refId?: string;
  note?: string;
  staffId?: string;
  at: Date;
  cutoffMinutes?: number;
};

export type AdjustReason = 'waste' | 'damaged' | 'lost' | 'found' | 'other';

export const ADJUST_REASONS: Record<AdjustReason, string> = {
  waste: 'Fire',
  damaged: 'Bozuk / SKT geçmiş',
  lost: 'Kayıp',
  found: 'Bulunan',
  other: 'Diğer',
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
    note: input.note,
    staffId: input.staffId,
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

/**
 * Changes a product's stock by a signed difference, with its reason. A difference, not a new
 * total: two registers' adjustments add up, so neither is lost.
 */
export async function adjustStock(
  db: MarketDb,
  input: {
    productId: string;
    deltaMilli: number;
    reason: AdjustReason;
    note?: string;
    staffId?: string;
    cutoffMinutes?: number;
  },
  at: Date,
): Promise<StockMovementRecord> {
  return db.transaction(
    'rw',
    db.products,
    db.stockMovements,
    db.stockLevels,
    db.outbox,
    async () => {
      const product = await db.products.get(input.productId);
      if (!product || product.deletedAt) {
        throw new RecordNotFoundError('Product', input.productId);
      }
      // A fraction only to make a fractional piece stock whole: two registers can leave one
      // behind when one sells by weight offline while the other switches the unit to pieces.
      if (
        product.unit === 'piece' &&
        input.deltaMilli % 1000 !== 0 &&
        ((await stockOf(db, product.id)) + input.deltaMilli) % 1000 !== 0
      ) {
        throw new RangeError('A piece product takes whole quantities');
      }
      const note = input.note?.trim();
      return recordStockMovement(db, {
        productId: input.productId,
        delta: input.deltaMilli,
        kind: 'manual',
        note: note ? `${ADJUST_REASONS[input.reason]}: ${note}` : ADJUST_REASONS[input.reason],
        staffId: input.staffId,
        at,
        cutoffMinutes: input.cutoffMinutes,
      });
    },
  );
}

/**
 * A product's newest movements, newest first, each with the stock it left behind. Only those
 * are read, by product and time, and in one read with the stock so the two agree.
 */
export async function listMovements(
  db: MarketDb,
  productId: string,
  limit: number = DEFAULT_MOVEMENT_LIMIT,
): Promise<{ movement: StockMovementRecord; balanceMilli: number }[]> {
  return db.transaction('r', db.stockMovements, db.stockLevels, async () => {
    const movements = await db.stockMovements
      .where('[productId+occurredAt]')
      .between([productId, Dexie.minKey], [productId, Dexie.maxKey])
      .reverse()
      .limit(limit)
      .toArray();
    let balance = await stockOf(db, productId);
    return movements.map((movement) => {
      const row = { movement, balanceMilli: balance };
      balance -= movement.delta;
      return row;
    });
  });
}
