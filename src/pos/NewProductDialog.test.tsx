import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createProduct, findProductByBarcode } from '@/data/products';
import { renderWithData } from '@/test/renderWithData';
import { NewProductDialog } from './NewProductDialog';

async function fill(name: string, price: string) {
  if (name) {
    await userEvent.type(screen.getByLabelText('Ürün adı'), name);
  }
  await userEvent.type(screen.getByLabelText('Satış fiyatı'), price);
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet ve sepete ekle' }));
}

describe('NewProductDialog', () => {
  it('saves a product typed the Turkish way and hands it back', async () => {
    const onCreated = vi.fn();
    const { data } = await renderWithData(
      <NewProductDialog open barcode="8690000000099" onClose={vi.fn()} onCreated={onCreated} />,
    );
    await fill('Kaşar Peyniri', '12,50');
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(await findProductByBarcode(data.db, '8690000000099')).toMatchObject({
      name: 'Kaşar Peyniri',
      sellPrice: 1250,
      vatRate: 1,
      isQuick: false,
    });
  });

  it('adds a barcodeless product as a quick product', async () => {
    const onCreated = vi.fn();
    const { data } = await renderWithData(
      <NewProductDialog open onClose={vi.fn()} onCreated={onCreated} />,
    );
    await fill('Ekmek', '15');
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalled());
    const [bread] = await data.db.products.toArray();
    expect(bread).toMatchObject({ name: 'Ekmek', sellPrice: 1500, isQuick: true });
    expect(bread?.barcode).toBeUndefined();
  });

  it('explains what is missing and writes nothing', async () => {
    const { data } = await renderWithData(
      <NewProductDialog open barcode="8690000000099" onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    await fill('', 'abc');
    expect(await screen.findByText('Ürün adı gerekli.')).toBeInTheDocument();
    expect(screen.getByText('Geçerli bir tutar girin.')).toBeInTheDocument();
    expect(await data.db.products.count()).toBe(0);
  });

  it('refuses a barcode that is already in use', async () => {
    const onCreated = vi.fn();
    const { data } = await renderWithData(
      <NewProductDialog open barcode="8690000000017" onClose={vi.fn()} onCreated={onCreated} />,
    );
    await createProduct(
      data.db,
      { barcode: '8690000000017', name: 'Süt', sellPrice: 4250, vatRate: 1 },
      new Date(),
    );
    await fill('Ayran', '20');
    expect(await screen.findByText('Bu barkod başka bir üründe kayıtlı.')).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
