import type { MarketDb } from '@/data/db';
import { assertSafeInteger } from '@/domain/money';

const PULL_CURSOR = 'pullCursor';

/** The highest server sequence this device has applied; 0 before the first pull. */
export async function getPullCursor(db: MarketDb): Promise<number> {
  const record = await db.meta.get(PULL_CURSOR);
  return typeof record?.value === 'number' ? record.value : 0;
}

export async function setPullCursor(db: MarketDb, value: number): Promise<void> {
  assertSafeInteger(value, 'Pull cursor');
  if (value < 0) {
    throw new RangeError(`The pull cursor cannot be negative, got ${value}`);
  }
  await db.meta.put({ key: PULL_CURSOR, value });
}
