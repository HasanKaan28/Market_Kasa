import { assertSafeInteger, type Kurus } from '@/domain/money';
import { assertVatRate, type VatRate } from '@/domain/pricing';
import type { MarketDb } from './db';
import { DuplicateBarcodeError, NotFoundError } from './errors';
import { newId } from './ids';
import { appendOutbox } from './outbox';
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
  const fields = validateFields({
    unit: 'piece',
    buyPrice: 0,
    isQuick: false,
    criticalLevelMilli: 0,
    ...input,
  }) as ProductFields;
  const record: ProductRecord = withoutUndefined({
    id: newId(at.getTime()),
    ...fields,
    createdAt: stamp,
    updatedAt: stamp,
  });

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
      throw new NotFoundError('Product', id);
    }
    if ('barcode' in changes) {
      await assertBarcodeFree(db, changes.barcode, id);
    }
    const changed = Object.fromEntries(
      Object.entries(changes).filter(
        ([key, value]) => current[key as keyof ProductRecord] !== value,
      ),
    );
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
      throw new NotFoundError('Product', id);
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

/** A cleared optional field travels as null, because JSON has no undefined. */
function toPatch(changed: Record<string, unknown>, stamp: string): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changed)) {
    patch[key] = value === undefined ? null : value;
  }
  return { ...patch, updatedAt: stamp };
}

function withoutUndefined<T extends object>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;
}
