import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import {
  createCategory,
  deleteCategory,
  listCategories,
  renameCategory,
  reorderCategories,
} from './categories';
import type { MarketDb } from './db';
import { DuplicateCategoryError } from './errors';
import { pendingOps } from './outbox';
import { createProduct } from './products';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const at = new Date('2026-10-29T09:00:00Z');
const later = new Date('2026-10-29T10:00:00Z');

describe('categories', () => {
  it('creates categories in order and queues every change for sync', async () => {
    const drinks = await createCategory(db, ' İçecek ', at);
    const bread = await createCategory(db, 'Ekmek', at);
    expect(drinks).toMatchObject({
      name: 'İçecek',
      sort: 0,
      createdAt: at.toISOString(),
      updatedAt: at.toISOString(),
    });
    expect(bread.sort).toBe(1);

    await renameCategory(db, bread.id, 'Fırın', later);
    await reorderCategories(db, [bread.id, drinks.id], later);
    await deleteCategory(db, drinks.id, later);

    expect((await pendingOps(db)).map((op) => [op.kind, op.table, op.recordId])).toEqual([
      ['insert', 'categories', drinks.id],
      ['insert', 'categories', bread.id],
      ['patch', 'categories', bread.id],
      ['patch', 'categories', bread.id],
      ['patch', 'categories', drinks.id],
      ['patch', 'categories', drinks.id],
    ]);
    expect(await listCategories(db)).toMatchObject([{ id: bread.id, name: 'Fırın', sort: 0 }]);
  });

  it('refuses an empty, overlong or duplicate name, the Turkish way', async () => {
    const tea = await createCategory(db, 'Çay', at);
    await expect(createCategory(db, '   ', at)).rejects.toBeInstanceOf(RangeError);
    await expect(createCategory(db, 'x'.repeat(41), at)).rejects.toBeInstanceOf(RangeError);
    await expect(createCategory(db, 'ÇAY', at)).rejects.toBeInstanceOf(DuplicateCategoryError);
    await expect(createCategory(db, ' çay ', at)).rejects.toBeInstanceOf(DuplicateCategoryError);
    const coffee = await createCategory(db, 'Kahve', at);
    await expect(renameCategory(db, coffee.id, 'çay', later)).rejects.toBeInstanceOf(
      DuplicateCategoryError,
    );
    await deleteCategory(db, tea.id, later);
    expect((await createCategory(db, 'Çay', later)).name).toBe('Çay');
  });

  it('renames and reorders with patches of the changed fields only', async () => {
    const snacks = await createCategory(db, 'Cips', at);
    const bread = await createCategory(db, 'Ekmek', at);
    const milk = await createCategory(db, 'Süt', at);
    const before = (await pendingOps(db)).length;

    await renameCategory(db, snacks.id, 'Cips', later);
    expect(await pendingOps(db)).toHaveLength(before);

    const renamed = await renameCategory(db, snacks.id, 'Atıştırmalık', later);
    expect(renamed).toMatchObject({ name: 'Atıştırmalık', updatedAt: later.toISOString() });
    await reorderCategories(db, [snacks.id, milk.id, bread.id], later);

    const stamp = later.toISOString();
    expect(
      (await pendingOps(db))
        .slice(before)
        .map((op) => op.kind === 'patch' && [op.recordId, op.patch]),
    ).toEqual([
      [snacks.id, { name: 'Atıştırmalık', updatedAt: stamp }],
      [milk.id, { sort: 1, updatedAt: stamp }],
      [bread.id, { sort: 2, updatedAt: stamp }],
    ]);
    expect((await listCategories(db)).map((category) => category.name)).toEqual([
      'Atıştırmalık',
      'Süt',
      'Ekmek',
    ]);
  });

  it('deletes softly and leaves products as they are', async () => {
    const bread = await createCategory(db, 'Ekmek', at);
    const simit = await createProduct(
      db,
      { name: 'Simit', sellPrice: 1500, vatRate: 1, categoryId: bread.id },
      at,
    );
    await deleteCategory(db, bread.id, later);
    expect((await db.categories.get(bread.id))?.deletedAt).toBe(later.toISOString());
    expect(await listCategories(db)).toEqual([]);
    expect((await db.products.get(simit.id))?.categoryId).toBe(bread.id);

    const count = (await pendingOps(db)).length;
    await deleteCategory(db, bread.id, later);
    expect(await pendingOps(db)).toHaveLength(count);
  });
});
