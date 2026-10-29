import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProduct, deleteProduct, updateProduct } from '@/data/products';
import { stockOf } from '@/data/stock';
import { archiveSupplier, createSupplier, supplierBalance } from '@/data/suppliers';
import { fakeCamera, removeCamera } from '@/test/camera';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { scan } from '@/test/scan';
import { GoodsReceipt } from './GoodsReceipt';

const at = new Date('2026-10-29T09:00:00Z');
const later = new Date('2026-10-29T10:00:00Z');
const milk = {
  barcode: '8690000000017',
  name: 'Süt',
  sellPrice: 4250,
  buyPrice: 3000,
  vatRate: 1,
} as const;

async function lineOf(name: string) {
  return screen.findByRole('group', { name });
}

async function retype(field: HTMLElement, text: string) {
  await userEvent.clear(field);
  await userEvent.type(field, text);
}

afterEach(removeCamera);

describe('GoodsReceipt', () => {
  it('adds a scanned product and counts it up when scanned again', async () => {
    const data = createTestData();
    await createProduct(data.db, milk, at);
    await renderWithData(<GoodsReceipt onDone={vi.fn()} />, data);
    await scan('8690000000017');
    await lineOf('Süt');
    await scan('8690000000017');
    await waitFor(async () =>
      expect(within(await lineOf('Süt')).getByLabelText('Miktar')).toHaveValue('2'),
    );
  });

  it('starts a new product from an unknown barcode and adds it', async () => {
    await renderWithData(<GoodsReceipt onDone={vi.fn()} />);
    await scan('8690000000099');
    const dialog = await screen.findByRole('dialog', { name: 'Yeni ürün' });
    await userEvent.type(within(dialog).getByLabelText('Ürün adı'), 'Kaşar');
    await userEvent.type(within(dialog).getByLabelText('Satış fiyatı'), '120');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    expect(await lineOf('Kaşar')).toBeInTheDocument();
  });

  it('records the receipt with new prices and clears the draft', async () => {
    const data = createTestData();
    const product = await createProduct(data.db, milk, at);
    const onDone = vi.fn();
    await renderWithData(<GoodsReceipt onDone={onDone} />, data);
    await scan('8690000000017');
    const line = await lineOf('Süt');
    await retype(within(line).getByLabelText('Miktar'), '12');
    await retype(within(line).getByLabelText('Satış fiyatı'), '45');
    expect(screen.getByText('Toplam: ₺360,00')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Not'), 'İrsaliye 1234');
    // Paid in cash, but not from the register's drawer.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Kasadan ödendi' }));
    await userEvent.click(screen.getByRole('button', { name: 'Mal kabulü kaydet' }));
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith('Mal kabul kaydedildi: 1 ürün, ₺360,00.'),
    );
    expect(await data.db.cashMovements.count()).toBe(0);
    expect(await stockOf(data.db, product.id)).toBe(12000);
    expect((await data.db.products.get(product.id))?.sellPrice).toBe(4500);
    expect(await data.db.purchases.toArray()).toMatchObject([
      { note: 'İrsaliye 1234', total: 36000 },
    ]);
    expect(screen.queryByRole('group', { name: 'Süt' })).not.toBeInTheDocument();
  });

  it('keeps the draft across a reload', async () => {
    const data = createTestData();
    await createProduct(data.db, milk, at);
    const first = await renderWithData(<GoodsReceipt onDone={vi.fn()} />, data);
    await scan('8690000000017');
    await retype(within(await lineOf('Süt')).getByLabelText('Miktar'), '5');
    first.unmount();
    await renderWithData(<GoodsReceipt onDone={vi.fn()} />, data);
    expect(within(await lineOf('Süt')).getByLabelText('Miktar')).toHaveValue('5');
  });

  it('shows what a line cannot be saved with', async () => {
    const data = createTestData();
    await createProduct(data.db, milk, at);
    await renderWithData(<GoodsReceipt onDone={vi.fn()} />, data);
    await scan('8690000000017');
    await retype(within(await lineOf('Süt')).getByLabelText('Miktar'), '1,5');
    await userEvent.click(screen.getByRole('button', { name: 'Mal kabulü kaydet' }));
    expect(await screen.findByText('Adet için tam sayı girin.')).toBeInTheDocument();
    expect(await data.db.purchases.count()).toBe(0);
  });

  it('keeps a price changed elsewhere after the line was added', async () => {
    const data = createTestData();
    const product = await createProduct(data.db, milk, at);
    const onDone = vi.fn();
    await renderWithData(<GoodsReceipt onDone={onDone} />, data);
    await scan('8690000000017');
    const line = await lineOf('Süt');
    await updateProduct(data.db, product.id, { sellPrice: 5000, buyPrice: 3500 }, later);
    await waitFor(() => expect(within(line).getByLabelText('Satış fiyatı')).toHaveValue('50,00'));
    await retype(within(line).getByLabelText('Miktar'), '12');
    expect(screen.getByText('Toplam: ₺420,00')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mal kabulü kaydet' }));
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith('Mal kabul kaydedildi: 1 ürün, ₺420,00.'),
    );
    expect(await data.db.products.get(product.id)).toMatchObject({
      sellPrice: 5000,
      buyPrice: 3500,
    });
  });

  it('marks a line whose product was deleted and names it when saving', async () => {
    const data = createTestData();
    const product = await createProduct(data.db, milk, at);
    await createProduct(data.db, { ...milk, barcode: '8690000000024', name: 'Kola' }, at);
    await renderWithData(<GoodsReceipt onDone={vi.fn()} />, data);
    await scan('8690000000017');
    await scan('8690000000024');
    await lineOf('Kola');
    await deleteProduct(data.db, product.id, later);
    expect(
      await within(await lineOf('Süt')).findByText('Bu ürün silinmiş; satırı çıkarın.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mal kabulü kaydet' }));
    expect(
      await screen.findByText('Mal kabul kaydedilmedi. Düzeltilecek satırlar: Süt.'),
    ).toBeInTheDocument();
    expect(await data.db.purchases.count()).toBe(0);
  });

  it('does not take a typed product name for a barcode', async () => {
    const data = createTestData();
    await createProduct(data.db, { name: 'Ekmek', sellPrice: 1000, vatRate: 1 }, at);
    await renderWithData(<GoodsReceipt onDone={vi.fn()} />, data);
    // Typed by hand: slower than a scanner, so the field's own Enter handles it.
    const user = userEvent.setup({ delay: 80 });
    await user.type(screen.getByLabelText('Ürün ara ya da okut'), 'ekmek');
    await screen.findByRole('button', { name: 'Ekmek' });
    await user.keyboard('{Enter}');
    await expect(
      screen.findByRole('dialog', { name: 'Yeni ürün' }, { timeout: 300 }),
    ).rejects.toThrow();
  });

  it('does not ask a product started here for its opening stock', async () => {
    await renderWithData(<GoodsReceipt onDone={vi.fn()} />);
    await scan('8690000000099');
    const dialog = await screen.findByRole('dialog', { name: 'Yeni ürün' });
    expect(within(dialog).queryByLabelText('Başlangıç stoğu')).not.toBeInTheDocument();
  });

  it('adds a product read by the camera', async () => {
    fakeCamera([['8690000000017']]);
    const data = createTestData();
    await createProduct(data.db, milk, at);
    await renderWithData(<GoodsReceipt onDone={vi.fn()} />, data);
    await userEvent.click(screen.getByRole('button', { name: 'Kamerayla okut' }));
    expect(await lineOf('Süt')).toBeInTheDocument();
  });

  it('adds a new product whose barcode changed in the form', async () => {
    await renderWithData(<GoodsReceipt onDone={vi.fn()} />);
    await scan('8690000000099');
    const dialog = await screen.findByRole('dialog', { name: 'Yeni ürün' });
    const barcode = within(dialog).getByLabelText('Barkod');
    await userEvent.clear(barcode);
    await userEvent.type(barcode, '8690000000105');
    await userEvent.type(within(dialog).getByLabelText('Ürün adı'), 'Kaşar');
    await userEvent.type(within(dialog).getByLabelText('Satış fiyatı'), '120');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    expect(await lineOf('Kaşar')).toBeInTheDocument();
  });

  it('offers to restore a deleted product it scans', async () => {
    const data = createTestData();
    const product = await createProduct(data.db, milk, at);
    await deleteProduct(data.db, product.id, at);
    await renderWithData(<GoodsReceipt onDone={vi.fn()} />, data);
    await scan('8690000000017');
    const dialog = await screen.findByRole('dialog', { name: 'Ürünü düzenle' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Geri getir' }));
    expect(await lineOf('Süt')).toBeInTheDocument();
  });

  it('clears a line error once the line is edited', async () => {
    const data = createTestData();
    await createProduct(data.db, milk, at);
    await renderWithData(<GoodsReceipt onDone={vi.fn()} />, data);
    await scan('8690000000017');
    const quantity = within(await lineOf('Süt')).getByLabelText('Miktar');
    await retype(quantity, '1,5');
    await userEvent.click(screen.getByRole('button', { name: 'Mal kabulü kaydet' }));
    expect(await screen.findByText('Adet için tam sayı girin.')).toBeInTheDocument();
    await retype(quantity, '2');
    expect(screen.queryByText('Adet için tam sayı girin.')).not.toBeInTheDocument();
  });

  it('says which line a rescan counted up', async () => {
    const data = createTestData();
    await createProduct(data.db, milk, at);
    await renderWithData(<GoodsReceipt onDone={vi.fn()} />, data);
    await scan('8690000000017');
    await lineOf('Süt');
    await scan('8690000000017');
    expect(await screen.findByRole('status', { name: '' })).toHaveTextContent('Süt: 2 adet');
  });

  it('reads a scanned code with letters', async () => {
    const data = createTestData();
    await createProduct(
      data.db,
      { barcode: 'BRK-0042', name: 'Bardak', sellPrice: 500, vatRate: 20 },
      at,
    );
    await renderWithData(<GoodsReceipt onDone={vi.fn()} />, data);
    await scan('BRK-0042');
    expect(await lineOf('Bardak')).toBeInTheDocument();
  });

  it('refuses a price above the limit', async () => {
    const data = createTestData();
    await createProduct(data.db, milk, at);
    await renderWithData(<GoodsReceipt onDone={vi.fn()} />, data);
    await scan('8690000000017');
    const buyPrice = within(await lineOf('Süt')).getByLabelText('Alış fiyatı');
    // The box shows the product's price once the product is read; retyping starts from it.
    await waitFor(() => expect(buyPrice).toHaveValue('30,00'));
    await retype(buyPrice, '1000001');
    await userEvent.click(screen.getByRole('button', { name: 'Mal kabulü kaydet' }));
    expect(await screen.findByText('Fiyat en fazla ₺1.000.000,00 olabilir.')).toBeInTheDocument();
    expect(await data.db.purchases.count()).toBe(0);
  });

  it('says that a weighed line is priced by the kilogram', async () => {
    const data = createTestData();
    await createProduct(
      data.db,
      { barcode: '2000000000015', name: 'Peynir', unit: 'kg', sellPrice: 32000, vatRate: 1 },
      at,
    );
    await renderWithData(<GoodsReceipt onDone={vi.fn()} />, data);
    await scan('2000000000015');
    const line = await lineOf('Peynir');
    expect(within(line).getByLabelText('Alış fiyatı')).toHaveAccessibleDescription(
      'Kilogram fiyatı',
    );
    expect(within(line).getByLabelText('Satış fiyatı')).toHaveAccessibleDescription(
      'Kilogram fiyatı',
    );
  });

  it('picks a supplier and saves on account', async () => {
    const data = createTestData();
    await createProduct(data.db, milk, at);
    const supplier = await createSupplier(data.db, { name: 'Eti' }, at);
    const onDone = vi.fn();
    await renderWithData(<GoodsReceipt onDone={onDone} />, data);
    await scan('8690000000017');
    await lineOf('Süt');
    await userEvent.click(screen.getByRole('radio', { name: 'Açık hesap' }));
    await userEvent.click(screen.getByRole('button', { name: 'Mal kabulü kaydet' }));
    expect(await screen.findByText('Açık hesap için tedarikçi seçin.')).toBeInTheDocument();
    await userEvent.selectOptions(await screen.findByLabelText('Tedarikçi'), 'Eti');
    await userEvent.type(screen.getByLabelText('Fatura no'), 'F-77');
    await userEvent.click(screen.getByRole('button', { name: 'Mal kabulü kaydet' }));
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith('Mal kabul kaydedildi: 1 ürün, ₺30,00.'),
    );
    expect(await supplierBalance(data.db, supplier.id)).toBe(3000);
    expect(await data.db.purchases.toArray()).toMatchObject([
      { supplierId: supplier.id, invoiceNo: 'F-77', payment: 'on_account' },
    ]);
  });

  it('saves free goods and VAT-exclusive prices', async () => {
    const data = createTestData();
    const product = await createProduct(data.db, { ...milk, vatRate: 20 }, at);
    const onDone = vi.fn();
    await renderWithData(<GoodsReceipt onDone={onDone} />, data);
    await scan('8690000000017');
    const line = await lineOf('Süt');
    await waitFor(() => expect(within(line).getByLabelText('Alış fiyatı')).toHaveValue('30,00'));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Alış fiyatları KDV hariç' }));
    await retype(within(line).getByLabelText('Alış fiyatı'), '10');
    await retype(within(line).getByLabelText('Miktar'), '3');
    expect(within(line).getByText('Tutar: ₺36,00')).toBeInTheDocument();
    await userEvent.click(within(line).getByRole('checkbox', { name: 'Bedelsiz' }));
    expect(within(line).getByText('Tutar: ₺0,00')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mal kabulü kaydet' }));
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith('Mal kabul kaydedildi: 1 ürün, ₺0,00.'),
    );
    expect(await stockOf(data.db, product.id)).toBe(3000);
    expect((await data.db.products.get(product.id))?.buyPrice).toBe(3000);
  });

  it('lists every supplier and drops one archived elsewhere', async () => {
    const data = createTestData();
    await createProduct(data.db, milk, at);
    for (let n = 1; n <= 51; n += 1) {
      await createSupplier(data.db, { name: `Tedarikçi ${String(n).padStart(2, '0')}` }, at);
    }
    const onDone = vi.fn();
    await renderWithData(<GoodsReceipt onDone={onDone} />, data);
    const select = await screen.findByLabelText('Tedarikçi');
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(52));
    await userEvent.selectOptions(select, 'Tedarikçi 51');
    await scan('8690000000017');
    await lineOf('Süt');
    const last = await data.db.suppliers.where('name').equals('Tedarikçi 51').first();
    await archiveSupplier(data.db, last!.id, later);
    await waitFor(() => expect(select).toHaveDisplayValue('Tedarikçisiz'));
    // Saved as a receipt with no supplier, not refused for the archived one.
    await userEvent.click(screen.getByRole('button', { name: 'Mal kabulü kaydet' }));
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith('Mal kabul kaydedildi: 1 ürün, ₺30,00.'),
    );
    expect((await data.db.purchases.toArray())[0]).not.toHaveProperty('supplierId');
  });
});
