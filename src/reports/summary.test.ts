import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCategory } from '@/data/categories';
import { createCustomer } from '@/data/customers';
import type { MarketDb } from '@/data/db';
import { createProduct } from '@/data/products';
import { recordReturn } from '@/data/returns';
import { recordSale } from '@/data/sales';
import type { Payment } from '@/data/types';
import { voidSale } from '@/data/voids';
import { makeTestDb } from '@/test/db';
import { buildSummary, loadSummary } from './summary';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

// Noon in Istanbul on the given day of October 2026.
const day = (n: number, minute = 0) => new Date(Date.UTC(2026, 9, n, 9, minute));
const date = (n: number) => `2026-10-${String(n).padStart(2, '0')}`;

async function setup() {
  const drinks = await createCategory(db, 'İçecek', day(1));
  const tea = await createProduct(
    db,
    { name: 'Çay', sellPrice: 9000, buyPrice: 7000, vatRate: 1, categoryId: drinks.id },
    day(1),
  );
  const cola = await createProduct(
    db,
    { name: 'Kola', sellPrice: 3000, buyPrice: 2000, vatRate: 20 },
    day(1),
  );
  const ahmet = await createCustomer(db, { name: 'Ahmet' }, day(1));
  const sell = (
    at: Date,
    lines: { productId: string; qtyMilli: number }[],
    payments: Payment[],
    deviceCode = 'K1',
  ) =>
    recordSale(db, {
      deviceCode,
      at,
      lines,
      payments,
      ...(payments.some((payment) => payment.method === 'credit') ? { customerId: ahmet.id } : {}),
    });
  return { tea, cola, sell };
}

describe('buildSummary', () => {
  it('splits payments and leaves voided sales out', async () => {
    const { tea, cola, sell } = await setup();
    await sell(
      day(29),
      [{ productId: tea.id, qtyMilli: 2000 }],
      [
        { method: 'cash', amount: 10000 },
        { method: 'card', amount: 8000 },
      ],
    );
    await sell(
      day(29, 1),
      [{ productId: cola.id, qtyMilli: 1000 }],
      [{ method: 'credit', amount: 3000 }],
    );
    const voided = await sell(
      day(29, 2),
      [{ productId: cola.id, qtyMilli: 1000 }],
      [{ method: 'cash', amount: 3000 }],
    );
    await voidSale(db, {
      saleId: voided.id,
      reason: 'Yanlış ürün',
      deviceCode: 'K1',
      at: day(29, 3),
    });
    const summary = await loadSummary(db, { from: date(29), to: date(29) });
    expect(summary).toMatchObject({
      salesCount: 2,
      gross: 21000,
      net: 21000,
      voidCount: 1,
      voidTotal: 3000,
      byMethod: { cash: 10000, card: 8000, credit: 3000 },
      averageBasket: 10500,
    });
  });

  it('takes returns off by how they were refunded', async () => {
    const { tea, sell } = await setup();
    const sale = await sell(
      day(29),
      [{ productId: tea.id, qtyMilli: 2000 }],
      [
        { method: 'cash', amount: 10000 },
        { method: 'card', amount: 8000 },
      ],
    );
    // Card is refunded before cash: 80 back to the card, 10 in cash.
    await recordReturn(db, {
      saleId: sale.id,
      lines: [{ productId: tea.id, qtyMilli: 1000 }],
      deviceCode: 'K1',
      at: day(29, 5),
    });
    const summary = await loadSummary(db, { from: date(29), to: date(29) });
    expect(summary).toMatchObject({
      salesCount: 1,
      gross: 18000,
      returnCount: 1,
      returnTotal: 9000,
      net: 9000,
      byMethod: { cash: 9000, card: 0, credit: 0 },
    });
  });

  it('breaks down VAT, cost, categories and best sellers', async () => {
    const { tea, cola, sell } = await setup();
    const sale = await sell(
      day(29),
      [
        { productId: tea.id, qtyMilli: 2000 },
        { productId: cola.id, qtyMilli: 3000 },
      ],
      [{ method: 'cash', amount: 27000 }],
    );
    await recordReturn(db, {
      saleId: sale.id,
      lines: [{ productId: tea.id, qtyMilli: 1000 }],
      deviceCode: 'K1',
      at: day(29, 5),
    });
    const summary = await loadSummary(db, { from: date(29), to: date(29) });
    // One tea (90,00 at %1) and three colas (90,00 at %20) stay sold.
    expect(summary.vatByRate).toEqual([
      { rate: 1, base: 8911, vat: 89 },
      { rate: 20, base: 7500, vat: 1500 },
    ]);
    expect(summary).toMatchObject({ net: 18000, cost: 13000, grossProfit: 5000 });
    expect(summary.categories).toEqual([
      { categoryId: undefined, name: 'Kategorisiz', net: 9000, qtyMilli: 3000 },
      { categoryId: tea.categoryId, name: 'İçecek', net: 9000, qtyMilli: 1000 },
    ]);
    expect(summary.bestSellers.map((row) => [row.name, row.qtyMilli, row.net])).toEqual([
      ['Kola', 3000, 9000],
      ['Çay', 1000, 9000],
    ]);
  });

  it('reads a range of business days, one register or all', async () => {
    const { cola, sell } = await setup();
    const early = await sell(
      day(28),
      [{ productId: cola.id, qtyMilli: 1000 }],
      [{ method: 'cash', amount: 3000 }],
    );
    await sell(
      day(29),
      [{ productId: cola.id, qtyMilli: 2000 }],
      [{ method: 'card', amount: 6000 }],
      'K2',
    );
    // The 28th's sale is voided on the 29th: cash goes back out on the 29th.
    await voidSale(db, { saleId: early.id, reason: 'İade', deviceCode: 'K1', at: day(29, 10) });
    expect(await loadSummary(db, { from: date(28), to: date(28) })).toMatchObject({
      salesCount: 1,
      net: 3000,
      voidCount: 0,
    });
    expect(await loadSummary(db, { from: date(29), to: date(29) })).toMatchObject({
      salesCount: 1,
      net: 3000,
      voidCount: 1,
      voidTotal: 3000,
      byMethod: { cash: -3000, card: 6000, credit: 0 },
    });
    // Over both days the voided sale counts nowhere.
    expect(await loadSummary(db, { from: date(28), to: date(29) })).toMatchObject({
      salesCount: 1,
      net: 6000,
      voidCount: 1,
      byMethod: { cash: 0, card: 6000, credit: 0 },
    });
    const k2 = await loadSummary(db, { from: date(28), to: date(29), deviceCode: 'K2' });
    expect(k2).toMatchObject({ salesCount: 1, net: 6000, voidCount: 0 });
    expect((await loadSummary(db, { from: date(29), to: date(29) })).byDevice).toEqual([
      { deviceCode: 'K1', salesCount: 0, net: -3000 },
      { deviceCode: 'K2', salesCount: 1, net: 6000 },
    ]);
  });

  it('shows an empty day as zeros', () => {
    const summary = buildSummary({
      sales: [],
      voids: [],
      returns: [],
      salesById: new Map(),
      products: [],
      categories: [],
    });
    expect(summary).toMatchObject({
      salesCount: 0,
      gross: 0,
      net: 0,
      averageBasket: 0,
      grossProfit: 0,
      vatByRate: [],
      bestSellers: [],
      byDevice: [],
    });
  });
});
