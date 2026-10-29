import { createCategory, listCategories, MAX_CATEGORY_NAME_LENGTH } from '@/data/categories';
import type { MarketDb } from '@/data/db';
import { createProduct, restoreProduct, updateProduct, type ProductPatch } from '@/data/products';
import { normalizeForSearch } from '@/data/text';
import type { CategoryRecord, ProductRecord } from '@/data/types';
import { formatTRY } from '@/domain/money';
import { formatQtyInput } from '@/pos/format';
import {
  IMPORT_FIELD_LABELS,
  type ImportField,
  type ImportRow,
  type ImportValues,
} from './importRows';
import { fractionalStockError } from './productForm';

const UNIT_NAMES = { piece: 'Adet', kg: 'Kg' } as const;

export type ImportAction = 'create' | 'update' | 'unchanged' | 'error';

/** What the import will do with one row, as the preview shows it. */
export type PlannedRow = {
  rowNumber: number;
  action: ImportAction;
  name: string;
  productId?: string;
  restore?: boolean;
  /** The product has no barcode yet and takes the row's. */
  giveBarcode?: boolean;
  /** The labels of the fields that change, e.g. "Satış fiyatı". */
  changes: string[];
  errors: string[];
  warnings: string[];
};

export type ImportPlan = {
  rows: PlannedRow[];
  /** Categories the file names that do not exist yet, spelled as first seen. */
  newCategories: string[];
  counts: Record<ImportAction, number>;
};

// The product fields a row can change, and the import field each comes from.
const COMPARED = [
  ['name', 'name'],
  ['unit', 'unit'],
  ['sellPrice', 'sellPrice'],
  ['buyPrice', 'buyPrice'],
  ['vatRate', 'vatRate'],
  ['criticalLevelMilli', 'criticalLevel'],
  ['isQuick', 'isQuick'],
] as const;

/**
 * Works out, without writing, what importing the rows would do. A row finds its product by
 * barcode (deleted ones too, which come back), else by name among live barcodeless products,
 * else it is a new product. The first of two rows naming the same product wins.
 */
export function planImport(
  rows: readonly ImportRow[],
  products: readonly ProductRecord[],
  categories: readonly CategoryRecord[],
  /** Each product's stock, by id: a weighed product turns to pieces only with whole stock. */
  stock: ReadonlyMap<string, number>,
): ImportPlan {
  const byBarcode = new Map<string, ProductRecord>();
  const liveByName = new Map<string, ProductRecord[]>();
  for (const product of products) {
    if (product.barcode) {
      byBarcode.set(product.barcode, product);
    }
    if (!product.deletedAt) {
      const key = normalizeForSearch(product.name);
      liveByName.set(key, [...(liveByName.get(key) ?? []), product]);
    }
  }
  const liveCategories = categories.filter((category) => !category.deletedAt);
  const categoryIds = new Map(
    liveCategories.map((category) => [normalizeForSearch(category.name), category.id]),
  );
  const categoryNames = new Map(liveCategories.map((category) => [category.id, category.name]));
  const newCategories = new Map<string, string>();
  const firstRow = new Map<string, number>();

  const planned = rows.map((row): PlannedRow => {
    const { fields } = row;
    const base: PlannedRow = {
      rowNumber: row.rowNumber,
      action: 'error',
      name: fields.name ?? '',
      changes: [],
      errors: [...row.errors],
      warnings: [...row.warnings],
    };
    // A row that could not be read is reported as it is, without guessing what it meant.
    if (base.errors.length > 0) {
      return base;
    }
    const identity = fields.barcode
      ? `barcode:${fields.barcode}`
      : fields.name
        ? `name:${normalizeForSearch(fields.name)}`
        : undefined;
    if (identity !== undefined) {
      const first = firstRow.get(identity);
      if (first !== undefined) {
        base.errors.push(`Bu ürün dosyada ${first}. satırda da var.`);
      } else {
        firstRow.set(identity, row.rowNumber);
      }
    }
    const match = findProduct(fields, byBarcode, liveByName);
    base.errors.push(...match.errors);
    base.warnings.push(...match.warnings);
    const { product } = match;
    checkWritable(fields, product, product && (stock.get(product.id) ?? 0), base.errors);
    if (base.errors.length > 0) {
      return base;
    }
    const category = fields.category?.trim();
    const categoryKey = category ? normalizeForSearch(category) : undefined;
    if (category && categoryKey && !categoryIds.has(categoryKey)) {
      newCategories.set(categoryKey, newCategories.get(categoryKey) ?? category);
    }
    if (!product) {
      return { ...base, action: 'create' };
    }
    const changes = describeChanges(product, fields, match.giveBarcode);
    if (category && categoryKey) {
      const targetId = categoryIds.get(categoryKey);
      // A category that does not exist yet is always a change: it is created for this product.
      if (targetId === undefined || targetId !== product.categoryId) {
        const before = product.categoryId ? categoryNames.get(product.categoryId) : undefined;
        const after = targetId ? (categoryNames.get(targetId) ?? category) : category;
        changes.push(`${IMPORT_FIELD_LABELS.category}: ${before ?? 'yok'} → ${after}`);
      }
    }
    const restore = Boolean(product.deletedAt);
    return {
      ...base,
      name: fields.name ?? product.name,
      productId: product.id,
      changes,
      ...(restore ? { restore } : {}),
      ...(match.giveBarcode ? { giveBarcode: true } : {}),
      action: changes.length > 0 || restore ? 'update' : 'unchanged',
    };
  });

  const counts: Record<ImportAction, number> = { create: 0, update: 0, unchanged: 0, error: 0 };
  for (const row of planned) {
    counts[row.action] += 1;
  }
  return { rows: planned, newCategories: [...newCategories.values()], counts };
}

