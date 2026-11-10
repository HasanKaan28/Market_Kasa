import type { MarketDb } from './db';
import { DuplicateCategoryError, RecordNotFoundError } from './errors';
import { newId } from './ids';
import { appendOutbox } from './outbox';
import { normalizeForSearch } from './text';
import type { CategoryRecord } from './types';

export const MAX_CATEGORY_NAME_LENGTH = 40;

/** Adds a category after the existing ones. Names are unique among live categories. */
export async function createCategory(
  db: MarketDb,
  name: string,
  at: Date,
): Promise<CategoryRecord> {
  const stamp = at.toISOString();
  const cleanName = validName(name);
  return db.transaction('rw', db.categories, db.outbox, async () => {
    const live = await liveCategories(db);
    assertNameFree(live, cleanName);
    const record: CategoryRecord = {
      id: newId(at.getTime()),
      name: cleanName,
      sort: live.reduce((next, category) => Math.max(next, category.sort + 1), 0),
      createdAt: stamp,
      updatedAt: stamp,
    };
    await db.categories.add(record);
    await appendOutbox(
      db,
      { kind: 'insert', table: 'categories', recordId: record.id, record },
      at,
    );
    return record;
  });
}

export async function renameCategory(
  db: MarketDb,
  id: string,
  name: string,
  at: Date,
): Promise<CategoryRecord> {
  const cleanName = validName(name);
  return db.transaction('rw', db.categories, db.outbox, async () => {
    const current = await getCategory(db, id);
    if (current.name === cleanName) {
      return current;
    }
    const others = (await liveCategories(db)).filter((category) => category.id !== id);
    assertNameFree(others, cleanName);
    return patchCategory(db, current, { name: cleanName }, at);
  });
}

/** Marks a category deleted. Its products keep the id and are shown as having no category. */
export async function deleteCategory(db: MarketDb, id: string, at: Date): Promise<void> {
  await db.transaction('rw', db.categories, db.outbox, async () => {
    const current = await getCategory(db, id);
    if (!current.deletedAt) {
      await patchCategory(db, current, { deletedAt: at.toISOString() }, at);
    }
  });
}

/** Gives each category its place in `orderedIds`; only the moved ones are written. */
export async function reorderCategories(
  db: MarketDb,
  orderedIds: readonly string[],
  at: Date,
): Promise<void> {
  await db.transaction('rw', db.categories, db.outbox, async () => {
    for (const [sort, id] of orderedIds.entries()) {
      const current = await getCategory(db, id);
      if (current.sort !== sort) {
        await patchCategory(db, current, { sort }, at);
      }
    }
  });
}

/** Live categories in their order, then by name. */
export async function listCategories(db: MarketDb): Promise<CategoryRecord[]> {
  const live = await liveCategories(db);
  return live.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'tr'));
}

function liveCategories(db: MarketDb): Promise<CategoryRecord[]> {
  return db.categories.filter((category) => !category.deletedAt).toArray();
}

async function getCategory(db: MarketDb, id: string): Promise<CategoryRecord> {
  const category = await db.categories.get(id);
  if (!category) {
    throw new RecordNotFoundError('Category', id);
  }
  return category;
}

async function patchCategory(
  db: MarketDb,
  current: CategoryRecord,
  changes: Partial<Pick<CategoryRecord, 'name' | 'sort' | 'deletedAt'>>,
  at: Date,
): Promise<CategoryRecord> {
  const patch = { ...changes, updatedAt: at.toISOString() };
  const updated = { ...current, ...patch };
  await db.categories.put(updated);
  await appendOutbox(db, { kind: 'patch', table: 'categories', recordId: current.id, patch }, at);
  return updated;
}

function validName(name: string): string {
  const clean = name.trim();
  if (clean === '') {
    throw new RangeError('A category needs a name');
  }
  if (Array.from(clean).length > MAX_CATEGORY_NAME_LENGTH) {
    throw new RangeError(`A category name has at most ${MAX_CATEGORY_NAME_LENGTH} characters`);
  }
  return clean;
}

/** Names count as the same when they match the way search does: "Çay", "ÇAY" and "cay". */
function assertNameFree(categories: readonly CategoryRecord[], name: string): void {
  const key = normalizeForSearch(name);
  if (categories.some((category) => normalizeForSearch(category.name) === key)) {
    throw new DuplicateCategoryError(name);
  }
}
