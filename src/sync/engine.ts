import type { MarketDb } from '@/data/db';
import { acknowledgeOps, pendingOps } from '@/data/outbox';
import type { OutboxItem } from '@/data/types';
import { applyServerRows } from './apply';
import { getPullCursor, setPullCursor } from './cursor';
import { recordRejections } from './issues';
import type { Rejection, SyncTransport } from './protocol';

export type SyncOptions = { batchSize?: number; overlap?: number };

export type SyncResult = { pushed: number; pulled: number };

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_OVERLAP = 50;

/**
 * One round: push the whole outbox page by page, then pull everything new page by page.
 * The pull runs even when the push fails, so this device keeps receiving everyone else's
 * changes; its pending operations are replayed over pulled rows. The push error is then
 * rethrown.
 */
export async function syncOnce(
  db: MarketDb,
  transport: SyncTransport,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;
  let pushed = 0;
  let pushFailure: { error: unknown } | undefined;
  try {
    pushed = await pushOutbox(db, transport, batchSize);
  } catch (error) {
    pushFailure = { error };
  }
  const pulled = await pullChanges(db, transport, batchSize, overlap);
  if (pushFailure) {
    throw pushFailure.error;
  }
  return { pushed, pulled };
}

async function pushOutbox(
  db: MarketDb,
  transport: SyncTransport,
  batchSize: number,
): Promise<number> {
  let pushed = 0;
  for (;;) {
    const ops = await pendingOps(db, batchSize);
    if (ops.length === 0) {
      return pushed;
    }
    const { acknowledged, rejected = [] } = await transport.push({ ops });
    await settleOps(db, ops, acknowledged, rejected);
    pushed += acknowledged.length;
    // Ops the server neither acknowledged nor refused stay queued; retry them next round
    // instead of sending them again in this one.
    if (acknowledged.length + rejected.length < ops.length) {
      return pushed;
    }
  }
}

/** Removes answered ops from the outbox and keeps a record of the refused ones, atomically. */
async function settleOps(
  db: MarketDb,
  sent: readonly OutboxItem[],
  acknowledged: readonly number[],
  rejected: readonly Rejection[],
): Promise<void> {
  await db.transaction('rw', db.outbox, db.meta, async () => {
    await acknowledgeOps(db, [...acknowledged, ...rejected.map((r) => r.seq)]);
    await recordRejections(
      db,
      rejected.flatMap(({ seq, reason }) => {
        const op = sent.find((item) => item.seq === seq);
        return op ? [{ op, reason }] : [];
      }),
    );
  });
}

/**
 * The first page re-reads `overlap` sequences behind the cursor, so a row the server committed
 * late with a lower sequence is not skipped; applying a row twice is harmless.
 */
async function pullChanges(
  db: MarketDb,
  transport: SyncTransport,
  batchSize: number,
  overlap: number,
): Promise<number> {
  let cursor = await getPullCursor(db);
  let since = Math.max(0, cursor - overlap);
  let pulled = 0;
  for (;;) {
    const { rows, latest } = await transport.pull({ since, limit: batchSize });
    await applyServerRows(db, rows);
    pulled += rows.length;
    if (latest > cursor) {
      cursor = latest;
      await setPullCursor(db, cursor);
    }
    if (rows.length < batchSize) {
      return pulled;
    }
    since = latest;
  }
}
