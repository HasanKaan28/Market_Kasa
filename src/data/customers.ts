import { balance } from '@/domain/ledger';
import { assertSafeInteger, type Kurus } from '@/domain/money';
import type { MarketDb } from './db';
import { RecordNotFoundError } from './errors';
import { newId } from './ids';
import { appendOutbox } from './outbox';
import { changedFields, toPatch, withoutUndefined } from './records';
import { normalizeForSearch } from './text';
import type { CustomerRecord } from './types';

export type NewCustomer = { name: string; phone?: string; creditLimit?: Kurus };

const DEFAULT_SEARCH_LIMIT = 50;

export async function createCustomer(
  db: MarketDb,
  input: NewCustomer,
  at: Date,
): Promise<CustomerRecord> {
  const stamp = at.toISOString();
  const record: CustomerRecord = withoutUndefined({
    id: newId(at.getTime()),
    creditLimit: 0,
    ...validateFields(input),
    name: requireName(input.name),
    createdAt: stamp,
    updatedAt: stamp,
  });
  await db.transaction('rw', db.customers, db.outbox, async () => {
    await db.customers.add(record);
    await appendOutbox(db, { kind: 'insert', table: 'customers', recordId: record.id, record }, at);
  });
  return record;
}

export async function updateCustomer(
  db: MarketDb,
  id: string,
  patch: Partial<NewCustomer>,
  at: Date,
): Promise<CustomerRecord> {
  const stamp = at.toISOString();
  const changes = validateFields(patch);
  return db.transaction('rw', db.customers, db.outbox, async () => {
    const current = await db.customers.get(id);
    if (!current) {
      throw new RecordNotFoundError('Customer', id);
    }
    const changed = changedFields(current, changes);
    const updated = withoutUndefined({ ...current, ...changed, updatedAt: stamp });
    await db.customers.put(updated);
    await appendOutbox(
      db,
      { kind: 'patch', table: 'customers', recordId: id, patch: toPatch(changed, stamp) },
      at,
    );
    return updated;
  });
}

export async function archiveCustomer(db: MarketDb, id: string, at: Date): Promise<void> {
  const stamp = at.toISOString();
  await db.transaction('rw', db.customers, db.outbox, async () => {
    const current = await db.customers.get(id);
    if (!current) {
      throw new RecordNotFoundError('Customer', id);
    }
    if (current.archivedAt) {
      return;
    }
    await db.customers.put({ ...current, archivedAt: stamp, updatedAt: stamp });
    await appendOutbox(
      db,
      {
        kind: 'patch',
        table: 'customers',
        recordId: id,
        patch: { archivedAt: stamp, updatedAt: stamp },
      },
      at,
    );
  });
}

/** Active customers whose name contains the query, or whose phone contains its digits. */
export async function searchCustomers(
  db: MarketDb,
  query: string,
  limit: number = DEFAULT_SEARCH_LIMIT,
): Promise<CustomerRecord[]> {
  const needle = normalizeForSearch(query);
  const digits = query.replace(/\D/g, '');
  if (needle === '') {
    return [];
  }
  const matches = await db.customers
    .filter(
      (customer) =>
        !customer.archivedAt &&
        (normalizeForSearch(customer.name).includes(needle) ||
          (digits !== '' && (customer.phone ?? '').includes(digits))),
    )
    .toArray();
  return matches.sort((a, b) => a.name.localeCompare(b.name, 'tr')).slice(0, limit);
}

export async function customerBalance(db: MarketDb, customerId: string): Promise<Kurus> {
  return balance(await db.ledger.where('customerId').equals(customerId).toArray());
}

function validateFields(input: Partial<NewCustomer>): Partial<Omit<CustomerRecord, 'id'>> {
  const fields: Partial<Omit<CustomerRecord, 'id'>> = {};
  if (input.name !== undefined) {
    fields.name = requireName(input.name);
  }
  if (input.phone !== undefined) {
    fields.phone = input.phone.replace(/\D/g, '') || undefined;
  }
  if (input.creditLimit !== undefined) {
    assertSafeInteger(input.creditLimit, 'Credit limit');
    if (input.creditLimit < 0) {
      throw new RangeError(`Credit limit cannot be negative, got ${input.creditLimit}`);
    }
    fields.creditLimit = input.creditLimit;
  }
  return fields;
}

function requireName(raw: string): string {
  const name = raw.trim();
  if (name === '') {
    throw new RangeError('Customer name is required');
  }
  return name;
}