type Match = {
  product?: ProductRecord;
  giveBarcode: boolean;
  errors: string[];
  warnings: string[];
};

/**
 * The product a row means. A barcode finds its product, deleted ones too; an unknown barcode
 * goes to the one live barcodeless product of the row's name, which then gets it. A row without
 * a barcode finds the one live product of its name, with or without a barcode.
 */
function findProduct(
  fields: Partial<ImportValues>,
  byBarcode: ReadonlyMap<string, ProductRecord>,
  liveByName: ReadonlyMap<string, readonly ProductRecord[]>,
): Match {
  const named = fields.name ? (liveByName.get(normalizeForSearch(fields.name)) ?? []) : [];
  if (fields.barcode) {
    const product = byBarcode.get(fields.barcode);
    if (product) {
      return { product, giveBarcode: false, errors: [], warnings: [] };
    }
    const barcodeless = named.filter((candidate) => !candidate.barcode);
    if (barcodeless.length === 1) {
      return { product: barcodeless[0], giveBarcode: true, errors: [], warnings: [] };
    }
    const warnings =
      named.length > 0 ? ['Bu adla başka bir ürün var; bu satır yeni ürün olarak eklenir.'] : [];
    return { giveBarcode: false, errors: [], warnings };
  }
  if (named.length > 1) {
    return { giveBarcode: false, errors: ['Aynı adlı birden çok ürün var.'], warnings: [] };
  }
  return { product: named[0], giveBarcode: false, errors: [], warnings: [] };
}

/** What the writes would refuse, found now so the preview names the row instead of failing later. */
function checkWritable(
  fields: Partial<ImportValues>,
  product: ProductRecord | undefined,
  stockMilli: number | undefined,
  errors: string[],
): void {
  if (!product) {
    if (!fields.name) {
      errors.push('Yeni ürün için ürün adı gerekli.');
    }
    if (fields.sellPrice === undefined) {
      errors.push('Yeni ürün için satış fiyatı gerekli.');
    }
    if ((fields.stockMilli ?? 0) < 0) {
      errors.push('Stok eksi olamaz.');
    }
  }
  // A piece product counts whole pieces. An existing product's stock is never imported, so its
  // check is the critical level it ends up with, from the file or as stored.
  const unit = fields.unit ?? product?.unit ?? 'piece';
  const quantities = product
    ? fields.unit !== undefined || fields.criticalLevelMilli !== undefined
      ? [fields.criticalLevelMilli ?? product.criticalLevelMilli]
      : []
    : [fields.stockMilli, fields.criticalLevelMilli];
  if (unit === 'piece' && quantities.some((milli) => milli !== undefined && milli % 1000 !== 0)) {
    errors.push('Adet için tam sayı girin.');
  }
  if (
    product &&
    product.unit !== 'piece' &&
    fields.unit === 'piece' &&
    stockMilli !== undefined &&
    stockMilli % 1000 !== 0
  ) {
    errors.push(fractionalStockError(stockMilli, product.unit));
  }
  const category = fields.category?.trim();
  if (category && Array.from(category).length > MAX_CATEGORY_NAME_LENGTH) {
    errors.push(`Kategori adı en fazla ${MAX_CATEGORY_NAME_LENGTH} karakter olabilir.`);
  }
}

