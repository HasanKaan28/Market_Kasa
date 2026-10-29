import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createProduct } from '@/data/products';
import { stockOf } from '@/data/stock';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { scan } from '@/test/scan';
import { GoodsReceipt } from './GoodsReceipt';

const at = new Date('2026-10-29T09:00:00Z');
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
    await userEvent.click(screen.getByRole('button', { name: 'Mal kabulü kaydet' }));
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith('Mal kabul kaydedildi: 1 ürün, ₺360,00.'),
    );
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
});
