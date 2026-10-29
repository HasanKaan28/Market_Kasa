import { assertSafeInteger, type Kurus } from '@/domain/money';
import type { MarketDb } from './db';
import { DuplicateSupplierError, RecordNotFoundError } from './errors';
import { newId } from './ids';
import { appendOutbox } from './outbox';
import { changedFields, toPatch, withoutUndefined } from './records';
import { normalizeForSearch } from './text';
import type { SupplierRecord } from './types';

export type NewSupplier = { name: string; phone?: string; taxNo?: string; taxOffice?: string };

const DEFAULT_SEARCH_LIMIT = 50;

/** Adds a supplier; a live supplier with the same name, in any letter case, refuses it. */
export async function createSupplier(
  db: MarketDb,
  input: NewSupplier,
  at: Date,
): Promise<SupplierRecord> {
  const stamp = at.toISOString();
  const record: SupplierRecord = withoutUndefined({
    id: newId(at.getTime()),
    ...validateFields(input),
    name: requireName(input.name),
    createdAt: stamp,
    updatedAt: stamp,
  });
  await db.transaction('rw', db.suppliers, db.outbox, async () => {
    await assertNameFree(db, record.name, record.id);
    await db.suppliers.add(record);
    await appendOutbox(db, { kind: 'insert', table: 'suppliers', recordId: record.id, record }, at);
  });
  return record;
}

export async function updateSupplier(
  db: MarketDb,
  id: string,
  patch: Partial<NewSupplier>,
  at: Date,
): Promise<SupplierRecord> {
  const stamp = at.toISOString();
  const changes = validateFields(patch);
  return db.transaction('rw', db.suppliers, db.outbox, async () => {
    const current = await db.suppliers.get(id);
    if (!current) {
      throw new RecordNotFoundError('Supplier', id);
    }
    if (changes.name !== undefined) {
      await assertNameFree(db, changes.name, id);
    }
    const changed = changedFields(current, changes);
    const updated = withoutUndefined({ ...current, ...changed, updatedAt: stamp });
    await db.suppliers.put(updated);
    await appendOutbox(
      db,
      { kind: 'patch', table: 'suppliers', recordId: id, patch: toPatch(changed, stamp) },
      at,
    );
    return updated;
  });
}

/** Archives a settled supplier; one owed money, or owing it, stays so the balance is not hidden. */
export async function archiveSupplier(db: MarketDb, id: string, at: Date): Promise<void> {
  const stamp = at.toISOString();
  await db.transaction('rw', db.suppliers, db.supplierLedger, db.outbox, async () => {
    const current = await db.suppliers.get(id);
    if (!current) {
      throw new RecordNotFoundError('Supplier', id);
    }
    if (current.archivedAt) {
      return;
    }
    const owed = total(await db.supplierLedger.where('supplierId').equals(id).toArray());
    if (owed !== 0) {
      throw new RangeError(`Only a settled supplier is archived; the balance is ${owed}`);
    }
    await db.suppliers.put({ ...current, archivedAt: stamp, updatedAt: stamp });
    await appendOutbox(
      db,
      {
        kind: 'patch',
        table: 'suppliers',
        recordId: id,
        patch: { archivedAt: stamp, updatedAt: stamp },
      },
      at,
    );
  });
}

/** Live suppliers whose name contains the query, by name. */
export async function searchSuppliers(
  db: MarketDb,
  query: string,
  limit: number = DEFAULT_SEARCH_LIMIT,
): Promise<SupplierRecord[]> {
  const needle = normalizeForSearch(query);
  const matches = await db.suppliers
    .filter(
      (supplier) => !supplier.archivedAt && normalizeForSearch(supplier.name).includes(needle),
    )
    .toArray();
  return matches.sort((a, b) => a.name.localeCompare(b.name, 'tr')).slice(0, limit);
}

/** What the market owes the supplier; below zero is an overpayment. */
export async function supplierBalance(db: MarketDb, supplierId: string): Promise<Kurus> {
  return total(await db.supplierLedger.where('supplierId').equals(supplierId).toArray());
}

function total(entries: readonly { amount: Kurus }[]): Kurus {
  return entries.reduce((sum, entry) => {
    assertSafeInteger(entry.amount, 'Supplier ledger amount');
    return sum + entry.amount;
  }, 0);
}

async function assertNameFree(db: MarketDb, name: string, ownId: string): Promise<void> {
  const key = normalizeForSearch(name);
  const holder = await db.suppliers
    .filter(
      (supplier) =>
        supplier.id !== ownId && !supplier.archivedAt && normalizeForSearch(supplier.name) === key,
    )
    .first();
  if (holder) {
    throw new DuplicateSupplierError(holder.name);
  }
}

function validateFields(input: Partial<NewSupplier>): Partial<Omit<SupplierRecord, 'id'>> {
  const fields: Partial<Omit<SupplierRecord, 'id'>> = {};
  if (input.name !== undefined) {
    fields.name = requireName(input.name);
  }
  if (input.phone !== undefined) {
    fields.phone = input.phone.replace(/\D/g, '') || undefined;
  }
  if (input.taxNo !== undefined) {
    fields.taxNo = input.taxNo.replace(/\D/g, '') || undefined;
  }
  if (input.taxOffice !== undefined) {
    fields.taxOffice = input.taxOffice.trim() || undefined;
  }
  return fields;
}

function requireName(raw: string): string {
  const name = raw.trim();
  if (name === '') {
    throw new RangeError('A supplier needs a name');
  }
  return name;
}
