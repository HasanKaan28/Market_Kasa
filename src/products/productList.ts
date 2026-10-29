import { normalizeForSearch } from '@/data/text';
import type { CategoryRecord, ProductRecord } from '@/data/types';

export type ProductFilter = 'all' | 'critical' | 'quick' | 'deleted';

/** Every category, products without a live category, or the id of one category. */
export type CategoryChoice = 'any' | 'none' | string;

export type ProductListQuery = { text: string; filter: ProductFilter; category: CategoryChoice };

export type ProductRow = {
  product: ProductRecord;
  stockMilli: number;
  /** Absent when the product has no category or its category was deleted. */
  categoryName?: string;
  critical: boolean;
};

/**
 * The rows of the products screen, by name. "Silinenler" shows only deleted products and every
 * other filter only live ones; text matches a name anywhere or a barcode from its start.
 */
export function buildProductRows(
  products: readonly ProductRecord[],
  levels: ReadonlyMap<string, number>,
  categories: readonly CategoryRecord[],
  query: ProductListQuery,
): ProductRow[] {
  const categoryNames = new Map(
    categories
      .filter((category) => !category.deletedAt)
      .map((category) => [category.id, category.name]),
  );
  const needle = normalizeForSearch(query.text);
  return products
    .filter(
      (product) =>
        (query.filter === 'deleted') === Boolean(product.deletedAt) &&
        matchesText(product, needle) &&
        matchesCategory(product, query.category, categoryNames),
    )
    .map((product) => {
      const stockMilli = levels.get(product.id) ?? 0;
      const categoryName = product.categoryId ? categoryNames.get(product.categoryId) : undefined;
      return { product, stockMilli, categoryName, critical: isCritical(product, stockMilli) };
    })
    .filter(
      (row) =>
        (query.filter !== 'critical' || row.critical) &&
        (query.filter !== 'quick' || row.product.isQuick),
    )
    .sort((a, b) => a.product.name.localeCompare(b.product.name, 'tr'));
}

/** Live products at or below their critical level. */
export function criticalCount(
  products: readonly ProductRecord[],
  levels: ReadonlyMap<string, number>,
): number {
  return products.filter(
    (product) => !product.deletedAt && isCritical(product, levels.get(product.id) ?? 0),
  ).length;
}

/** A level of 0 means the product is never critical. */
function isCritical(product: ProductRecord, stockMilli: number): boolean {
  return product.criticalLevelMilli > 0 && stockMilli <= product.criticalLevelMilli;
}

function matchesText(product: ProductRecord, needle: string): boolean {
  return (
    needle === '' ||
    normalizeForSearch(product.name).includes(needle) ||
    normalizeForSearch(product.barcode ?? '').startsWith(needle)
  );
}

function matchesCategory(
  product: ProductRecord,
  choice: CategoryChoice,
  categoryNames: ReadonlyMap<string, string>,
): boolean {
  if (choice === 'any') {
    return true;
  }
  if (choice === 'none') {
    return !product.categoryId || !categoryNames.has(product.categoryId);
  }
  return product.categoryId === choice;
}
