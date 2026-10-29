import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import { archiveCustomer, createCustomer, customerBalance } from './customers';
import type { MarketDb } from './db';
import { RecordNotFoundError } from './errors';
import { addLedgerEntry, recordAdjustment, recordPayment } from './ledger';
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

describe('recordPayment', () => {
  it('records a payment all or nothing', async () => {
    const customer = await createCustomer(db, { name: 'Ahmet' }, at);
    await recordAdjustment(db, { customerId: customer.id, amount: 10000, note: 'Eski borç' }, at);
    const payment = await recordPayment(
      db,
      { customerId: customer.id, amount: 4000, method: 'cash', note: ' elden ' },
      at,
    );
    expect(payment).toMatchObject({ kind: 'payment', amount: -4000, method: 'cash', note: 'elden' });
    expect(await customerBalance(db, customer.id)).toBe(6000);
    expect((await pendingOps(db)).at(-1)).toMatchObject({ table: 'ledger', recordId: payment.id });

    // The outbox write comes last; when it fails, the payment must not stay behind.
    const entries = await db.ledger.count();
    db.outbox.hook('creating', () => {
      throw new Error('disk full');
    });
    await expect(
      recordPayment(db, { customerId: customer.id, amount: 1000, method: 'card' }, at),
    ).rejects.toThrow('disk full');
    expect(await db.ledger.count()).toBe(entries);
  });

  it('refuses an empty or unknown payment', async () => {
    const customer = await createCustomer(db, { name: 'Ahmet' }, at);
    const gone = await createCustomer(db, { name: 'Veli' }, at);
    await archiveCustomer(db, gone.id, at);
    const pay = (customerId: string, amount: number, method = 'cash') =>
      recordPayment(db, { customerId, amount, method: method as 'cash' }, at);
    await expect(pay(customer.id, 0)).rejects.toBeInstanceOf(RangeError);
    await expect(pay(customer.id, -100)).rejects.toBeInstanceOf(RangeError);
    await expect(pay(customer.id, 0.5)).rejects.toBeInstanceOf(RangeError);
    await expect(pay(customer.id, 100, 'credit')).rejects.toBeInstanceOf(RangeError);
    await expect(pay('nobody', 100)).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(pay(gone.id, 100)).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(
      recordAdjustment(db, { customerId: customer.id, amount: 0, note: 'x' }, at),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      recordAdjustment(db, { customerId: customer.id, amount: 100, note: '  ' }, at),
    ).rejects.toBeInstanceOf(RangeError);
    expect(await db.ledger.count()).toBe(0);
  });

  it('writes a signed adjustment with its note', async () => {
    const customer = await createCustomer(db, { name: 'Ahmet' }, at);
    const entry = await recordAdjustment(
      db,
      { customerId: customer.id, amount: -2500, note: ' indirim ' },
      at,
    );
    expect(entry).toMatchObject({ kind: 'adjustment', amount: -2500, note: 'indirim' });
    expect(entry).not.toHaveProperty('method');
    expect(await customerBalance(db, customer.id)).toBe(-2500);
  });
});

describe('archiveCustomer', () => {
  it('refuses to archive a customer with a balance', async () => {
    const owes = await createCustomer(db, { name: 'Ahmet' }, at);
    await recordAdjustment(db, { customerId: owes.id, amount: 6000, note: 'Eski borç' }, at);
    await expect(archiveCustomer(db, owes.id, at)).rejects.toBeInstanceOf(RangeError);
    const owed = await createCustomer(db, { name: 'Veli' }, at);
    await recordAdjustment(db, { customerId: owed.id, amount: -100, note: 'Fazla ödeme' }, at);
    await expect(archiveCustomer(db, owed.id, at)).rejects.toBeInstanceOf(RangeError);
    await recordAdjustment(db, { customerId: owes.id, amount: -6000, note: 'Silindi' }, at);
    await archiveCustomer(db, owes.id, at);
    expect((await db.customers.get(owes.id))?.archivedAt).toBe(at.toISOString());
  });
});
