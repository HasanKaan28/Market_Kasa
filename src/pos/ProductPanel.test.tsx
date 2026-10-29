import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createCategory, deleteCategory } from '@/data/categories';
import { createProduct } from '@/data/products';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { ProductPanel } from './ProductPanel';

const at = new Date('2026-10-29T09:00:00Z');
const milk = { barcode: '8690000000017', name: 'Süt', sellPrice: 4250, vatRate: 1 } as const;

describe('ProductPanel', () => {
  it('finds a product by name and adds it on click', async () => {
    const onAdd = vi.fn();
    const { data } = await renderWithData(<ProductPanel onAdd={onAdd} onNewProduct={vi.fn()} />);
    const created = await createProduct(data.db, milk, at);
    await userEvent.type(screen.getByLabelText('Barkod veya ürün adı'), 'sut');
    await userEvent.click(await screen.findByRole('button', { name: /Süt.*₺42,50/ }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: created.id }));
  });

  it('shows quick products while the search is empty', async () => {
    const { data } = await renderWithData(<ProductPanel onAdd={vi.fn()} onNewProduct={vi.fn()} />);
    await createProduct(data.db, { name: 'Ekmek', sellPrice: 1500, vatRate: 1, isQuick: true }, at);
    await createProduct(data.db, milk, at);
    expect(await screen.findByRole('button', { name: /Ekmek/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Süt/ })).not.toBeInTheDocument();
  });

  it('adds an exact barcode on Enter and clears the field', async () => {
    const onAdd = vi.fn();
    const { data } = await renderWithData(<ProductPanel onAdd={onAdd} onNewProduct={vi.fn()} />);
    await createProduct(data.db, milk, at);
    const field = screen.getByLabelText('Barkod veya ürün adı');
    await userEvent.type(field, '8690000000017{Enter}');
    await vi.waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(field).toHaveValue('');
  });

  it('offers a new product for an unknown barcode or from its button', async () => {
    const onNewProduct = vi.fn();
    await renderWithData(<ProductPanel onAdd={vi.fn()} onNewProduct={onNewProduct} />);
    await userEvent.type(screen.getByLabelText('Barkod veya ürün adı'), '8690000000099{Enter}');
    await vi.waitFor(() => expect(onNewProduct).toHaveBeenCalledWith('8690000000099'));
    await userEvent.click(screen.getByRole('button', { name: 'Yeni ürün' }));
    expect(onNewProduct).toHaveBeenLastCalledWith();
  });

  it("shows a category's products in the grid", async () => {
    const data = createTestData();
    const bread = await createCategory(data.db, 'Ekmek', at);
    await createCategory(data.db, 'Kahvaltılık', at);
    await createProduct(
      data.db,
      { name: 'Simit', sellPrice: 1500, vatRate: 1, categoryId: bread.id },
      at,
    );
    await createProduct(data.db, { ...milk, isQuick: true }, at);
    const onAdd = vi.fn();
    await renderWithData(<ProductPanel onAdd={onAdd} onNewProduct={vi.fn()} />, data);
    expect(await screen.findByRole('button', { name: /Süt/ })).toBeInTheDocument();
    const groups = screen.getByRole('group', { name: 'Ürün grubu' });
    expect(within(groups).getByRole('radio', { name: 'Hızlı' })).toBeChecked();
    expect(within(groups).getAllByRole('radio')).toHaveLength(3);

    await userEvent.click(within(groups).getByRole('radio', { name: 'Ekmek' }));
    expect(await screen.findByRole('heading', { name: 'Ekmek' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Süt/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Simit/ }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ name: 'Simit' }));
  });

  it('hides the group choice when there are no categories', async () => {
    await renderWithData(<ProductPanel onAdd={vi.fn()} onNewProduct={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Hızlı ürünler' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Ürün grubu' })).not.toBeInTheDocument();
  });

  it('falls back to quick products when the chosen category is deleted', async () => {
    const data = createTestData();
    const bread = await createCategory(data.db, 'Ekmek', at);
    await createCategory(data.db, 'Kahvaltılık', at);
    await renderWithData(<ProductPanel onAdd={vi.fn()} onNewProduct={vi.fn()} />, data);
    await userEvent.click(await screen.findByRole('radio', { name: 'Ekmek' }));
    expect(await screen.findByText('Bu grupta ürün yok.')).toBeInTheDocument();
    await deleteCategory(data.db, bread.id, at);
    expect(await screen.findByRole('heading', { name: 'Hızlı ürünler' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Hızlı' })).toBeChecked();
  });
});
