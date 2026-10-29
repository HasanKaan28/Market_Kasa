import Dexie from 'dexie';
import { businessDate } from '@/domain/businessDate';
import { assertSafeInteger } from '@/domain/money';
import type { MarketDb } from './db';
import { RecordNotFoundError } from './errors';
import { newId } from './ids';
import { appendOutbox } from './outbox';
import { withoutUndefined } from './records';
import { recordStockMovement } from './stock';
import type { CountLine, ProductUnit, StockCountRecord } from './types';

export type CountInput = {
  deviceCode: string;
  lines: readonly { productId: string; countedMilli: number }[];
  note?: string;
  cutoffMinutes?: number;
};

export type CountCheck = {
  count: StockCountRecord;
  line: CountLine;
  /** What the movements before the count add up to now. */
  expectedNowMilli: number;
};

/**
 * Records a shelf count in one transaction: the count, and a `count` movement for each line
 * whose counted amount differs from this device's stock. Every line is checked first.
 */
export async function recordCount(
  db: MarketDb,
  input: CountInput,
  at: Date,
): Promise<StockCountRecord> {
  if (input.lines.length === 0) {
    throw new RangeError('A count needs at least one line');
  }
  if (new Set(input.lines.map((line) => line.productId)).size !== input.lines.length) {
    throw new RangeError('A product appears twice in one count');
  }
  const id = newId(at.getTime());
  const tables = [db.stockCounts, db.products, db.stockMovements, db.stockLevels, db.outbox];
  return db.transaction('rw', tables, async () => {
    const lines: CountLine[] = [];
    for (const line of input.lines) {
      const product = await db.products.get(line.productId);
      if (!product || product.deletedAt) {
        throw new RecordNotFoundError('Product', line.productId);
      }
      assertCounted(line.countedMilli, product.unit);
      lines.push({
        productId: product.id,
        name: product.name,
        unit: product.unit,
        expectedMilli: (await db.stockLevels.get(product.id))?.qtyMilli ?? 0,
        countedMilli: line.countedMilli,
      });
    }
    const record: StockCountRecord = withoutUndefined({
      id,
      deviceCode: input.deviceCode,
      lines,
      note: input.note?.trim() || undefined,
      occurredAt: at.toISOString(),
      businessDate: businessDate(at, { cutoffMinutes: input.cutoffMinutes }),
    });
    // The count goes first, so the movements that refer to it are never queued before it.
    await db.stockCounts.add(record);
    await appendOutbox(db, { kind: 'insert', table: 'stockCounts', recordId: id, record }, at);
    for (const line of lines) {
      const delta = line.countedMilli - line.expectedMilli;
      if (delta !== 0) {
        await recordStockMovement(db, {
          productId: line.productId,
          delta,
          kind: 'count',
          refId: id,
          at,
          cutoffMinutes: input.cutoffMinutes,
        });
      }
    }
    return record;
  });
}

/**
 * Counts since `since` whose expected stock no longer matches the movements made before them:
 * a sale another register made earlier arrived after the count, or another register counted
 * the same product. Nothing is corrected here; a person recounts, and a later count of the
 * product clears the earlier ones.
 */
export async function countsNeedingCheck(db: MarketDb, since: Date): Promise<CountCheck[]> {
  return db.transaction('r', db.stockCounts, db.stockMovements, async () => {
    const counts = (
      await db.stockCounts.where('occurredAt').aboveOrEqual(since.toISOString()).toArray()
    ).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
    const latest = new Map<string, StockCountRecord>();
    for (const count of counts) {
      for (const line of count.lines) {
        latest.set(line.productId, count);
      }
    }
    const checks: CountCheck[] = [];
    for (const count of counts) {
      for (const line of count.lines) {
        if (latest.get(line.productId) !== count) {
          continue;
        }
        const before = await db.stockMovements
          .where('[productId+occurredAt]')
          .between([line.productId, Dexie.minKey], [line.productId, count.occurredAt], true, true)
          .toArray();
        const expectedNowMilli = before
          .filter((movement) => movement.refId !== count.id)
          .reduce((sum, movement) => sum + movement.delta, 0);
        if (expectedNowMilli !== line.expectedMilli) {
          checks.push({ count, line, expectedNowMilli });
        }
      }
    }
    return checks;
  });
}

/** Nothing below zero, and whole pieces for a piece product. */
function assertCounted(countedMilli: number, unit: ProductUnit): void {
  assertSafeInteger(countedMilli, 'Counted quantity (thousandths)');
  if (countedMilli < 0) {
    throw new RangeError(`A counted quantity cannot be below zero, got ${countedMilli}`);
  }
  if (unit === 'piece' && countedMilli % 1000 !== 0) {
    throw new RangeError('A piece product is counted in whole pieces');
  }
}
