import type { MarketDb } from '@/data/db';
import type { ServerRow, SyncTable } from './protocol';

const EVENT_TABLES: ReadonlySet<SyncTable> = new Set(['sales', 'stockMovements', 'ledger']);

/**
 * Applies pulled rows in order, safely more than once. Events are inserted only if missing.
 * For products and customers the server row wins, then this device's not-yet-acknowledged
 * operations on the same record are replayed on top so a pending local edit is not lost.
 */
export async function applyServerRows(db: MarketDb, rows: readonly ServerRow[]): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  const tables = [
    db.sales,
    db.stockMovements,
    db.stockLevels,
    db.ledger,
    db.products,
    db.customers,
    db.outbox,
  ];
  await db.transaction('rw', tables, async () => {
    for (const row of rows) {
      if (EVENT_TABLES.has(row.table)) {
        await applyEvent(db, row);
      } else {
        await applyEntity(db, row);
      }
    }
  });
}

async function applyEvent(db: MarketDb, { table, id, row }: ServerRow): Promise<void> {
  const target = db.table(table);
  if (await target.get(id)) {
    return;
  }
  await target.add(row);
  if (table === 'stockMovements') {
    const productId = String(row.productId);
    const current = (await db.stockLevels.get(productId))?.qtyMilli ?? 0;
    await db.stockLevels.put({ productId, qtyMilli: current + Number(row.delta) });
  }
}

async function applyEntity(db: MarketDb, { table, id, row }: ServerRow): Promise<void> {
  let merged = withoutNulls(row);
  const pending = await db.outbox
    .filter((op) => op.table === table && op.recordId === id)
    .sortBy('seq');
  for (const op of pending) {
    merged = op.kind === 'insert' ? { ...merged, ...op.record } : applyPatch(merged, op.patch);
  }
  if (table === 'products') {
    await releaseBarcode(db, merged.barcode, id);
  }
  await db.table(table).put(merged);
}

/** The server gives a contested barcode to one product; take it off any other local holder first. */
async function releaseBarcode(db: MarketDb, barcode: unknown, ownerId: string): Promise<void> {
  if (typeof barcode !== 'string') {
    return;
  }
  const holder = await db.products.where('barcode').equals(barcode).first();
  if (holder && holder.id !== ownerId) {
    const released = { ...holder };
    delete released.barcode;
    await db.products.put(released);
  }
}

function applyPatch(row: Record<string, unknown>, patch: object): Record<string, unknown> {
  const next = { ...row };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  return next;
}

function withoutNulls(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null));
}