/**
 * Writes the planned creates and updates in one transaction: if any write fails (another
 * register took a barcode meanwhile), nothing is written. A product's stock never changes
 * here; a new product's stock column becomes its opening count.
 */
export async function applyImport(
  db: MarketDb,
  plan: ImportPlan,
  rows: readonly ImportRow[],
  at: Date,
): Promise<{ created: number; updated: number }> {
  const fieldsOf = new Map(rows.map((row) => [row.rowNumber, row.fields]));
  const tables = [db.products, db.categories, db.stockMovements, db.stockLevels, db.outbox];
  return db.transaction('rw', tables, async () => {
    const categoryIds = new Map(
      (await listCategories(db)).map((category) => [
        normalizeForSearch(category.name),
        category.id,
      ]),
    );
    for (const name of plan.newCategories) {
      const key = normalizeForSearch(name);
      if (!categoryIds.has(key)) {
        categoryIds.set(key, (await createCategory(db, name, at)).id);
      }
    }
    let created = 0;
    let updated = 0;
    for (const planned of plan.rows) {
      const fields = fieldsOf.get(planned.rowNumber) ?? {};
      const categoryId = fields.category
        ? categoryIds.get(normalizeForSearch(fields.category))
        : undefined;
      if (planned.action === 'create' && fields.name && fields.sellPrice !== undefined) {
        await createProduct(
          db,
          {
            ...productFields(fields),
            name: fields.name,
            sellPrice: fields.sellPrice,
            vatRate: fields.vatRate ?? 1,
            barcode: fields.barcode,
            categoryId,
          },
          at,
          { openingStockMilli: fields.stockMilli ?? 0 },
        );
        created += 1;
      } else if (planned.action === 'update' && planned.productId) {
        if (planned.restore) {
          await restoreProduct(db, planned.productId, at);
        }
        // A restore alone changes no field, and an empty patch would still be queued.
        if (planned.changes.length > 0) {
          await updateProduct(
            db,
            planned.productId,
            {
              ...productFields(fields),
              ...(categoryId ? { categoryId } : {}),
              ...(planned.giveBarcode ? { barcode: fields.barcode } : {}),
            },
            at,
          );
        }
        updated += 1;
      }
    }
    return { created, updated };
  });
}

/** The fields of a row that set product fields directly (no barcode, category or stock). */
function productFields(fields: Partial<ImportValues>): ProductPatch {
  const patch: Record<string, unknown> = {};
  for (const [productField, importField] of COMPARED) {
    const value = fields[importField === 'criticalLevel' ? 'criticalLevelMilli' : importField];
    if (value !== undefined) {
      patch[productField] = value;
    }
  }
  return patch as ProductPatch;
}

/** "Satış fiyatı: ₺42,50 → ₺45,00" for each field the row changes, so a wrong column shows. */
function describeChanges(
  product: ProductRecord,
  fields: Partial<ImportValues>,
  giveBarcode: boolean,
): string[] {
  const changes: string[] = [];
  const add = (field: ImportField, before: string, after: string) => {
    changes.push(`${IMPORT_FIELD_LABELS[field]}: ${before} → ${after}`);
  };
  if (giveBarcode && fields.barcode) {
    add('barcode', 'yok', fields.barcode);
  }
  if (fields.name !== undefined && fields.name !== product.name) {
    add('name', product.name, fields.name);
  }
  if (fields.unit !== undefined && fields.unit !== product.unit) {
    add('unit', UNIT_NAMES[product.unit], UNIT_NAMES[fields.unit]);
  }
  for (const field of ['sellPrice', 'buyPrice'] as const) {
    const value = fields[field];
    if (value !== undefined && value !== product[field]) {
      add(field, formatTRY(product[field]), formatTRY(value));
    }
  }
  if (fields.vatRate !== undefined && fields.vatRate !== product.vatRate) {
    add('vatRate', `%${product.vatRate}`, `%${fields.vatRate}`);
  }
  const critical = fields.criticalLevelMilli;
  if (critical !== undefined && critical !== product.criticalLevelMilli) {
    add('criticalLevel', formatQtyInput(product.criticalLevelMilli), formatQtyInput(critical));
  }
  if (fields.isQuick !== undefined && fields.isQuick !== product.isQuick) {
    add('isQuick', product.isQuick ? 'Evet' : 'Hayır', fields.isQuick ? 'Evet' : 'Hayır');
  }
  return changes;
}
