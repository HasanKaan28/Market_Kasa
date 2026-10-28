import type { MarketDb } from './db';
import type { OutboxItem, OutboxOp } from './types';

const DEFAULT_BATCH = 500;

/** Queues one change for the server. Call it inside the transaction that makes the change. */
export async function appendOutbox(db: MarketDb, op: OutboxOp, at: Date): Promise<void> {
  await db.outbox.add({ ...op, createdAt: at.toISOString() });
}

export function pendingOps(db: MarketDb, limit: number = DEFAULT_BATCH): Promise<OutboxItem[]> {
  return db.outbox.orderBy('seq').limit(limit).toArray();
}

export function pendingCount(db: MarketDb): Promise<number> {
  return db.outbox.count();
}

export async function acknowledgeOps(db: MarketDb, seqs: readonly number[]): Promise<void> {
  await db.outbox.bulkDelete([...seqs]);
}
