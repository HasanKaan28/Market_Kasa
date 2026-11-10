import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createProduct } from '@/data/products';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { ProductFormDialog } from './ProductFormDialog';

const at = new Date('2026-11-10T09:00:00Z');
const water = { name: 'Su', barcode: '8690000000012', sellPrice: 1000, vatRate: 1 } as const;

describe('ProductFormDialog pack barcodes', () => {
  it('adds a case barcode with how many it holds', async () => {
    const data = createTestData();
    const product = await createProduct(data.db, water, at);
    const onSaved = vi.fn();
    await renderWithData(
      <ProductFormDialog open product={product} onClose={vi.fn()} onSaved={onSaved} />,
      data,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Koli barkodu ekle' }));
    const pack = screen.getByRole('group', { name: 'Koli 1' });
    await userEvent.type(within(pack).getByLabelText('Koli barkodu'), '8690000000029');
    await userEvent.type(within(pack).getByLabelText('İçindeki miktar'), '12');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Ürün kaydedildi.'));
    expect((await data.db.products.get(product.id))?.packs).toEqual([
      { barcode: '8690000000029', qtyMilli: 12000 },
    ]);
  });

  it('shows a product’s cases and removes one', async () => {
    const data = createTestData();
    const product = await createProduct(
      data.db,
      { ...water, packs: [{ barcode: '8690000000029', qtyMilli: 12000 }] },
      at,
    );
    const onSaved = vi.fn();
    await renderWithData(
      <ProductFormDialog open product={product} onClose={vi.fn()} onSaved={onSaved} />,
      data,
    );
    const pack = screen.getByRole('group', { name: 'Koli 1' });
    expect(within(pack).getByLabelText('Koli barkodu')).toHaveValue('8690000000029');
    expect(within(pack).getByLabelText('İçindeki miktar')).toHaveValue('12');
    await userEvent.click(within(pack).getByRole('button', { name: 'Koliyi çıkar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Ürün kaydedildi.'));
    expect((await data.db.products.get(product.id))?.packs).toBeUndefined();
  });

  it('says what is wrong with a case', async () => {
    const data = createTestData();
    const product = await createProduct(data.db, water, at);
    await renderWithData(
      <ProductFormDialog open product={product} onClose={vi.fn()} onSaved={vi.fn()} />,
      data,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Koli barkodu ekle' }));
    const pack = screen.getByRole('group', { name: 'Koli 1' });
    await userEvent.type(within(pack).getByLabelText('Koli barkodu'), '8690000000029');
    await userEvent.type(within(pack).getByLabelText('İçindeki miktar'), '1,5');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(await screen.findByText('Koli 1: adet için tam sayı girin.')).toBeInTheDocument();
  });
});
