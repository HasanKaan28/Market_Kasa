import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import type { MarketDb } from './db';
import { acknowledgeOps, appendOutbox, pendingCount, pendingOps } from './outbox';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const at = new Date('2026-10-29T09:00:00Z');

describe('outbox', () => {
  it('keeps operations in the order they were queued', async () => {
    await appendOutbox(
      db,
      { kind: 'insert', table: 'sales', recordId: 'a', record: { id: 'a' } },
      at,
    );
    await appendOutbox(
      db,
      { kind: 'patch', table: 'products', recordId: 'p', patch: { sellPrice: 100 } },
      at,
    );
    const ops = await pendingOps(db);
    expect(ops.map((op) => op.recordId)).toEqual(['a', 'p']);
    expect(ops[0]?.createdAt).toBe('2026-10-29T09:00:00.000Z');
    expect(await pendingCount(db)).toBe(2);
  });

  it('removes only acknowledged operations', async () => {
    await appendOutbox(db, { kind: 'insert', table: 'sales', recordId: 'a', record: {} }, at);
    await appendOutbox(db, { kind: 'insert', table: 'sales', recordId: 'b', record: {} }, at);
    const [first] = await pendingOps(db);
    await acknowledgeOps(db, [first?.seq ?? -1]);
    expect((await pendingOps(db)).map((op) => op.recordId)).toEqual(['b']);
  });

  it('gives every operation its own opId', async () => {
    await appendOutbox(db, { kind: 'insert', table: 'sales', recordId: 'a', record: {} }, at);
    await appendOutbox(db, { kind: 'insert', table: 'sales', recordId: 'b', record: {} }, at);
    const [first, second] = await pendingOps(db);
    expect(first?.opId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(first?.opId).not.toBe(second?.opId);
  });
});
