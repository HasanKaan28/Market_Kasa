import { describe, expect, it } from 'vitest';
import type { ProductRecord } from '@/data/types';
import {
  addProduct,
  draftLineCost,
  EMPTY_DRAFT,
  loadDraft,
  readDraftLines,
  saveDraft,
  shownPrice,
} from './receiptDraft';

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
  it('adds a product without its prices and counts it up when added again', () => {
    const milk = product('milk', { name: 'Süt' });
    const once = addProduct(EMPTY_DRAFT, milk);
    expect(once.lines).toEqual([{ productId: 'milk', name: 'Süt', unit: 'piece', qty: '1' }]);
    expect(addProduct(once, milk).lines.map((line) => line.qty)).toEqual(['2']);
  });

  it('shows the price the product has now until one is typed', () => {
    const [line] = addProduct(EMPTY_DRAFT, product('milk')).lines;
    const raised = product('milk', { buyPrice: 3500, sellPrice: 5000 });
    expect(shownPrice(line!, raised, 'buyPrice')).toBe('35,00');
    expect(shownPrice(line!, raised, 'sellPrice')).toBe('50,00');
    expect(shownPrice(line!, product('milk', { buyPrice: 0 }), 'buyPrice')).toBe('');
    expect(shownPrice({ ...line!, sellPrice: '45' }, raised, 'sellPrice')).toBe('45');
    expect(shownPrice(line!, undefined, 'sellPrice')).toBe('');
  });

  it('sends only the prices that were typed', () => {
    const draft = addProduct(addProduct(EMPTY_DRAFT, product('milk')), product('tea'));
    const typed = {
      ...draft,
      lines: draft.lines.map((line) =>
        line.productId === 'tea' ? { ...line, qty: '3', buyPrice: '', sellPrice: '45' } : line,
      ),
    };
    // Both prices were raised elsewhere after the lines were added.
    const products = new Map([
      ['milk', product('milk', { buyPrice: 3500, sellPrice: 5000 })],
      ['tea', product('tea', { buyPrice: 3500, sellPrice: 5000 })],
    ]);
    expect(readDraftLines(typed, products)).toEqual({
      lines: [
        { productId: 'milk', qtyMilli: 1000 },
        { productId: 'tea', qtyMilli: 3000, sellPrice: 4500 },
      ],
      errors: new Map(),
    });
  });

  it('prices a line at the buy price it will be saved with', () => {
    const [line] = addProduct(EMPTY_DRAFT, product('milk')).lines;
    const milk = product('milk', { buyPrice: 3500 });
    expect(draftLineCost({ ...line!, qty: '12' }, milk)).toBe(42000);
    expect(draftLineCost({ ...line!, qty: '12', buyPrice: ' ' }, milk)).toBe(42000);
    expect(draftLineCost({ ...line!, qty: '12', buyPrice: '30' }, milk)).toBe(36000);
    expect(draftLineCost({ ...line!, qty: 'x' }, milk)).toBeUndefined();
    expect(draftLineCost(line!, undefined)).toBeUndefined();
  });

  it('keeps a draft in storage and ignores a broken one', () => {
    const storage = memoryStorage();
    const draft = { ...addProduct(EMPTY_DRAFT, product('milk')), note: 'İrsaliye 7' };
    saveDraft(draft, storage);
    expect(loadDraft(storage)).toEqual(draft);
    const typed = { note: '', lines: [{ ...draft.lines[0]!, buyPrice: '30', sellPrice: '' }] };
    expect(loadDraft(memoryStorage({ 'mk2.goodsReceipt': JSON.stringify(typed) }))).toEqual(typed);
    const numeric = { note: '', lines: [{ ...draft.lines[0]!, buyPrice: 3000 }] };
    expect(loadDraft(memoryStorage({ 'mk2.goodsReceipt': JSON.stringify(numeric) }))).toEqual(
      EMPTY_DRAFT,
    );
    expect(loadDraft(memoryStorage({ 'mk2.goodsReceipt': '{"lines":[{"name":3}]}' }))).toEqual(
      EMPTY_DRAFT,
    );
    expect(loadDraft(memoryStorage({ 'mk2.goodsReceipt': 'not json' }))).toEqual(EMPTY_DRAFT);
  });

  it('reads lines and names what is wrong', () => {
    const products = new Map([
      ['a', product('a')],
      ['b', product('b')],
      ['c', product('c', { unit: 'kg' })],
      // Weighed when it was added; counted in pieces now.
      ['d', product('d')],
      ['e', product('e', { deletedAt: stamp })],
    ]);
    const draft = {
      note: '',
      lines: [
        { productId: 'a', name: 'A', unit: 'piece' as const, qty: '12', buyPrice: '30' },
        { productId: 'b', name: 'B', unit: 'piece' as const, qty: '1,5' },
        { productId: 'c', name: 'C', unit: 'kg' as const, qty: '2,5', buyPrice: 'x' },
        { productId: 'd', name: 'D', unit: 'kg' as const, qty: '1,5' },
        { productId: 'e', name: 'E', unit: 'piece' as const, qty: '1' },
        { productId: 'f', name: 'F', unit: 'piece' as const, qty: '1' },
      ],
    };
    const read = readDraftLines(draft, products);
    expect(read.errors).toEqual(
      new Map([
        ['b', 'Adet için tam sayı girin.'],
        ['c', 'Geçerli bir tutar girin.'],
        ['d', 'Adet için tam sayı girin.'],
        ['e', 'Bu ürün silinmiş; satırı çıkarın.'],
        ['f', 'Bu ürün silinmiş; satırı çıkarın.'],
      ]),
    );
    expect(read.lines).toEqual([{ productId: 'a', qtyMilli: 12000, buyPrice: 3000 }]);
  });

  it('reads VAT-exclusive prices with each product\u2019s rate', () => {
    const products = new Map([
      ['tea', product('tea', { vatRate: 20 })],
      ['cheese', product('cheese', { unit: 'kg', vatRate: 1 })],
    ]);
    const draft = {
      note: '',
      pricesExclusive: true,
      lines: [
        { productId: 'tea', name: 'tea', unit: 'piece' as const, qty: '2', buyPrice: '10' },
        { productId: 'cheese', name: 'cheese', unit: 'kg' as const, qty: '1', buyPrice: '9,99' },
      ],
    };
    expect(readDraftLines(draft, products).lines).toEqual([
      { productId: 'tea', qtyMilli: 2000, buyPrice: 1200, cost: 2400 },
      { productId: 'cheese', qtyMilli: 1000, buyPrice: 1009, cost: 1009 },
    ]);
    expect(draftLineCost(draft.lines[0]!, products.get('tea'), true)).toBe(2400);
  });

  it('takes free goods at no cost', () => {
    const products = new Map([['tea', product('tea', { buyPrice: 3000 })]]);
    const line = {
      productId: 'tea',
      name: 'tea',
      unit: 'piece' as const,
      qty: '6',
      buyPrice: '30',
      free: true,
    };
    expect(readDraftLines({ note: '', lines: [line] }, products).lines).toEqual([
      { productId: 'tea', qtyMilli: 6000, free: true },
    ]);
    expect(draftLineCost(line, products.get('tea'))).toBe(0);
  });

  it('adds VAT to the line, as the invoice does, not to the unit price', () => {
    const products = new Map([['tea', product('tea', { vatRate: 20 })]]);
    const line = {
      productId: 'tea',
      name: 'tea',
      unit: 'piece' as const,
      qty: '24',
      buyPrice: '8,33',
    };
    expect(
      readDraftLines({ note: '', pricesExclusive: true, lines: [line] }, products).lines,
    ).toEqual([{ productId: 'tea', qtyMilli: 24000, buyPrice: 1000, cost: 23990 }]);
    expect(draftLineCost(line, products.get('tea'), true)).toBe(23990);
  });

  it('reads a free line whatever its price box holds', () => {
    const products = new Map([['tea', product('tea')]]);
    const line = {
      productId: 'tea',
      name: 'tea',
      unit: 'piece' as const,
      qty: '2',
      buyPrice: 'x',
      free: true,
    };
    expect(readDraftLines({ note: '', lines: [line] }, products)).toEqual({
      lines: [{ productId: 'tea', qtyMilli: 2000, free: true }],
      errors: new Map(),
    });
  });

  it('drops a stored draft with an unknown payment', () => {
    const stored = JSON.stringify({ note: '', lines: [], payment: 'credit' });
    expect(loadDraft({ getItem: () => stored })).toEqual(EMPTY_DRAFT);
  });
});
