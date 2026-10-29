import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createProduct } from '@/data/products';
import { renderWithData } from '@/test/renderWithData';
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
});
