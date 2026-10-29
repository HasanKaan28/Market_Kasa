import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createCategory } from '@/data/categories';
import { createProduct, deleteProduct } from '@/data/products';
import { recordStockMovement } from '@/data/stock';
import type { ProductRecord } from '@/data/types';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { scan } from '@/test/scan';
import { ProductsScreen } from './ProductsScreen';

const at = new Date('2026-10-29T09:00:00Z');

function shownNames(): (string | null)[] {
  const table = screen.getByRole('table', { name: 'Ürün listesi' });
  return within(table)
    .queryAllByRole('button')
    .map((button) => button.textContent);
}

describe('ProductsScreen', () => {
  it('lists products with their stock, unit and category', async () => {
    const data = createTestData();
    const dairy = await createCategory(data.db, 'Süt ürünleri', at);
    await createProduct(
      data.db,
      {
        name: 'Beyaz Peynir',
        barcode: '8690000000024',
        unit: 'kg',
        sellPrice: 32000,
        vatRate: 1,
        categoryId: dairy.id,
      },
      at,
      { openingStockMilli: 1250 },
    );
    await createProduct(data.db, { name: 'Simit', sellPrice: 1500, vatRate: 1 }, at);
    await renderWithData(<ProductsScreen />, data);

    const cheese = await screen.findByRole('row', { name: /Beyaz Peynir/ });
    expect(cheese).toHaveTextContent('8690000000024');
    expect(cheese).toHaveTextContent('Süt ürünleri');
    expect(cheese).toHaveTextContent('₺320,00');
    expect(cheese).toHaveTextContent('1,25 kg');
    expect(screen.getByRole('row', { name: /Simit/ })).toHaveTextContent('0 adet');
    expect(screen.getByText('2 ürün')).toBeInTheDocument();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('finds products by name and filters by category and critical stock', async () => {
    const data = createTestData();
    const bread = await createCategory(data.db, 'Ekmek', at);
    const simit = await createProduct(
      data.db,
      {
        name: 'Simit',
        sellPrice: 1500,
        vatRate: 1,
        categoryId: bread.id,
        criticalLevelMilli: 10000,
      },
      at,
    );
    await recordStockMovement(data.db, { productId: simit.id, delta: 5000, kind: 'count', at });
    await createProduct(
      data.db,
      { name: 'Poğaça', sellPrice: 2000, vatRate: 1, categoryId: bread.id },
      at,
    );
    await createProduct(
      data.db,
      { name: 'Süt', sellPrice: 4250, vatRate: 1, criticalLevelMilli: 2000 },
      at,
      { openingStockMilli: 10000 },
    );
    await renderWithData(<ProductsScreen />, data);
    await screen.findByRole('button', { name: 'Simit' });

    await userEvent.type(screen.getByLabelText('Ürün ara'), 'poğ');
    expect(shownNames()).toEqual(['Poğaça']);
    await userEvent.clear(screen.getByLabelText('Ürün ara'));

    await userEvent.selectOptions(screen.getByLabelText('Kategori'), 'Ekmek');
    expect(shownNames()).toEqual(['Poğaça', 'Simit']);
    await userEvent.selectOptions(screen.getByLabelText('Kategori'), 'Kategorisiz');
    expect(shownNames()).toEqual(['Süt']);
    await userEvent.selectOptions(screen.getByLabelText('Kategori'), 'Tüm kategoriler');

    await userEvent.click(screen.getByRole('radio', { name: 'Kritik stok (1)' }));
    expect(shownNames()).toEqual(['Simit']);
    expect(screen.getByRole('row', { name: /Simit/ })).toHaveTextContent('Kritik');
  });

  it('opens a product when its barcode is scanned', async () => {
    const data = createTestData();
    await createProduct(
      data.db,
      { name: 'Kalem', barcode: 'BRK-0042', sellPrice: 1500, vatRate: 20 },
      at,
    );
    await renderWithData(<ProductsScreen />, data);
    await screen.findByRole('button', { name: 'Kalem' });

    await scan('BRK-0042');
    expect(await screen.findByRole('dialog', { name: 'Ürünü düzenle' })).toBeInTheDocument();
    expect(screen.getByLabelText('Ürün adı')).toHaveValue('Kalem');
    // While the form is open a scan fills its barcode and opens nothing else.
    await scan('8690000000017');
    expect(screen.getByLabelText('Barkod')).toHaveValue('8690000000017');
    expect(screen.getByLabelText('Ürün adı')).toHaveValue('Kalem');

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await scan('brk-0042');
    expect(await screen.findByRole('dialog', { name: 'Ürünü düzenle' })).toBeInTheDocument();
    expect(screen.getByLabelText('Ürün adı')).toHaveValue('Kalem');
  });

  it('gives focus back to the product after its form closes', async () => {
    const data = createTestData();
    await createProduct(data.db, { name: 'Simit', sellPrice: 1500, vatRate: 1 }, at);
    await renderWithData(<ProductsScreen />, data);
    const simit = await screen.findByRole('button', { name: 'Simit' });
    await userEvent.click(simit);
    await screen.findByRole('dialog', { name: 'Ürünü düzenle' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Simit' })).toHaveFocus());
  });

  it('starts a new product with an unknown scanned barcode', async () => {
    await renderWithData(<ProductsScreen />);
    expect(await screen.findByText('Henüz ürün yok.')).toBeInTheDocument();
    await scan('8690000000099');
    expect(await screen.findByRole('dialog', { name: 'Yeni ürün' })).toBeInTheDocument();
    expect(screen.getByLabelText('Barkod')).toHaveValue('8690000000099');
    await userEvent.type(screen.getByLabelText('Ürün adı'), 'Kaşar');
    await userEvent.type(screen.getByLabelText('Satış fiyatı'), '120');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(await screen.findByRole('button', { name: 'Kaşar' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Bildirim' })).toHaveTextContent('Ürün eklendi.');
  });

  it('shows 100 products at a time', async () => {
    const data = createTestData();
    const stamp = at.toISOString();
    const products: ProductRecord[] = Array.from({ length: 120 }, (_, index) => ({
      id: `p-${index}`,
      name: `Ürün ${String(index).padStart(3, '0')}`,
      unit: 'piece',
      sellPrice: 100,
      buyPrice: 0,
      vatRate: 1,
      isQuick: false,
      criticalLevelMilli: 0,
      createdAt: stamp,
      updatedAt: stamp,
    }));
    await data.db.products.bulkAdd(products);
    await renderWithData(<ProductsScreen />, data);

    await waitFor(() => expect(shownNames()).toHaveLength(100));
    expect(screen.getByText('100 / 120 ürün')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Daha fazla göster' }));
    expect(shownNames()).toHaveLength(120);
    expect(screen.queryByRole('button', { name: 'Daha fazla göster' })).not.toBeInTheDocument();
  });

  it('shows deleted products under Silinenler and restores one', async () => {
    const data = createTestData();
    const old = await createProduct(
      data.db,
      { name: 'Eski Gazoz', barcode: '8690000000031', sellPrice: 1000, vatRate: 1 },
      at,
    );
    await deleteProduct(data.db, old.id, at);
    await createProduct(data.db, { name: 'Ayran', sellPrice: 2250, vatRate: 1 }, at);
    await renderWithData(<ProductsScreen />, data);
    await screen.findByRole('button', { name: 'Ayran' });
    expect(shownNames()).toEqual(['Ayran']);

    await userEvent.click(screen.getByRole('radio', { name: 'Silinenler' }));
    expect(shownNames()).toEqual(['Eski Gazoz']);

    await scan('8690000000031');
    expect(await screen.findByText('Bu ürün silinmiş.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Geri getir' }));
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Bildirim' })).toHaveTextContent(
        'Ürün geri getirildi.',
      ),
    );
    expect(await screen.findByText('Aramaya uyan ürün yok.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Tümü' }));
    expect(shownNames()).toEqual(['Ayran', 'Eski Gazoz']);
  });
});
