import { describe, expect, it } from 'vitest';
import type { CategoryRecord, ProductRecord } from '@/data/types';
import {
  buildProductRows,
  criticalCount,
  indexProducts,
  type ProductListQuery,
} from './productList';

const stamp = '2026-10-29T09:00:00.000Z';

function product(id: string, fields: Partial<ProductRecord> = {}): ProductRecord {
  return {
    id,
    name: id,
    unit: 'piece',
    sellPrice: 100,
    buyPrice: 0,
    vatRate: 1,
    isQuick: false,
    criticalLevelMilli: 0,
    createdAt: stamp,
    updatedAt: stamp,
    ...fields,
  };
}

const bread: CategoryRecord = {
  id: 'c-bread',
  name: 'Ekmek',
  sort: 0,
  createdAt: stamp,
  updatedAt: stamp,
};
const gone: CategoryRecord = { ...bread, id: 'c-gone', name: 'Eski', deletedAt: stamp };

function ids(
  products: readonly ProductRecord[],
  query: Partial<ProductListQuery> = {},
  levels: ReadonlyMap<string, number> = new Map(),
): string[] {
  return buildProductRows(indexProducts(products), levels, [bread, gone], {
    text: '',
    filter: 'all',
    category: 'any',
    ...query,
  }).map((row) => row.product.id);
}

describe('buildProductRows', () => {
  it('filters by text the Turkish way and by barcode prefix in any case', () => {
    const products = [
      product('simit', { name: 'SİMİT' }),
      product('tea', { name: 'Çay 500 g' }),
      product('pen', { name: 'Kalem', barcode: 'BRK-0042' }),
      product('milk', { name: 'Süt', barcode: '8690000000017' }),
    ];
    expect(ids(products)).toEqual(['tea', 'pen', 'simit', 'milk']);
    expect(ids(products, { text: 'simit' })).toEqual(['simit']);
    expect(ids(products, { text: ' cay ' })).toEqual(['tea']);
    expect(ids(products, { text: 'brk-00' })).toEqual(['pen']);
    expect(ids(products, { text: '869' })).toEqual(['milk']);
    expect(ids(products, { text: '0017' })).toEqual([]);
  });

  it('puts products of a deleted or unknown category under Kategorisiz', () => {
    const products = [
      product('a', { categoryId: 'c-bread' }),
      product('b', { categoryId: 'c-gone' }),
      product('c', { categoryId: 'c-missing' }),
      product('d'),
    ];
    expect(ids(products, { category: 'none' })).toEqual(['b', 'c', 'd']);
    expect(ids(products, { category: 'c-bread' })).toEqual(['a']);
    const rows = buildProductRows(indexProducts(products), new Map(), [bread, gone], {
      text: '',
      filter: 'all',
      category: 'any',
    });
    expect(rows.map((row) => row.categoryName)).toEqual(['Ekmek', undefined, undefined, undefined]);
  });

  it('flags critical stock only where a level is set', () => {
    const products = [
      product('low', { criticalLevelMilli: 5000 }),
      product('ok', { criticalLevelMilli: 5000 }),
      product('none'),
      product('empty', { criticalLevelMilli: 1000 }),
      product('deleted', { criticalLevelMilli: 5000, deletedAt: stamp }),
    ];
    const levels = new Map([
      ['low', 5000],
      ['ok', 6000],
      ['none', -1000],
      ['deleted', 0],
    ]);
    expect(ids(products, { filter: 'critical' }, levels)).toEqual(['empty', 'low']);
    const rows = buildProductRows(indexProducts(products), levels, [], {
      text: '',
      filter: 'all',
      category: 'any',
    });
    expect(Object.fromEntries(rows.map((row) => [row.product.id, row.critical]))).toEqual({
      empty: true,
      low: true,
      none: false,
      ok: false,
    });
    expect(rows.find((row) => row.product.id === 'none')?.stockMilli).toBe(-1000);
    expect(criticalCount(products, levels)).toBe(2);
  });

  it('shows deleted products only under Silinenler', () => {
    const products = [
      product('live', { isQuick: true }),
      product('plain'),
      product('deleted', { isQuick: true, deletedAt: stamp }),
    ];
    expect(ids(products)).toEqual(['live', 'plain']);
    expect(ids(products, { filter: 'quick' })).toEqual(['live']);
    expect(ids(products, { filter: 'deleted' })).toEqual(['deleted']);
  });
});
