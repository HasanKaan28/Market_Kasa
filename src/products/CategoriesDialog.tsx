import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react';
import { useState, type FormEvent, type JSX } from 'react';
import { useData } from '@/app/appData';
import {
  createCategory,
  deleteCategory,
  listCategories,
  MAX_CATEGORY_NAME_LENGTH,
  renameCategory,
  reorderCategories,
} from '@/data/categories';
import { DuplicateCategoryError } from '@/data/errors';
import type { CategoryRecord } from '@/data/types';
import { Button, Dialog, TextField } from '@/design';

export type CategoriesDialogProps = { open: boolean; onClose(): void };

type Editing = { kind: 'rename'; id: string; name: string } | { kind: 'delete'; id: string } | null;

/** Adds, renames, orders and deletes the categories; their order is the register's. */
export function CategoriesDialog({ open, onClose }: CategoriesDialogProps): JSX.Element {
  const { db } = useData();
  const categories = useLiveQuery(() => listCategories(db), [db]);
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState<string>();
  const [editing, setEditing] = useState<Editing>(null);
  const [renameError, setRenameError] = useState<string>();
  const deletingId = editing?.kind === 'delete' ? editing.id : undefined;
  // The count carries the category it was read for: the confirmation waits for its own count
  // instead of showing the previous one.
  const counted = useLiveQuery(async () => {
    if (deletingId === undefined) {
      return undefined;
    }
    const products = await db.products
      .filter((product) => !product.deletedAt && product.categoryId === deletingId)
      .count();
    return { categoryId: deletingId, products };
  }, [db, deletingId]);
  const affected =
    counted !== undefined && counted.categoryId === deletingId ? counted.products : undefined;

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = await saveName(() => createCategory(db, newName, new Date()), newName);
    setAddError(error);
    if (error === undefined) {
      setNewName('');
    }
  }

  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editing?.kind !== 'rename') {
      return;
    }
    const { id, name } = editing;
    const error = await saveName(() => renameCategory(db, id, name, new Date()), name);
    setRenameError(error);
    if (error === undefined) {
      setEditing(null);
    }
  }

  async function move(list: readonly CategoryRecord[], from: number, to: number) {
    const ids = list.map((category) => category.id);
    const [moved] = ids.splice(from, 1);
    if (moved !== undefined) {
      ids.splice(to, 0, moved);
      await reorderCategories(db, ids, new Date());
    }
  }

  async function remove(id: string) {
    await deleteCategory(db, id, new Date());
    setEditing(null);
  }

  function edit(next: Editing) {
    setRenameError(undefined);
    setEditing(next);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Kategoriler"
      description="Sıra, kasadaki düğmelerin sırasıdır."
    >
      {categories?.length === 0 ? <p className="text-text-2">Henüz kategori yok.</p> : null}
      {categories && categories.length > 0 ? (
        <ul
          aria-label="Kategoriler"
          className="flex flex-col divide-y divide-line rounded-control border border-line"
        >
          {categories.map((category, index) => (
            <li key={category.id} className="flex flex-col gap-2 p-2">
              {editing?.kind === 'rename' && editing.id === category.id ? (
                <form className="flex flex-col gap-2" onSubmit={(event) => void rename(event)}>
                  <TextField
                    label="Yeni ad"
                    autoFocus
                    autoComplete="off"
                    maxLength={MAX_CATEGORY_NAME_LENGTH}
                    value={editing.name}
                    error={renameError}
                    onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" variant="primary">
                      Kaydet
                    </Button>
                    <Button onClick={() => edit(null)}>Vazgeç</Button>
                  </div>
                </form>
              ) : (
                <div className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate px-1 font-medium">{category.name}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Yukarı taşı: ${category.name}`}
                    disabled={index === 0}
                    icon={<ArrowUp aria-hidden="true" size={18} />}
                    onClick={() => void move(categories, index, index - 1)}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Aşağı taşı: ${category.name}`}
                    disabled={index === categories.length - 1}
                    icon={<ArrowDown aria-hidden="true" size={18} />}
                    onClick={() => void move(categories, index, index + 1)}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Yeniden adlandır: ${category.name}`}
                    icon={<Pencil aria-hidden="true" size={18} />}
                    onClick={() => edit({ kind: 'rename', id: category.id, name: category.name })}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Sil: ${category.name}`}
                    icon={<Trash2 aria-hidden="true" size={18} />}
                    onClick={() => edit({ kind: 'delete', id: category.id })}
                  />
                </div>
              )}
              {deletingId === category.id && affected !== undefined ? (
                <div className="flex flex-col gap-2 rounded-control bg-bg p-2">
                  <p>{deleteQuestion(category.name, affected)}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="danger" onClick={() => void remove(category.id)}>
                      Sil
                    </Button>
                    <Button onClick={() => edit(null)}>Vazgeç</Button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <form className="flex flex-col gap-2" onSubmit={(event) => void add(event)}>
        <TextField
          label="Yeni kategori"
          autoComplete="off"
          maxLength={MAX_CATEGORY_NAME_LENGTH}
          value={newName}
          error={addError}
          onChange={(event) => setNewName(event.target.value)}
        />
        <Button type="submit">Ekle</Button>
      </form>
    </Dialog>
  );
}

/** Saves a name and returns the message for the field, or nothing when it was saved. */
async function saveName(save: () => Promise<unknown>, name: string): Promise<string | undefined> {
  if (name.trim() === '') {
    return 'Kategori adı gerekli.';
  }
  try {
    await save();
    return undefined;
  } catch (error) {
    return error instanceof DuplicateCategoryError
      ? 'Bu adda bir kategori var.'
      : 'Kategori kaydedilemedi.';
  }
}

function deleteQuestion(name: string, products: number): string {
  const question = `${name} silinsin mi?`;
  return products > 0
    ? `${question} Bu kategorideki ${products} ürün kategorisiz kalır.`
    : question;
}
