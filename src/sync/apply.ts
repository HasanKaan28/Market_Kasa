import type { MarketDb } from '@/data/db';
import { canonicalBarcode } from '@/data/products';
import { parkRows, type ParkedRow } from './issues';
import type { ServerRow, SyncTable } from './protocol';

const EVENT_TABLES: ReadonlySet<SyncTable> = new Set([
  'sales',
  'stockMovements',
  'ledger',
  'saleVoids',
  'returns',
  'purchases',
  'stockCounts',
  'supplierLedger',
  'cashMovements',
  'cashSessions',
]);
const ENTITY_TABLES: ReadonlySet<SyncTable> = new Set([
  'products',
  'customers',
  'categories',
  'suppliers',
  'staff',
  'settings',
]);

/**
 * Applies pulled rows in order, safely more than once. Events are inserted only if missing.
 * For products and customers the server row wins, then this device's not-yet-acknowledged
 * operations on the same record are replayed on top so a pending local edit is not lost.
 * A row that cannot be applied (a table this build does not know, a malformed row) is parked
 * and the rest still apply, so one bad row never stops the pull.
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
    db.categories,
    db.saleVoids,
    db.returns,
    db.purchases,
    db.stockCounts,
    db.suppliers,
    db.supplierLedger,
    db.cashMovements,
    db.cashSessions,
    db.staff,
    db.settings,
    db.outbox,
    db.meta,
  ];
  await db.transaction('rw', tables, async () => {
    const parked: ParkedRow[] = [];
    for (const row of rows) {
      try {
        if (EVENT_TABLES.has(row.table)) {
          await applyEvent(db, row);
        } else if (ENTITY_TABLES.has(row.table)) {
          await applyEntity(db, row);
        } else {
          throw new RangeError(`Unknown table: ${row.table}`);
        }
      } catch (error) {
        parked.push({ row, error: error instanceof Error ? error.message : String(error) });
      }
    }
    await parkRows(db, parked);
  });
}

async function applyEvent(db: MarketDb, { table, id, row }: ServerRow): Promise<void> {
  const target = db.table(table);
  if (await target.get(id)) {
    return;
  }
  // Checked before the first write: a movement must never land without its stock update.
  if (table === 'stockMovements') {
    assertMovement(row);
  }
  await target.add(row);
  if (table === 'stockMovements') {
    const productId = String(row.productId);
    const current = (await db.stockLevels.get(productId))?.qtyMilli ?? 0;
    await db.stockLevels.put({ productId, qtyMilli: current + Number(row.delta) });
  }
}

function assertMovement(row: Record<string, unknown>): void {
  if (typeof row.productId !== 'string' || !Number.isSafeInteger(row.delta)) {
    throw new RangeError(`Malformed stock movement: ${JSON.stringify(row)}`);
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
    merged = withStoredBarcode(merged);
    await releaseBarcode(db, merged.barcode, id);
  }
  await db.table(table).put(merged);
}

/** A pulled product with its barcode in the stored form; an invalid barcode refuses the row. */
function withStoredBarcode(row: Record<string, unknown>): Record<string, unknown> {
  if (typeof row.barcode !== 'string') {
    return row;
  }
  const barcode = canonicalBarcode(row.barcode);
  const stored = { ...row, barcode };
  if (barcode === undefined) {
    delete stored.barcode;
  }
  return stored;
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
