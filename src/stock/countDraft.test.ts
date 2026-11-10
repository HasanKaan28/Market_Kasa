import { describe, expect, it } from 'vitest';
import type { ProductRecord } from '@/data/types';
import {
  addToCount,
  countProduct,
  EMPTY_COUNT,
  loadCountDraft,
  readCountLines,
  saveCountDraft,
} from './countDraft';

const stamp = '2026-10-29T09:00:00.000Z';

function product(id: string, fields: Partial<ProductRecord> = {}): ProductRecord {
  return {
    id,
    name: id,
    unit: 'piece',
    sellPrice: 1000,
    buyPrice: 0,
    vatRate: 1,
    isQuick: false,
    criticalLevelMilli: 0,
    createdAt: stamp,
    updatedAt: stamp,
    ...fields,
  };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

describe('countDraft', () => {
  it('counts a scanned piece product up and waits for a weight', () => {
    const tea = product('tea', { name: 'Çay' });
    const cheese = product('cheese', { name: 'Peynir', unit: 'kg' });
    const once = countProduct(EMPTY_COUNT, tea);
    expect(once.lines).toEqual([{ productId: 'tea', name: 'Çay', unit: 'piece', counted: '1' }]);
    expect(countProduct(once, tea).lines.map((line) => line.counted)).toEqual(['2']);
    const weighed = countProduct(countProduct(EMPTY_COUNT, cheese), cheese);
    expect(weighed.lines.map((line) => line.counted)).toEqual(['']);
    // Added by hand (a search or a recount), nothing is counted yet.
    expect(addToCount(EMPTY_COUNT, tea).lines.map((line) => line.counted)).toEqual(['']);
    expect(addToCount(once, tea)).toBe(once);
  });

  it('reads counted amounts, zero included, and names what is wrong', () => {
    const products = new Map([
      ['a', product('a')],
      ['b', product('b')],
      ['c', product('c')],
      ['d', product('d')],
      ['e', product('e', { unit: 'kg' })],
      ['f', product('f', { deletedAt: stamp })],
    ]);
    const draft = {
      note: '',
      lines: [
        { productId: 'a', name: 'A', unit: 'piece' as const, counted: '' },
        { productId: 'b', name: 'B', unit: 'piece' as const, counted: '0' },
        { productId: 'c', name: 'C', unit: 'piece' as const, counted: '1,5' },
        { productId: 'd', name: 'D', unit: 'piece' as const, counted: 'x' },
        { productId: 'e', name: 'E', unit: 'kg' as const, counted: '2,5' },
        { productId: 'f', name: 'F', unit: 'piece' as const, counted: '3' },
      ],
    };
    const read = readCountLines(draft, products);
    expect(read.errors).toEqual(
      new Map([
        ['a', 'Sayılan miktarı girin.'],
        ['c', 'Adet için tam sayı girin.'],
        ['d', 'Geçerli bir miktar girin.'],
        ['f', 'Bu ürün silinmiş; satırı çıkarın.'],
      ]),
    );
    expect(read.lines).toEqual([
      { productId: 'b', countedMilli: 0 },
      { productId: 'e', countedMilli: 2500 },
    ]);
  });

  it('keeps a draft in storage and ignores a broken one', () => {
    const storage = memoryStorage();
    const draft = { ...countProduct(EMPTY_COUNT, product('tea')), note: 'Raf 3' };
    saveCountDraft(draft, storage);
    expect(loadCountDraft(storage)).toEqual(draft);
    expect(loadCountDraft(memoryStorage({ 'mk2.stockCount': '{"lines":[{"counted":3}]}' }))).toEqual(
      EMPTY_COUNT,
    );
    expect(loadCountDraft(memoryStorage({ 'mk2.stockCount': 'not json' }))).toEqual(EMPTY_COUNT);
  });
});
