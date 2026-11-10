import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import { archiveCustomer, createCustomer, customerBalance, searchCustomers } from './customers';
import type { MarketDb } from './db';
import { pendingOps } from './outbox';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const at = new Date('2026-10-29T09:00:00Z');

describe('customers', () => {
  it('normalises name and phone and queues the customer', async () => {
    const c = await createCustomer(
      db,
      { name: ' Ahmet Yılmaz ', phone: '0 (532) 111 22 33', creditLimit: 250000 },
      at,
    );
    expect(c).toMatchObject({ name: 'Ahmet Yılmaz', phone: '05321112233', creditLimit: 250000 });
    expect((await pendingOps(db))[0]).toMatchObject({
      kind: 'insert',
      table: 'customers',
      recordId: c.id,
    });
  });

  it('finds customers by Turkish name or phone digits, not when archived', async () => {
    const c = await createCustomer(db, { name: 'Ahmet Yılmaz', phone: '05321112233' }, at);
    expect((await searchCustomers(db, 'YILMAZ')).map((x) => x.id)).toEqual([c.id]);
    expect((await searchCustomers(db, '1112')).map((x) => x.id)).toEqual([c.id]);
    await archiveCustomer(db, c.id, at);
    expect(await searchCustomers(db, 'ahmet')).toEqual([]);
  });

  it('starts with a zero balance', async () => {
    const c = await createCustomer(db, { name: 'Fatma' }, at);
    expect(await customerBalance(db, c.id)).toBe(0);
  });

  it('rejects a fractional credit limit', async () =>
    expect(createCustomer(db, { name: 'Fatma', creditLimit: 100.5 }, at)).rejects.toThrow(
      RangeError,
    ));
});
