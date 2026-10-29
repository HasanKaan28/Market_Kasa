import type { MarketDb } from '@/data/db';
import type { ServerRow } from './protocol';

/** A pulled row this build could not apply, kept so the pull can move past it. */
export type ParkedRow = { row: ServerRow; error: string };

const PARKED_KEY = 'parkedRows';
const MAX_KEPT = 200;

export async function parkedRows(db: MarketDb): Promise<ParkedRow[]> {
  return readList<ParkedRow>(db, PARKED_KEY);
}

/** Appends to the parked list, keeping the newest entries. Call inside a transaction on `meta`. */
export async function parkRows(db: MarketDb, rows: readonly ParkedRow[]): Promise<void> {
  await appendList(db, PARKED_KEY, rows);
}

async function readList<T>(db: MarketDb, key: string): Promise<T[]> {
  const value = (await db.meta.get(key))?.value;
  return Array.isArray(value) ? (value as T[]) : [];
}

async function appendList<T>(db: MarketDb, key: string, items: readonly T[]): Promise<void> {
  if (items.length === 0) {
    return;
  }
  const kept = [...(await readList<T>(db, key)), ...items].slice(-MAX_KEPT);
  await db.meta.put({ key, value: kept });
}
