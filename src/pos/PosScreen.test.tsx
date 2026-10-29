import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createProduct, updateProduct } from '@/data/products';
import { recentSales, recordSale } from '@/data/sales';
import { stockOf } from '@/data/stock';
import { isVoided } from '@/data/voids';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { cartReducer, emptyCart, loadCart } from './cart';
import { checkout, singlePayment } from './checkout';
import { PosScreen } from './PosScreen';

const milk = { barcode: '8690000000017', name: 'Süt', sellPrice: 4250, vatRate: 1 } as const;

function scan(code: string) {
  for (const key of [...code, 'Enter']) {
    fireEvent.keyDown(window, { key });
  }
}

describe('PosScreen', () => {
  it('sells a scanned product for cash', async () => {
    const { data } = await renderWithData(<PosScreen />);
    await createProduct(data.db, milk, new Date());
    scan(milk.barcode);
    expect(await screen.findByText('1 kalem')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'F2' });
    await userEvent.type(await screen.findByLabelText('Alınan tutar'), '50');
    await userEvent.click(screen.getByRole('button', { name: 'Satışı tamamla' }));
    expect(await screen.findByText(/Satış tamamlandı · K1-\d{8}-0001/)).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Bildirim' })).toHaveTextContent('Satış tamamlandı');
    expect(await recentSales(data.db)).toHaveLength(1);
    expect(screen.getByText('Sepet boş')).toBeInTheDocument();
  });

  it('adds an unknown scanned barcode through the new product dialog', async () => {
    await renderWithData(<PosScreen />);
    scan('8690000000099');
    await userEvent.type(await screen.findByLabelText('Ürün adı'), 'Kaşar');
    await userEvent.type(screen.getByLabelText('Satış fiyatı'), '120');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet ve sepete ekle' }));
    expect(await screen.findByText('1 kalem')).toBeInTheDocument();
  });

  it('sells on credit to a picked customer', async () => {
    const { data } = await renderWithData(<PosScreen />);
    await createProduct(data.db, milk, new Date());
    scan(milk.barcode);
    await userEvent.click(await screen.findByRole('button', { name: 'Veresiye' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Yeni müşteri' }));
    await userEvent.type(screen.getByLabelText('Müşteri adı'), 'Ahmet');
    await userEvent.click(screen.getByRole('button', { name: 'Ekle' }));
    expect(await screen.findByText(/Satış tamamlandı/)).toBeInTheDocument();
    expect((await recentSales(data.db))[0]?.payments).toEqual([{ method: 'credit', amount: 4250 }]);
  });

  it('follows a price changed elsewhere', async () => {
    const { data } = await renderWithData(<PosScreen />);
    const created = await createProduct(data.db, milk, new Date());
    scan(milk.barcode);
    await screen.findByText('1 kalem');
    await updateProduct(data.db, created.id, { sellPrice: 5000 }, new Date());
    await vi.waitFor(() => expect(screen.getByTestId('total')).toHaveTextContent('₺50,00'));
  });

  it('ignores a scan while a payment dialog is open', async () => {
    const { data } = await renderWithData(<PosScreen />);
    await createProduct(data.db, milk, new Date());
    scan(milk.barcode);
    await screen.findByText('1 kalem');
    fireEvent.keyDown(window, { key: 'F2' });
    await screen.findByRole('dialog', { name: 'Nakit ödeme' });
    scan(milk.barcode);
    expect(await screen.findByText('Önce açık pencereyi kapatın.')).toBeInTheDocument();
    expect(screen.getByText('1 × ₺42,50')).toBeInTheDocument();
  });

  it('keeps the cart after a reload', async () => {
    const data = createTestData();
    const first = await renderWithData(<PosScreen />, data);
    await createProduct(data.db, milk, new Date());
    scan(milk.barcode);
    await screen.findByText('1 kalem');
    first.unmount();
    await renderWithData(<PosScreen />, data);
    expect(await screen.findByText('1 kalem')).toBeInTheDocument();
  });

  it('takes over the cart another tab saved', async () => {
    const { data } = await renderWithData(<PosScreen />);
    const created = await createProduct(data.db, milk, new Date());
    const other = cartReducer(emptyCart(), { type: 'add', product: created });
    localStorage.setItem('mk2.cart', JSON.stringify(other));
    window.dispatchEvent(new StorageEvent('storage', { key: 'mk2.cart' }));
    expect(await screen.findByText('1 kalem')).toBeInTheDocument();
  });

  it('renews a cart that another tab already sold', async () => {
    const { data } = await renderWithData(<PosScreen />);
    await createProduct(data.db, milk, new Date());
    scan(milk.barcode);
    await screen.findByText('1 kalem');
    await vi.waitFor(() => expect(loadCart().lines).toHaveLength(1));
    const saved = loadCart();
    const doubled = saved.lines.map((line) => ({ ...line, qtyMilli: 2000 }));
    await checkout(data.db, {
      cart: { ...saved, lines: doubled },
      deviceCode: 'K1',
      payments: [{ method: 'card', amount: 8500 }],
      at: new Date(),
    });
    fireEvent.keyDown(window, { key: 'F4' });
    await userEvent.click(await screen.findByRole('button', { name: 'Satışı tamamla' }));
    expect(
      await screen.findByText(
        'Bu sepet başka bir pencerede satılmış. Sepet yenilendi, yeniden deneyin.',
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Satışı tamamla' }));
    await vi.waitFor(async () => expect(await data.db.sales.count()).toBe(2));
  });

  it('holds a cart and resumes it with the same id', async () => {
    const { data } = await renderWithData(<PosScreen />);
    await createProduct(data.db, milk, new Date());
    scan(milk.barcode);
    await screen.findByText('1 kalem');
    await vi.waitFor(() => expect(loadCart().lines).toHaveLength(1));
    const heldId = loadCart().id;
    fireEvent.keyDown(window, { key: 'F8' });
    expect(await screen.findByText('Sepet boş')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'F8' });
    await userEvent.click(await screen.findByRole('button', { name: /^Devam et/ }));
    expect(await screen.findByText('1 kalem')).toBeInTheDocument();
    await vi.waitFor(() => expect(loadCart().id).toBe(heldId));
  });

  it('swaps the current cart when resuming another', async () => {
    const { data } = await renderWithData(<PosScreen />);
    await createProduct(data.db, milk, new Date());
    await createProduct(
      data.db,
      { barcode: '8690000000024', name: 'Ekmek', sellPrice: 1500, vatRate: 1 },
      new Date(),
    );
    scan(milk.barcode);
    await screen.findByText('1 kalem');
    fireEvent.keyDown(window, { key: 'F8' });
    await screen.findByText('Sepet boş');
    scan('8690000000024');
    await screen.findByText('1 × ₺15,00');
    await userEvent.click(screen.getByRole('button', { name: 'Bekleyenler (1)' }));
    await userEvent.click(await screen.findByRole('button', { name: /^Devam et/ }));
    expect(await screen.findByText('1 × ₺42,50')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bekleyenler (1)' })).toBeEnabled();
  });

  it('voids a sale from recent receipts', async () => {
    const { data } = await renderWithData(<PosScreen />);
    const created = await createProduct(data.db, milk, new Date());
    const sale = await recordSale(data.db, {
      deviceCode: 'K1',
      at: new Date(),
      lines: [{ productId: created.id, qtyMilli: 1000 }],
      payments: [{ method: 'cash', amount: 4250 }],
    });
    fireEvent.keyDown(window, { key: 'F9' });
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(sale.receiptNo) }));
    await userEvent.click(await screen.findByRole('button', { name: 'Satışı iptal et' }));
    await userEvent.type(await screen.findByLabelText('İptal nedeni'), 'Yanlış ürün');
    await userEvent.click(screen.getByRole('button', { name: 'İptal et' }));
    expect(await screen.findByText(`Satış iptal edildi · ${sale.receiptNo}`)).toBeInTheDocument();
    expect(await isVoided(data.db, sale.id)).toBe(true);
  });

  it('takes a return from a receipt', async () => {
    const { data } = await renderWithData(<PosScreen />);
    const created = await createProduct(data.db, milk, new Date());
    const sale = await recordSale(data.db, {
      deviceCode: 'K1',
      at: new Date(),
      lines: [{ productId: created.id, qtyMilli: 1000 }],
      payments: [{ method: 'cash', amount: 4250 }],
    });
    fireEvent.keyDown(window, { key: 'F9' });
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(sale.receiptNo) }));
    await userEvent.click(await screen.findByRole('button', { name: 'İade al' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Artır · Süt' }));
    await userEvent.click(screen.getByRole('button', { name: 'İadeyi kaydet' }));
    expect(await screen.findByText('İade kaydedildi · ₺42,50 · Nakit ₺42,50')).toBeInTheDocument();
    expect(await stockOf(data.db, created.id)).toBe(0);
  });

  it('drops a held cart that was already sold', async () => {
    const data = createTestData();
    const created = await createProduct(data.db, milk, new Date());
    const cart = cartReducer(emptyCart(), { type: 'add', product: created });
    await checkout(data.db, {
      cart,
      deviceCode: 'K1',
      payments: singlePayment(cart, 'cash'),
      at: new Date(),
    });
    localStorage.setItem('mk2.held', JSON.stringify([{ cart, heldAt: new Date().toISOString() }]));
    await renderWithData(<PosScreen />, data);
    await userEvent.click(screen.getByRole('button', { name: 'Bekleyenler (1)' }));
    await userEvent.click(await screen.findByRole('button', { name: /^Devam et/ }));
    expect(
      await screen.findByText('Bu sepet zaten satılmış; bekleyenlerden çıkarıldı.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Sepet boş')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bekleyenler (0)' })).toBeDisabled();
  });

  it('sells a discounted cart', async () => {
    const { data } = await renderWithData(<PosScreen />);
    await createProduct(data.db, milk, new Date());
    scan(milk.barcode);
    await screen.findByText('1 kalem');
    await userEvent.click(screen.getByRole('button', { name: 'Düzenle · Süt' }));
    await userEvent.click(await screen.findByRole('radio', { name: 'Yüzde (%)' }));
    await userEvent.type(screen.getByLabelText('İndirim'), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await vi.waitFor(() => expect(screen.getByTestId('total')).toHaveTextContent('₺38,25'));
    fireEvent.keyDown(window, { key: 'F2' });
    await userEvent.click(await screen.findByRole('button', { name: 'Satışı tamamla' }));
    await screen.findByText(/Satış tamamlandı/);
    expect((await recentSales(data.db))[0]?.lines[0]?.lineDiscount).toBe(425);
  });

  it('sells with a split payment', async () => {
    const { data } = await renderWithData(<PosScreen />);
    await createProduct(data.db, milk, new Date());
    scan(milk.barcode);
    await screen.findByText('1 kalem');
    await userEvent.click(screen.getByRole('button', { name: 'Bölünmüş' }));
    await userEvent.type(await screen.findByLabelText('Nakit'), '20');
    await userEvent.type(screen.getByLabelText('Kart'), '22,50');
    await userEvent.click(screen.getByRole('button', { name: 'Satışı tamamla' }));
    await screen.findByText(/Satış tamamlandı/);
    expect((await recentSales(data.db))[0]?.payments).toEqual([
      { method: 'cash', amount: 2000 },
      { method: 'card', amount: 2250 },
    ]);
  });

  it('lets go of the line editor when its line disappears', async () => {
    const { data } = await renderWithData(<PosScreen />);
    await createProduct(data.db, milk, new Date());
    scan(milk.barcode);
    await screen.findByText('1 kalem');
    await userEvent.click(screen.getByRole('button', { name: 'Düzenle · Süt' }));
    await screen.findByLabelText('Miktar');
    // Another tab empties the cart while the editor is open.
    localStorage.setItem('mk2.cart', JSON.stringify(emptyCart()));
    window.dispatchEvent(new StorageEvent('storage', { key: 'mk2.cart' }));
    await screen.findByText('Sepet boş');
    fireEvent.keyDown(window, { key: 'F9' });
    expect(await screen.findByRole('dialog', { name: 'Son fişler' })).toBeInTheDocument();
  });

  it('prints the new receipt when auto print is on', async () => {
    localStorage.setItem(
      'mk2.receipt',
      JSON.stringify({ printing: true, autoPrint: true, paperWidth: 80, header: '', footer: '' }),
    );
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const { data } = await renderWithData(<PosScreen />);
    await createProduct(data.db, milk, new Date());
    scan(milk.barcode);
    await screen.findByText('1 kalem');
    fireEvent.keyDown(window, { key: 'F2' });
    await userEvent.click(await screen.findByRole('button', { name: 'Satışı tamamla' }));
    await vi.waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event('afterprint'));
    print.mockRestore();
  });

  it('does not print after a void', async () => {
    localStorage.setItem(
      'mk2.receipt',
      JSON.stringify({ printing: true, autoPrint: true, paperWidth: 80, header: '', footer: '' }),
    );
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const { data } = await renderWithData(<PosScreen />);
    const created = await createProduct(data.db, milk, new Date());
    const sale = await recordSale(data.db, {
      deviceCode: 'K1',
      at: new Date(),
      lines: [{ productId: created.id, qtyMilli: 1000 }],
      payments: [{ method: 'cash', amount: 4250 }],
    });
    fireEvent.keyDown(window, { key: 'F9' });
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(sale.receiptNo) }));
    await userEvent.click(await screen.findByRole('button', { name: 'Satışı iptal et' }));
    await userEvent.type(await screen.findByLabelText('İptal nedeni'), 'Yanlış ürün');
    await userEvent.click(screen.getByRole('button', { name: 'İptal et' }));
    await screen.findByText(`Satış iptal edildi · ${sale.receiptNo}`);
    expect(print).not.toHaveBeenCalled();
    print.mockRestore();
  });
});
