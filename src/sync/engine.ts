import type { MarketDb } from '@/data/db';
import { acknowledgeOps, pendingOps } from '@/data/outbox';
import { applyServerRows } from './apply';
import { getPullCursor, setPullCursor } from './cursor';
import type { SyncTransport } from './protocol';

export type SyncOptions = { batchSize?: number; overlap?: number };

export type SyncResult = { pushed: number; pulled: number };

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_OVERLAP = 50;

/** One round: push the whole outbox page by page, then pull everything new page by page. */
export async function syncOnce(
  db: MarketDb,
  transport: SyncTransport,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;
  const pushed = await pushOutbox(db, transport, batchSize);
  const pulled = await pullChanges(db, transport, batchSize, overlap);
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
    const { acknowledged } = await transport.push({ ops });
    await acknowledgeOps(db, acknowledged);
    pushed += acknowledged.length;
    // A partial acknowledgement would resend the same page forever; stop and retry next round.
    if (acknowledged.length < ops.length) {
      return pushed;
    }
  }
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
