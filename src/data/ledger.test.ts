import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import { createCustomer, customerBalance } from './customers';
import type { MarketDb } from './db';
import { addLedgerEntry } from './ledger';
import { pendingOps } from './outbox';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const at = new Date('2026-10-29T09:00:00Z');

describe('addLedgerEntry', () => {
  it('writes a ledger entry and queues it', async () => {
    const customer = await createCustomer(db, { name: 'Ahmet' }, at);
    const entry = await addLedgerEntry(
      db,
      { customerId: customer.id, kind: 'adjustment', amount: -1500, note: 'İade' },
      at,
    );
    expect(entry).toMatchObject({ amount: -1500, businessDate: '2026-10-29', note: 'İade' });
    expect(await customerBalance(db, customer.id)).toBe(-1500);
    expect((await pendingOps(db)).some((op) => op.table === 'ledger')).toBe(true);
  });
});
