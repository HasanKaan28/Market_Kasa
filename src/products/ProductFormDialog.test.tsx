import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createCategory, deleteCategory } from '@/data/categories';
import { pendingOps } from '@/data/outbox';
import { createProduct, updateProduct } from '@/data/products';
import { stockOf } from '@/data/stock';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { scan } from '@/test/scan';
import { ProductFormDialog } from './ProductFormDialog';

const at = new Date('2026-10-29T09:00:00Z');
const milk = { barcode: '8690000000017', name: 'Süt', sellPrice: 4250, vatRate: 1 } as const;

async function fillNew(name: string, price: string) {
  await userEvent.type(screen.getByLabelText('Ürün adı'), name);
  await userEvent.type(screen.getByLabelText('Satış fiyatı'), price);
}

describe('ProductFormDialog', () => {
  it('creates a weighed product with its opening stock', async () => {
    const onSaved = vi.fn();
    const { data } = await renderWithData(
      <ProductFormDialog open onClose={vi.fn()} onSaved={onSaved} />,
    );
    await fillNew('Beyaz Peynir', '320');
    await userEvent.click(screen.getByRole('radio', { name: 'Kilogram' }));
    await userEvent.type(screen.getByLabelText('Başlangıç stoğu'), '1,5');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Ürün eklendi.'));
    const [cheese] = await data.db.products.toArray();
    expect(cheese).toMatchObject({ name: 'Beyaz Peynir', unit: 'kg', sellPrice: 32000 });
    expect(await stockOf(data.db, cheese?.id ?? '')).toBe(1500);
    expect(await data.db.stockMovements.toArray()).toMatchObject([{ kind: 'count', delta: 1500 }]);
  });

  it('edits a product and patches only what changed', async () => {
    const data = createTestData();
    const product = await createProduct(data.db, { ...milk, buyPrice: 3500 }, at);
    const onSaved = vi.fn();
    await renderWithData(
      <ProductFormDialog open product={product} onClose={vi.fn()} onSaved={onSaved} />,
      data,
    );
    expect(screen.getByRole('heading', { name: 'Ürünü düzenle' })).toBeInTheDocument();
    expect(screen.getByLabelText('Barkod')).toHaveValue('8690000000017');
    expect(screen.getByLabelText('Alış fiyatı')).toHaveValue('35,00');
    expect(await screen.findByText('Stok: 0 adet')).toBeInTheDocument();
    const price = screen.getByLabelText('Satış fiyatı');
    expect(price).toHaveValue('42,50');
    await userEvent.clear(price);
    await userEvent.type(price, '45');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Ürün kaydedildi.'));
    const last = (await pendingOps(data.db)).at(-1);
    expect(last).toMatchObject({ kind: 'patch', recordId: product.id });
    expect(last?.kind === 'patch' && last.patch).toEqual({
      sellPrice: 4500,
      updatedAt: expect.any(String),
    });
  });

  it('shows the stock only once it is read', async () => {
    const data = createTestData();
    const cheese = await createProduct(
      data.db,
      { name: 'Peynir', unit: 'kg', sellPrice: 32000, vatRate: 1 },
      at,
      { openingStockMilli: 1500 },
    );
    await renderWithData(
      <ProductFormDialog open product={cheese} onClose={vi.fn()} onSaved={vi.fn()} />,
      data,
    );
    // Before the stock is read nothing is shown, never a made-up "Stok: 0 kg".
    expect(screen.queryByText(/^Stok: /)).not.toBeInTheDocument();
    expect(await screen.findByText('Stok: 1,5 kg')).toBeInTheDocument();
  });

  it('keeps a change made elsewhere to a field the user did not touch', async () => {
    const data = createTestData();
    const product = await createProduct(data.db, milk, at);
    const onSaved = vi.fn();
    await renderWithData(
      <ProductFormDialog open product={product} onClose={vi.fn()} onSaved={onSaved} />,
      data,
    );
    // Another register raises the price while this form is open; the pull lands here.
    await updateProduct(data.db, product.id, { sellPrice: 5000 }, at);
    const name = screen.getByLabelText('Ürün adı');
    await userEvent.clear(name);
    await userEvent.type(name, 'Süt 1 L');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Ürün kaydedildi.'));
    expect(await data.db.products.get(product.id)).toMatchObject({
      name: 'Süt 1 L',
      sellPrice: 5000,
    });
    const last = (await pendingOps(data.db)).at(-1);
    expect(last?.kind === 'patch' && last.patch).toEqual({
      name: 'Süt 1 L',
      updatedAt: expect.any(String),
    });
  });

  it('asks only when told, with the barcode alone', async () => {
    const lookup = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: 1,
        product: { product_name_tr: 'Çikolatalı Gofret', brands: 'Ülker', quantity: '36 g' },
      }),
    }));
    vi.stubGlobal('fetch', lookup);
    try {
      await renderWithData(
        <ProductFormDialog open barcode="8690504000014" onClose={vi.fn()} onSaved={vi.fn()} />,
      );
      expect(lookup).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole('button', { name: 'İnternetten ad öner' }));
      expect(await screen.findByDisplayValue('Ülker Çikolatalı Gofret 36 g')).toBeInTheDocument();
      expect(lookup).toHaveBeenCalledTimes(1);
      expect(lookup.mock.calls[0]?.[0]).toBe(
        'https://world.openfoodfacts.org/api/v2/product/8690504000014.json?fields=product_name_tr,product_name,brands,quantity',
      );
      expect(lookup.mock.calls[0]?.[1]).toEqual({ signal: expect.any(AbortSignal) });

      // With a name already typed, the suggestion waits to be used.
      await userEvent.clear(screen.getByLabelText('Ürün adı'));
      await userEvent.type(screen.getByLabelText('Ürün adı'), 'Gofret');
      await userEvent.click(screen.getByRole('button', { name: 'İnternetten ad öner' }));
      expect(await screen.findByText('Öneri: Ülker Çikolatalı Gofret 36 g')).toBeInTheDocument();
      expect(screen.getByLabelText('Ürün adı')).toHaveValue('Gofret');
      await userEvent.click(screen.getByRole('button', { name: 'Kullan' }));
      expect(screen.getByLabelText('Ürün adı')).toHaveValue('Ülker Çikolatalı Gofret 36 g');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('refuses a barcode another product holds and names it', async () => {
    const data = createTestData();
    await createProduct(data.db, milk, at);
    await renderWithData(<ProductFormDialog open onClose={vi.fn()} onSaved={vi.fn()} />, data);
    await userEvent.type(screen.getByLabelText('Barkod'), '8690000000017');
    await fillNew('Ayran', '22,50');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(await screen.findByText('Bu barkod “Süt” ürününde kayıtlı.')).toBeInTheDocument();
    expect(await data.db.products.count()).toBe(1);
  });

  it('rejects a fractional quantity for a piece product', async () => {
    const { data } = await renderWithData(
      <ProductFormDialog open onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    await fillNew('Kalem', '15');
    await userEvent.type(screen.getByLabelText('Kritik stok'), '1,5');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(await screen.findByText('Adet için tam sayı girin.')).toBeInTheDocument();
    expect(await data.db.products.count()).toBe(0);
  });

  it('rejects a price above the limit', async () => {
    const { data } = await renderWithData(
      <ProductFormDialog open onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    await fillNew('Altın', '1000000,01');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(await screen.findByText('Fiyat en fazla ₺1.000.000,00 olabilir.')).toBeInTheDocument();
    expect(await data.db.products.count()).toBe(0);
  });

  it('deletes after confirming and restores a deleted product', async () => {
    const data = createTestData();
    const product = await createProduct(data.db, milk, at);
    const onSaved = vi.fn();
    const { rerender } = await renderWithData(
      <ProductFormDialog open product={product} onClose={vi.fn()} onSaved={onSaved} />,
      data,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Ürünü sil' }));
    expect(screen.getByText('Bu ürün silinsin mi? Satış geçmişi korunur.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sil' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Ürün silindi.'));
    const deleted = await data.db.products.get(product.id);
    expect(deleted?.deletedAt).toBeDefined();

    rerender(<ProductFormDialog open product={deleted} onClose={vi.fn()} onSaved={onSaved} />);
    expect(screen.getByText('Bu ürün silinmiş.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ürünü sil' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Geri getir' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Ürün geri getirildi.'));
    expect((await data.db.products.get(product.id))?.deletedAt).toBeUndefined();
  });

  it('fills the barcode from a scan', async () => {
    await renderWithData(<ProductFormDialog open onClose={vi.fn()} onSaved={vi.fn()} />);
    const name = screen.getByLabelText('Ürün adı');
    expect(name).toHaveFocus();
    await scan('BRK-0042');
    expect(screen.getByLabelText('Barkod')).toHaveValue('BRK-0042');
    expect(name).toHaveValue('');
  });

  it('shows a missing category as Kategorisiz', async () => {
    const data = createTestData();
    const bread = await createCategory(data.db, 'Ekmek', at);
    await createCategory(data.db, 'İçecek', at);
    const simit = await createProduct(
      data.db,
      { name: 'Simit', sellPrice: 1500, vatRate: 1, categoryId: bread.id },
      at,
    );
    await deleteCategory(data.db, bread.id, at);
    await renderWithData(
      <ProductFormDialog open product={simit} onClose={vi.fn()} onSaved={vi.fn()} />,
      data,
    );
    const select = screen.getByLabelText('Kategori');
    await waitFor(() =>
      expect(
        within(select)
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual(['Kategorisiz', 'İçecek']),
    );
    expect(select).toHaveDisplayValue('Kategorisiz');
  });
});
