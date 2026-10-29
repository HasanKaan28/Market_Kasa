import { describe, expect, it } from 'vitest';
import type { ProductRecord } from '@/data/types';
import { addProduct, EMPTY_DRAFT, loadDraft, readDraftLines, saveDraft } from './receiptDraft';

const stamp = '2026-10-29T09:00:00.000Z';

function product(id: string, fields: Partial<ProductRecord> = {}): ProductRecord {
  return {
    id,
    name: id,
    unit: 'piece',
    sellPrice: 4250,
    buyPrice: 3000,
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

describe('receiptDraft', () => {
  it('adds a product and counts it up when added again', () => {
    const milk = product('milk', { name: 'Süt' });
    const once = addProduct(EMPTY_DRAFT, milk);
    expect(once.lines).toEqual([
      {
        productId: 'milk',
        name: 'Süt',
        unit: 'piece',
        qty: '1',
        buyPrice: '30,00',
        sellPrice: '42,50',
      },
    ]);
    expect(addProduct(once, milk).lines.map((line) => line.qty)).toEqual(['2']);
    const cheese = product('cheese', { name: 'Peynir', unit: 'kg', buyPrice: 0 });
    expect(addProduct(EMPTY_DRAFT, cheese).lines[0]).toMatchObject({ qty: '1', buyPrice: '' });
  });

  it('keeps a draft in storage and ignores a broken one', () => {
    const storage = memoryStorage();
    const draft = { ...addProduct(EMPTY_DRAFT, product('milk')), note: 'İrsaliye 7' };
    saveDraft(draft, storage);
    expect(loadDraft(storage)).toEqual(draft);
    expect(loadDraft(memoryStorage({ 'mk2.goodsReceipt': '{"lines":[{"name":3}]}' }))).toEqual(
      EMPTY_DRAFT,
    );
    expect(loadDraft(memoryStorage({ 'mk2.goodsReceipt': 'not json' }))).toEqual(EMPTY_DRAFT);
  });

  it('reads lines and names what is wrong', () => {
    const draft = {
      note: '',
      lines: [
        {
          productId: 'a',
          name: 'A',
          unit: 'piece' as const,
          qty: '12',
          buyPrice: '30',
          sellPrice: '',
        },
        {
          productId: 'b',
          name: 'B',
          unit: 'piece' as const,
          qty: '1,5',
          buyPrice: '',
          sellPrice: '',
        },
        {
          productId: 'c',
          name: 'C',
          unit: 'kg' as const,
          qty: '2,5',
          buyPrice: 'x',
          sellPrice: '',
        },
      ],
    };
    const read = readDraftLines(draft);
    expect(read.errors).toEqual(
      new Map([
        ['b', 'Adet için tam sayı girin.'],
        ['c', 'Geçerli bir tutar girin.'],
      ]),
    );
    expect(read.lines[0]).toEqual({ productId: 'a', qtyMilli: 12000, buyPrice: 3000 });
  });
});
