import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createProduct, updateProduct } from '@/data/products';
import { recentSales } from '@/data/sales';
import { createTestData, renderWithData } from '@/test/renderWithData';
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
});
