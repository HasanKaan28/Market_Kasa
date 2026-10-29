import { createCategory, listCategories } from '@/data/categories';
import type { MarketDb } from '@/data/db';
import { createProduct, restoreProduct, updateProduct, type ProductPatch } from '@/data/products';
import { normalizeForSearch } from '@/data/text';
import type { CategoryRecord, ProductRecord, ProductUnit } from '@/data/types';
import { IMPORT_FIELD_LABELS, type ImportRow, type ImportValues } from './importRows';

export type ImportAction = 'create' | 'update' | 'unchanged' | 'error';

/** What the import will do with one row, as the preview shows it. */
export type PlannedRow = {
  rowNumber: number;
  action: ImportAction;
  name: string;
  productId?: string;
  restore?: boolean;
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
): ImportPlan {
  const byBarcode = new Map<string, ProductRecord>();
  const byName = new Map<string, ProductRecord[]>();
  for (const product of products) {
    if (product.barcode) {
      byBarcode.set(product.barcode, product);
    } else if (!product.deletedAt) {
      const key = normalizeForSearch(product.name);
      byName.set(key, [...(byName.get(key) ?? []), product]);
    }
  }
  const categoryIds = new Map(
    categories
      .filter((category) => !category.deletedAt)
      .map((category) => [normalizeForSearch(category.name), category.id]),
  );
  const newCategories = new Map<string, string>();
  const firstRow = new Map<string, number>();

  const planned = rows.map((row): PlannedRow => {
    const { fields } = row;
    const base = {
      rowNumber: row.rowNumber,
      name: fields.name ?? '',
      changes: [],
      errors: [...row.errors],
      warnings: [...row.warnings],
    };
    // A row that could not be read is reported as it is, without guessing what it meant.
    if (base.errors.length > 0) {
      return { ...base, action: 'error' };
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
    const matches = fields.barcode
      ? [byBarcode.get(fields.barcode)].filter((product) => product !== undefined)
      : fields.name
        ? (byName.get(normalizeForSearch(fields.name)) ?? [])
        : [];
    if (matches.length > 1) {
      base.errors.push('Aynı adlı birden çok ürün var.');
    }
    const product = matches.length === 1 ? matches[0] : undefined;
    if (!product) {
      if (!fields.name) {
        base.errors.push('Yeni ürün için ürün adı gerekli.');
      }
      if (fields.sellPrice === undefined) {
        base.errors.push('Yeni ürün için satış fiyatı gerekli.');
      }
    }
    // An existing product's stock is never imported, so only a new product's stock is checked.
    checkWholeQuantities(
      product ? { ...fields, stockMilli: undefined } : fields,
      fields.unit ?? product?.unit ?? 'piece',
      base.errors,
    );
    if (base.errors.length > 0) {
      return { ...base, action: 'error' };
    }
    const category = fields.category?.trim();
    const categoryKey = category ? normalizeForSearch(category) : undefined;
    if (
      category &&
      categoryKey &&
      !categoryIds.has(categoryKey) &&
      !newCategories.has(categoryKey)
    ) {
      newCategories.set(categoryKey, category);
    }
    if (!product) {
      return { ...base, action: 'create' };
    }
    const changes = changedLabels(product, fields, categoryKey, categoryIds);
    const restore = Boolean(product.deletedAt);
    return {
      ...base,
      name: fields.name ?? product.name,
      productId: product.id,
      changes,
      ...(restore ? { restore } : {}),
      action: changes.length > 0 || restore ? 'update' : 'unchanged',
    };
  });

  const counts: Record<ImportAction, number> = { create: 0, update: 0, unchanged: 0, error: 0 };
  for (const row of planned) {
    counts[row.action] += 1;
  }
  return { rows: planned, newCategories: [...newCategories.values()], counts };
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
            { ...productFields(fields), ...(categoryId ? { categoryId } : {}) },
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

function changedLabels(
  product: ProductRecord,
  fields: Partial<ImportValues>,
  categoryKey: string | undefined,
  categoryIds: ReadonlyMap<string, string>,
): string[] {
  const patch = productFields(fields) as Record<string, unknown>;
  const labels = COMPARED.filter(
    ([productField]) =>
      patch[productField] !== undefined &&
      patch[productField] !== product[productField as keyof ProductRecord],
  ).map(([, importField]) => IMPORT_FIELD_LABELS[importField]);
  if (categoryKey !== undefined && categoryIds.get(categoryKey) !== product.categoryId) {
    labels.push(IMPORT_FIELD_LABELS.category);
  }
  return labels;
}

/** A piece product counts whole pieces, for its stock and its critical level alike. */
function checkWholeQuantities(
  fields: Partial<ImportValues>,
  unit: ProductUnit,
  errors: string[],
): void {
  const fractional = [fields.stockMilli, fields.criticalLevelMilli].some(
    (milli) => milli !== undefined && milli % 1000 !== 0,
  );
  if (unit === 'piece' && fractional) {
    errors.push('Adet için tam sayı girin.');
  }
}
