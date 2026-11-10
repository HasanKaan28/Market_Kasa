import type { MarketDb } from '@/data/db';
import type { OutboxItem } from '@/data/types';
import type { ServerRow } from './protocol';

/** A pulled row this build could not apply, kept so the pull can move past it. */
export type ParkedRow = { row: ServerRow; error: string };

/** An operation the server refused, kept so the person who made it can be told (M6). */
export type RejectedOp = { op: OutboxItem; reason: string };

const PARKED_KEY = 'parkedRows';
const REJECTED_KEY = 'rejectedOps';
const MAX_KEPT = 200;

export async function parkedRows(db: MarketDb): Promise<ParkedRow[]> {
  return readList<ParkedRow>(db, PARKED_KEY);
}

/** Appends to the parked list, keeping the newest entries. Call inside a transaction on `meta`. */
export async function parkRows(db: MarketDb, rows: readonly ParkedRow[]): Promise<void> {
  await appendList(db, PARKED_KEY, rows);
}

export async function rejectedOps(db: MarketDb): Promise<RejectedOp[]> {
  return readList<RejectedOp>(db, REJECTED_KEY);
}

export async function recordRejections(db: MarketDb, ops: readonly RejectedOp[]): Promise<void> {
  await appendList(db, REJECTED_KEY, ops);
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
