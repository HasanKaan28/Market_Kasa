import { assertSafeInteger, type Kurus } from '@/domain/money';
import { assertVatRate, type VatRate } from '@/domain/pricing';
import type { MarketDb } from './db';
import { DuplicateBarcodeError, RecordNotFoundError } from './errors';
import { newId } from './ids';
import { appendOutbox } from './outbox';
import { changedFields, toPatch, withoutUndefined } from './records';
import { normalizeForSearch } from './text';
import type { ProductRecord, ProductUnit } from './types';

export type NewProduct = {
  barcode?: string;
  name: string;
  categoryId?: string;
  unit?: ProductUnit;
  sellPrice: Kurus;
  buyPrice?: Kurus;
  vatRate: VatRate;
  isQuick?: boolean;
  criticalLevelMilli?: number;
};

/** An empty string for `barcode` or `categoryId` clears it. */
export type ProductPatch = Partial<NewProduct>;

type ProductFields = Omit<ProductRecord, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;

const BARCODE = /^[0-9A-Za-z-]{1,32}$/;
const DEFAULT_SEARCH_LIMIT = 50;

export async function createProduct(
  db: MarketDb,
  input: NewProduct,
  at: Date,
): Promise<ProductRecord> {
  const stamp = at.toISOString();
  // Validate first and drop absent fields, then fill defaults: an explicit undefined
  // (an empty form box) must not wipe out a default.
  const validated = withoutUndefined(validateFields(input));
  const { name, sellPrice, vatRate } = validated;
  if (name === undefined || sellPrice === undefined || vatRate === undefined) {
    throw new RangeError('A product needs a name, a sell price and a VAT rate');
  }
  const record: ProductRecord = {
    unit: 'piece',
    buyPrice: 0,
    isQuick: false,
    criticalLevelMilli: 0,
    ...validated,
    name,
    sellPrice,
    vatRate,
    id: newId(at.getTime()),
    createdAt: stamp,
    updatedAt: stamp,
  };

  await db.transaction('rw', db.products, db.outbox, async () => {
    await assertBarcodeFree(db, record.barcode, record.id);
    await db.products.add(record);
    await appendOutbox(db, { kind: 'insert', table: 'products', recordId: record.id, record }, at);
  });
  return record;
}

export async function updateProduct(
  db: MarketDb,
  id: string,
  patch: ProductPatch,
  at: Date,
): Promise<ProductRecord> {
  const stamp = at.toISOString();
  const changes = validateFields(patch);

  return db.transaction('rw', db.products, db.outbox, async () => {
    const current = await db.products.get(id);
    if (!current) {
      throw new RecordNotFoundError('Product', id);
    }
    if ('barcode' in changes) {
      await assertBarcodeFree(db, changes.barcode, id);
    }
    const changed = changedFields(current, changes);
    const updated = withoutUndefined({ ...current, ...changed, updatedAt: stamp });
    await db.products.put(updated);
    await appendOutbox(
      db,
      { kind: 'patch', table: 'products', recordId: id, patch: toPatch(changed, stamp) },
      at,
    );
    return updated;
  });
}

export async function deleteProduct(db: MarketDb, id: string, at: Date): Promise<void> {
  const stamp = at.toISOString();
  await db.transaction('rw', db.products, db.outbox, async () => {
    const current = await db.products.get(id);
    if (!current) {
      throw new RecordNotFoundError('Product', id);
    }
    if (current.deletedAt) {
      return;
    }
    await db.products.put({ ...current, deletedAt: stamp, updatedAt: stamp });
    await appendOutbox(
      db,
      {
        kind: 'patch',
        table: 'products',
        recordId: id,
        patch: { deletedAt: stamp, updatedAt: stamp },
      },
      at,
    );
  });
}

export async function findProductByBarcode(
  db: MarketDb,
  barcode: string,
): Promise<ProductRecord | undefined> {
  const product = await db.products.where('barcode').equals(barcode.trim()).first();
  return product && !product.deletedAt ? product : undefined;
}

/** Products whose name contains the query, or whose barcode starts with it; deleted ones excluded. */
export async function searchProducts(
  db: MarketDb,
  query: string,
  limit: number = DEFAULT_SEARCH_LIMIT,
): Promise<ProductRecord[]> {
  const needle = normalizeForSearch(query);
  if (needle === '') {
    return [];
  }
  const matches = await db.products
    .filter(
      (product) =>
        !product.deletedAt &&
        (normalizeForSearch(product.name).includes(needle) ||
          normalizeForSearch(product.barcode ?? '').startsWith(needle)),
    )
    .toArray();
  return matches.sort((a, b) => a.name.localeCompare(b.name, 'tr')).slice(0, limit);
}

/** Products marked for the quick grid, by name; deleted ones excluded. */
export async function listQuickProducts(db: MarketDb): Promise<ProductRecord[]> {
  const quick = await db.products.filter((product) => product.isQuick && !product.deletedAt).toArray();
  return quick.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}

/** Validates and normalises whichever fields are present; absent fields stay absent. */
function validateFields(input: ProductPatch): Partial<ProductFields> {
  const fields: Partial<ProductFields> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name === '') {
      throw new RangeError('Product name is required');
    }
    fields.name = name;
  }
  if (input.barcode !== undefined) {
    fields.barcode = normalizeBarcode(input.barcode);
  }
  if (input.categoryId !== undefined) {
    fields.categoryId = input.categoryId.trim() || undefined;
  }
  if (input.unit !== undefined) {
    fields.unit = input.unit;
  }
  for (const key of ['sellPrice', 'buyPrice', 'criticalLevelMilli'] as const) {
    const value = input[key];
    if (value !== undefined) {
      assertNonNegativeInteger(value, key);
      fields[key] = value;
    }
  }
  if (input.vatRate !== undefined) {
    assertVatRate(input.vatRate);
    fields.vatRate = input.vatRate;
  }
  if (input.isQuick !== undefined) {
    fields.isQuick = input.isQuick;
  }
  return fields;
}

function normalizeBarcode(raw: string): string | undefined {
  const barcode = raw.trim();
  if (barcode === '') {
    return undefined;
  }
  if (!BARCODE.test(barcode)) {
    throw new RangeError(`A barcode may only hold letters, digits and "-", got "${raw}"`);
  }
  return barcode;
}

function assertNonNegativeInteger(value: number, what: string): void {
  assertSafeInteger(value, what);
  if (value < 0) {
    throw new RangeError(`${what} cannot be negative, got ${value}`);
  }
}

async function assertBarcodeFree(
  db: MarketDb,
  barcode: string | undefined,
  ownerId: string,
): Promise<void> {
  if (barcode === undefined) {
    return;
  }
  const holder = await db.products.where('barcode').equals(barcode).first();
  if (holder && holder.id !== ownerId) {
    throw new DuplicateBarcodeError(barcode);
  }
}
