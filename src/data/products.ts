import { assertSafeInteger, type Kurus } from '@/domain/money';
import { assertVatRate, MAX_UNIT_PRICE, type VatRate } from '@/domain/pricing';
import type { MarketDb } from './db';
import { DuplicateBarcodeError, RecordNotFoundError } from './errors';
import { newId } from './ids';
import { appendOutbox } from './outbox';
import { changedFields, toPatch, withoutUndefined } from './records';
import { recordStockMovement } from './stock';
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

/** `openingStockMilli` is what is on the shelf now; it is written as a count movement. */
export async function createProduct(
  db: MarketDb,
  input: NewProduct,
  at: Date,
  { openingStockMilli = 0 }: { openingStockMilli?: number } = {},
): Promise<ProductRecord> {
  const stamp = at.toISOString();
  assertNonNegativeInteger(openingStockMilli, 'openingStockMilli');
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

  assertWholePieces(record.unit, [openingStockMilli, record.criticalLevelMilli]);
  const tables = [db.products, db.stockMovements, db.stockLevels, db.outbox];
  await db.transaction('rw', tables, async () => {
    await claimBarcode(db, record.barcode, record.id, at);
    await db.products.add(record);
    await appendOutbox(db, { kind: 'insert', table: 'products', recordId: record.id, record }, at);
    if (openingStockMilli > 0) {
      await recordStockMovement(db, {
        productId: record.id,
        delta: openingStockMilli,
        kind: 'count',
        at,
      });
    }
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
      await claimBarcode(db, changes.barcode, id, at);
    }
    const changed = changedFields(current, changes);
    const updated = withoutUndefined({ ...current, ...changed, updatedAt: stamp });
    if ('unit' in changed || 'criticalLevelMilli' in changed) {
      assertWholePieces(updated.unit, [updated.criticalLevelMilli]);
    }
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

/** Brings a deleted product back; its barcode returns with it unless another product took it. */
export async function restoreProduct(db: MarketDb, id: string, at: Date): Promise<ProductRecord> {
  const stamp = at.toISOString();
  return db.transaction('rw', db.products, db.outbox, async () => {
    const current = await db.products.get(id);
    if (!current) {
      throw new RecordNotFoundError('Product', id);
    }
    if (!current.deletedAt) {
      return current;
    }
    const restored = { ...current, updatedAt: stamp };
    delete restored.deletedAt;
    await db.products.put(restored);
    await appendOutbox(
      db,
      {
        kind: 'patch',
        table: 'products',
        recordId: id,
        patch: { deletedAt: null, updatedAt: stamp },
      },
      at,
    );
    return restored;
  });
}

/** The products with these ids, deleted ones too, by id; an id with no product is left out. */
export async function productsById(
  db: MarketDb,
  ids: readonly string[],
): Promise<Map<string, ProductRecord>> {
  const products = await db.products.bulkGet([...ids]);
  return new Map(
    products.flatMap((product) => (product ? [[product.id, product] as const] : [])),
  );
}

/**
 * The live product with this barcode, in any letter case; none for text that is no barcode.
 * `includeDeleted` also finds a deleted product that still holds the code.
 */
export async function findProductByBarcode(
  db: MarketDb,
  code: string,
  { includeDeleted = false }: { includeDeleted?: boolean } = {},
): Promise<ProductRecord | undefined> {
  const barcode = code.trim().toUpperCase();
  if (!BARCODE.test(barcode)) {
    return undefined;
  }
  const product = await db.products.where('barcode').equals(barcode).first();
  return product && (includeDeleted || !product.deletedAt) ? product : undefined;
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

/** A category's live products, by name: the register's grid for that group. */
export async function listProductsInCategory(
  db: MarketDb,
  categoryId: string,
): Promise<ProductRecord[]> {
  const inCategory = await db.products
    .filter((product) => product.categoryId === categoryId && !product.deletedAt)
    .toArray();
  return inCategory.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}

/** Products marked for the quick grid, by name; deleted ones excluded. */
export async function listQuickProducts(db: MarketDb): Promise<ProductRecord[]> {
  const quick = await db.products
    .filter((product) => product.isQuick && !product.deletedAt)
    .toArray();
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
    fields.barcode = canonicalBarcode(input.barcode);
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
      if (key !== 'criticalLevelMilli' && value > MAX_UNIT_PRICE) {
        throw new RangeError(`${key} cannot exceed ${MAX_UNIT_PRICE}, got ${value}`);
      }
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

/**
 * A barcode as it is stored: trimmed and in capitals, so a scanner with Caps Lock on still finds
 * the product. Empty text is no barcode; anything but letters, digits and "-" is refused.
 */
export function canonicalBarcode(raw: string): string | undefined {
  const barcode = raw.trim().toUpperCase();
  if (barcode === '') {
    return undefined;
  }
  if (!BARCODE.test(barcode)) {
    throw new RangeError(`A barcode may only hold letters, digits and "-", got "${raw}"`);
  }
  return barcode;
}

/** A piece product counts whole pieces: its opening stock and critical level too. */
function assertWholePieces(unit: ProductUnit, quantitiesMilli: readonly number[]): void {
  if (unit === 'piece' && quantitiesMilli.some((milli) => milli % 1000 !== 0)) {
    throw new RangeError('A piece product takes whole quantities');
  }
}

function assertNonNegativeInteger(value: number, what: string): void {
  assertSafeInteger(value, what);
  if (value < 0) {
    throw new RangeError(`${what} cannot be negative, got ${value}`);
  }
}

/** Frees `barcode` for `ownerId`: a deleted product gives it up, a live one keeps it. */
async function claimBarcode(
  db: MarketDb,
  barcode: string | undefined,
  ownerId: string,
  at: Date,
): Promise<void> {
  if (barcode === undefined) {
    return;
  }
  const holder = await db.products.where('barcode').equals(barcode).first();
  if (!holder || holder.id === ownerId) {
    return;
  }
  if (!holder.deletedAt) {
    throw new DuplicateBarcodeError(barcode, holder.name);
  }
  const stamp = at.toISOString();
  const released = { ...holder, updatedAt: stamp };
  delete released.barcode;
  await db.products.put(released);
  await appendOutbox(
    db,
    {
      kind: 'patch',
      table: 'products',
      recordId: holder.id,
      patch: { barcode: null, updatedAt: stamp },
    },
    at,
  );
}
