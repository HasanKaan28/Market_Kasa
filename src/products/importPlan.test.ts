import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCategory, listCategories } from '@/data/categories';
import type { MarketDb } from '@/data/db';
import { DuplicateBarcodeError } from '@/data/errors';
import { pendingOps } from '@/data/outbox';
import { createProduct, deleteProduct } from '@/data/products';
import { stockOf } from '@/data/stock';
import type { ProductRecord } from '@/data/types';
import { makeTestDb } from '@/test/db';
import { applyImport, planImport } from './importPlan';
import { guessMapping, readImportRows, type ImportRow, type ImportValues } from './importRows';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const at = new Date('2026-10-29T09:00:00Z');
const stamp = at.toISOString();

function row(rowNumber: number, fields: Partial<ImportValues>, errors: string[] = []): ImportRow {
  return { rowNumber, fields, errors, warnings: [] };
}

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

describe('planImport', () => {
  it('plans creates, updates, unchanged rows and errors', () => {
    const milk = product('milk', { name: 'Süt', barcode: '8690000000017', sellPrice: 4250 });
    const bread = product('bread', { name: 'Ekmek', sellPrice: 1500 });
    const plan = planImport(
      [
        row(2, { barcode: '8690000000017', name: 'Süt', sellPrice: 4500 }),
        row(3, { name: 'Ekmek', sellPrice: 1500 }),
        row(4, { barcode: '8690000000099', name: 'Kaşar', sellPrice: 12000 }),
        row(5, { name: 'Kefir' }),
        row(6, {}, ['KDV 0, 1, 10 ya da 20 olmalı.']),
        row(7, { name: 'Kalem', sellPrice: 500, stockMilli: 1500 }),
      ],
      [milk, bread],
      [],
      new Map(),
    );
    expect(plan.rows.map((planned) => [planned.rowNumber, planned.action])).toEqual([
      [2, 'update'],
      [3, 'unchanged'],
      [4, 'create'],
      [5, 'error'],
      [6, 'error'],
      [7, 'error'],
    ]);
    expect(plan.rows[0]).toMatchObject({
      productId: 'milk',
      name: 'Süt',
      changes: ['Satış fiyatı: ₺42,50 → ₺45,00'],
    });
    expect(plan.rows[3]?.errors).toEqual(['Yeni ürün için satış fiyatı gerekli.']);
    expect(plan.rows[4]?.errors).toEqual(['KDV 0, 1, 10 ya da 20 olmalı.']);
    expect(plan.rows[5]?.errors).toEqual(['Adet için tam sayı girin.']);
    expect(plan.counts).toEqual({ create: 1, update: 1, unchanged: 1, error: 3 });
  });

  it('matches a barcodeless product by its name', () => {
    const plan = planImport(
      [row(2, { name: 'simit', sellPrice: 1750 }), row(3, { name: 'Poğaça', sellPrice: 2000 })],
      [
        product('simit', { name: 'SİMİT', sellPrice: 1500 }),
        product('p1', { name: 'Poğaça' }),
        product('p2', { name: 'POĞAÇA' }),
      ],
      [],
      new Map(),
    );
    expect(plan.rows[0]).toMatchObject({ action: 'update', productId: 'simit' });
    expect(plan.rows[1]).toMatchObject({
      action: 'error',
      errors: ['Aynı adlı birden çok ürün var.'],
    });
  });

  it('lets the first of two rows with the same barcode win', () => {
    const plan = planImport(
      [
        row(2, { barcode: '8690000000099', name: 'Kaşar', sellPrice: 12000 }),
        row(3, { name: 'Simit', sellPrice: 1500 }),
        row(5, { barcode: '8690000000099', name: 'Kaşar 2', sellPrice: 13000 }),
        row(6, { name: 'SİMİT', sellPrice: 1600 }),
      ],
      [],
      [],
      new Map(),
    );
    expect(plan.rows.map((planned) => planned.errors)).toEqual([
      [],
      [],
      ['Bu ürün dosyada 2. satırda da var.'],
      ['Bu ürün dosyada 3. satırda da var.'],
    ]);
  });

  it('refuses a stock below zero only for a new product', () => {
    const milk = product('milk', { barcode: '8690000000017', name: 'Süt', sellPrice: 4250 });
    const plan = planImport(
      [
        row(2, { barcode: '8690000000017', sellPrice: 4500, stockMilli: -3000 }),
        row(3, { name: 'Kaşar', sellPrice: 12000, stockMilli: -1000 }),
      ],
      [milk],
      [],
      new Map(),
    );
    expect(plan.rows.map((planned) => [planned.action, planned.errors])).toEqual([
      ['update', []],
      ['error', ['Stok eksi olamaz.']],
    ]);
  });

  it('refuses in the plan what the import could not write', () => {
    const cheese = product('cheese', { name: 'Peynir', unit: 'kg', criticalLevelMilli: 1500 });
    const plan = planImport(
      [
        row(2, { name: 'Peynir', unit: 'piece' }),
        row(3, { name: 'Lokum', sellPrice: 5000, category: 'x'.repeat(41) }),
      ],
      [cheese],
      [],
      new Map(),
    );
    expect(plan.rows.map((planned) => planned.errors)).toEqual([
      ['Adet için tam sayı girin.'],
      ['Kategori adı en fazla 40 karakter olabilir.'],
    ]);
    expect(plan.newCategories).toEqual([]);
  });

  it('refuses to count a product in pieces while its stock is fractional', () => {
    const cheese = product('cheese', { name: 'Peynir', unit: 'kg' });
    const bread = product('bread', { name: 'Ekmek', unit: 'kg' });
    const plan = planImport(
      [row(2, { name: 'Peynir', unit: 'piece' }), row(3, { name: 'Ekmek', unit: 'piece' })],
      [cheese, bread],
      [],
      new Map([
        ['cheese', 1500],
        ['bread', 2000],
      ]),
    );
    expect(plan.rows.map((planned) => [planned.action, planned.errors])).toEqual([
      ['error', ['Stok kesirli (1,5 kg); adede çevirmeden önce stoğu düzeltin.']],
      ['update', []],
    ]);
  });

  it('lets a later row through when the first with its barcode fails', () => {
    const plan = planImport(
      [
        row(2, { barcode: '8690000000017', name: 'Süt' }),
        row(3, { barcode: '8690000000017', name: 'Süt', sellPrice: 4250 }),
      ],
      [],
      [],
      new Map(),
    );
    expect(plan.rows.map((planned) => [planned.action, planned.errors])).toEqual([
      ['error', ['Yeni ürün için satış fiyatı gerekli.']],
      ['create', []],
    ]);
  });

  it('warns that a new product with a blank VAT cell gets %1', () => {
    const milk = product('milk', { name: 'Süt', barcode: '8690000000017', sellPrice: 4250 });
    const plan = planImport(
      [
        { ...row(2, { name: 'Simit', sellPrice: 1500 }), blankVat: true },
        { ...row(3, { barcode: '8690000000017', sellPrice: 4500 }), blankVat: true },
      ],
      [milk],
      [],
      new Map(),
    );
    expect(plan.rows.map((planned) => [planned.action, planned.warnings])).toEqual([
      ['create', ['KDV boş: %1 sayıldı.']],
      ['update', []],
    ]);
  });

  it('matches a list without barcodes to products that have them', () => {
    const milk = product('milk', { barcode: '8690000000017', name: 'Süt', sellPrice: 4250 });
    const plan = planImport([row(2, { name: 'SÜT', sellPrice: 4500 })], [milk], [], new Map());
    expect(plan.rows[0]).toMatchObject({ action: 'update', productId: 'milk' });
  });

  it('plans five thousand rows', () => {
    const products = Array.from({ length: 2000 }, (_, i) =>
      product(`p${i}`, { barcode: `86900${String(i).padStart(8, '0')}` }),
    );
    const rows = Array.from({ length: 5000 }, (_, i) =>
      row(i + 2, {
        barcode: `86900${String(i).padStart(8, '0')}`,
        name: `Ürün ${i}`,
        sellPrice: 100,
      }),
    );
    const plan = planImport(rows, products, [], new Map());
    expect(plan.counts).toEqual({ create: 3000, update: 2000, unchanged: 0, error: 0 });
  });
});

