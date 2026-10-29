import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createCategory, listCategories } from '@/data/categories';
import type { MarketDb } from '@/data/db';
import { createProduct, deleteProduct } from '@/data/products';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { CategoriesDialog } from './CategoriesDialog';

const at = new Date('2026-10-29T09:00:00Z');

async function names(db: MarketDb): Promise<string[]> {
  return (await listCategories(db)).map((category) => category.name);
}

describe('CategoriesDialog', () => {
  it('adds, renames and deletes a category', async () => {
    const { data } = await renderWithData(<CategoriesDialog open onClose={vi.fn()} />);
    expect(await screen.findByText('Henüz kategori yok.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Yeni kategori'), 'Ekmek{Enter}');
    const list = await screen.findByRole('list', { name: 'Kategoriler' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1));
    expect(screen.getByLabelText('Yeni kategori')).toHaveValue('');

    await userEvent.click(screen.getByRole('button', { name: 'Yeniden adlandır: Ekmek' }));
    const field = screen.getByLabelText('Yeni ad');
    await userEvent.clear(field);
    await userEvent.type(field, 'Fırın');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(async () => expect(await names(data.db)).toEqual(['Fırın']));

    await userEvent.click(await screen.findByRole('button', { name: 'Sil: Fırın' }));
    expect(screen.getByText('Fırın silinsin mi?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sil' }));
    await waitFor(async () => expect(await names(data.db)).toEqual([]));
  });

  it('moves a category up', async () => {
    const data = createTestData();
    await createCategory(data.db, 'Ekmek', at);
    await createCategory(data.db, 'Süt', at);
    await renderWithData(<CategoriesDialog open onClose={vi.fn()} />, data);
    await userEvent.click(await screen.findByRole('button', { name: 'Yukarı taşı: Süt' }));
    await waitFor(async () => expect(await names(data.db)).toEqual(['Süt', 'Ekmek']));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Yukarı taşı: Süt' })).toBeDisabled(),
    );
    expect(screen.getByRole('button', { name: 'Aşağı taşı: Ekmek' })).toBeDisabled();
  });

  it('refuses a duplicate or empty name', async () => {
    const data = createTestData();
    await createCategory(data.db, 'Çay', at);
    await renderWithData(<CategoriesDialog open onClose={vi.fn()} />, data);
    const field = await screen.findByLabelText('Yeni kategori');
    await userEvent.type(field, 'ÇAY{Enter}');
    expect(await screen.findByText('Bu adda bir kategori var.')).toBeInTheDocument();
    await userEvent.clear(field);
    await userEvent.click(screen.getByRole('button', { name: 'Ekle' }));
    expect(await screen.findByText('Kategori adı gerekli.')).toBeInTheDocument();
    expect(await names(data.db)).toEqual(['Çay']);
  });

  it('says how many products lose the category', async () => {
    const data = createTestData();
    const bread = await createCategory(data.db, 'Ekmek', at);
    const inBread = { sellPrice: 1500, vatRate: 1, categoryId: bread.id } as const;
    await createProduct(data.db, { ...inBread, name: 'Simit' }, at);
    await createProduct(data.db, { ...inBread, name: 'Poğaça' }, at);
    const old = await createProduct(data.db, { ...inBread, name: 'Eski' }, at);
    await deleteProduct(data.db, old.id, at);
    await renderWithData(<CategoriesDialog open onClose={vi.fn()} />, data);
    await userEvent.click(await screen.findByRole('button', { name: 'Sil: Ekmek' }));
    expect(
      await screen.findByText('Ekmek silinsin mi? Bu kategorideki 2 ürün kategorisiz kalır.'),
    ).toBeInTheDocument();
  });
});