describe('applyImport', () => {
  it('assigns a new category to a product without one', async () => {
    const simit = await createProduct(db, { name: 'Simit', sellPrice: 1500, vatRate: 1 }, at);
    const rows = [row(2, { name: 'Simit', category: 'Fırın' })];
    const plan = planImport(rows, await db.products.toArray(), [], new Map());
    expect(plan.rows[0]).toMatchObject({ action: 'update', changes: ['Kategori: yok → Fırın'] });
    await applyImport(db, plan, rows, at);
    const [bakery] = await listCategories(db);
    expect((await db.products.get(simit.id))?.categoryId).toBe(bakery?.id);
  });

  it('gives a barcodeless product the barcode the file names', async () => {
    const simit = await createProduct(db, { name: 'Simit', sellPrice: 1500, vatRate: 1 }, at);
    const rows = [row(2, { barcode: '2000000000015', name: 'Simit', sellPrice: 1500 })];
    const plan = planImport(rows, await db.products.toArray(), [], new Map());
    expect(plan.rows[0]).toMatchObject({
      action: 'update',
      changes: ['Barkod: yok → 2000000000015'],
    });
    await applyImport(db, plan, rows, at);
    expect(await db.products.count()).toBe(1);
    expect((await db.products.get(simit.id))?.barcode).toBe('2000000000015');
  });

  it('matches barcodes in any letter case', async () => {
    const pen = await createProduct(
      db,
      { barcode: 'BRK-0042', name: 'Kalem', sellPrice: 1500, vatRate: 20 },
      at,
    );
    const table = [
      ['Barkod', 'Fiyat'],
      ['brk-0042', '17,50'],
    ];
    const rows = readImportRows(table, guessMapping(['Barkod', 'Fiyat']), true);
    await applyImport(db, planImport(rows, await db.products.toArray(), [], new Map()), rows, at);
    expect(await db.products.count()).toBe(1);
    expect((await db.products.get(pen.id))?.sellPrice).toBe(1750);
  });

  it('restores a deleted product and applies its changes', async () => {
    const old = await createProduct(
      db,
      { barcode: '8690000000031', name: 'Gazoz', sellPrice: 1000, vatRate: 1 },
      at,
    );
    await deleteProduct(db, old.id, at);
    const rows = [row(2, { barcode: '8690000000031', sellPrice: 1250 })];
    await applyImport(db, planImport(rows, await db.products.toArray(), [], new Map()), rows, at);
    expect(await db.products.get(old.id)).toMatchObject({ sellPrice: 1250 });
    expect((await db.products.get(old.id))?.deletedAt).toBeUndefined();
  });

  it('applies five thousand rows', async () => {
    const rows = Array.from({ length: 5000 }, (_, i) =>
      row(i + 2, {
        barcode: `86900${String(i).padStart(8, '0')}`,
        name: `Ürün ${i}`,
        sellPrice: 100,
      }),
    );
    const plan = planImport(rows, [], [], new Map());
    expect(await applyImport(db, plan, rows, at)).toEqual({ created: 5000, updated: 0 });
    expect(await db.products.count()).toBe(5000);
  });

  it('restores a deleted product that the file names', async () => {
    const old = await createProduct(
      db,
      { barcode: '8690000000031', name: 'Gazoz', sellPrice: 1000, vatRate: 1 },
      at,
    );
    await deleteProduct(db, old.id, at);
    const rows = [row(2, { barcode: '8690000000031', name: 'Gazoz', sellPrice: 1000 })];
    const plan = planImport(rows, await db.products.toArray(), [], new Map());
    expect(plan.rows[0]).toMatchObject({ action: 'update', restore: true, changes: [] });
    expect(await applyImport(db, plan, rows, at)).toEqual({ created: 0, updated: 1 });
    expect((await db.products.get(old.id))?.deletedAt).toBeUndefined();
  });

  it('creates each new category once', async () => {
    await createCategory(db, 'Süt', at);
    const rows = [
      row(2, { name: 'Fındık', sellPrice: 9000, category: 'Kuruyemiş' }),
      row(3, { name: 'Ceviz', sellPrice: 12000, category: 'KURUYEMİŞ' }),
      row(4, { name: 'Ayran', sellPrice: 2000, category: 'süt' }),
    ];
    const plan = planImport(rows, [], await listCategories(db), new Map());
    expect(plan.newCategories).toEqual(['Kuruyemiş']);
    await applyImport(db, plan, rows, at);
    const categories = await listCategories(db);
    expect(categories.map((category) => category.name)).toEqual(['Süt', 'Kuruyemiş']);
    const byName = new Map((await db.products.toArray()).map((p) => [p.name, p.categoryId]));
    expect(byName.get('Fındık')).toBe(categories[1]?.id);
    expect(byName.get('Ceviz')).toBe(categories[1]?.id);
    expect(byName.get('Ayran')).toBe(categories[0]?.id);
  });

  it('never changes the stock of an existing product', async () => {
    const milk = await createProduct(
      db,
      { barcode: '8690000000017', name: 'Süt', sellPrice: 4250, vatRate: 1 },
      at,
      { openingStockMilli: 5000 },
    );
    const rows = [
      row(2, { barcode: '8690000000017', sellPrice: 4500, stockMilli: 12000 }),
      row(3, { name: 'Kaşar', sellPrice: 12000, unit: 'kg', stockMilli: 2500 }),
    ];
    const plan = planImport(rows, await db.products.toArray(), [], new Map());
    expect(plan.rows[0]?.action).toBe('update');
    await applyImport(db, plan, rows, at);
    expect(await stockOf(db, milk.id)).toBe(5000);
    const cheese = (await db.products.toArray()).find((p) => p.name === 'Kaşar');
    expect(await stockOf(db, cheese?.id ?? '')).toBe(2500);
  });

  it('applies all or nothing', async () => {
    const rows = [
      row(2, { barcode: '8690000000040', name: 'Lokum', sellPrice: 5000 }),
      row(3, { barcode: '8690000000057', name: 'Helva', sellPrice: 7000, category: 'Tatlı' }),
    ];
    const plan = planImport(rows, [], [], new Map());
    // Another register takes the second barcode after the plan was made.
    await createProduct(
      db,
      { barcode: '8690000000057', name: 'Tahin', sellPrice: 9000, vatRate: 1 },
      at,
    );
    const before = (await pendingOps(db)).length;
    await expect(applyImport(db, plan, rows, at)).rejects.toBeInstanceOf(DuplicateBarcodeError);
    expect((await db.products.toArray()).map((p) => p.name)).toEqual(['Tahin']);
    expect(await listCategories(db)).toEqual([]);
    expect(await pendingOps(db)).toHaveLength(before);
  });
});
