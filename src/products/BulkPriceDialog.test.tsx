import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createProduct } from '@/data/products';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { BulkPriceDialog } from './BulkPriceDialog';

const at = new Date('2026-10-29T09:00:00Z');

describe('BulkPriceDialog', () => {
  it('shows what the prices become and changes them', async () => {
    const data = createTestData();
    const milk = await createProduct(data.db, { name: 'Süt', sellPrice: 4250, vatRate: 1 }, at);
    const onDone = vi.fn();
    await renderWithData(
      <BulkPriceDialog open products={[milk]} onClose={vi.fn()} onDone={onDone} />,
      data,
    );
    expect(screen.getByRole('dialog', { name: 'Toplu fiyat değişikliği' })).toHaveTextContent(
      'Listedeki 1 ürün',
    );
    await userEvent.type(screen.getByLabelText('Miktar'), '10');
    await userEvent.click(screen.getByRole('radio', { name: '0,50' }));
    expect(screen.getByText('Süt: ₺42,50 → ₺47,00')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '1 ürünün fiyatını değiştir' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('1 ürünün fiyatı değişti.'));
    expect((await data.db.products.get(milk.id))?.sellPrice).toBe(4700);
  });

  it('decreases by an amount and refuses what it cannot read', async () => {
    const data = createTestData();
    const milk = await createProduct(
      data.db,
      { name: 'Süt', sellPrice: 4250, buyPrice: 3000, vatRate: 1 },
      at,
    );
    await renderWithData(
      <BulkPriceDialog open products={[milk]} onClose={vi.fn()} onDone={vi.fn()} />,
      data,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Alış fiyatı' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Azalt' }));
    await userEvent.click(screen.getByRole('radio', { name: '₺' }));
    await userEvent.type(screen.getByLabelText('Miktar'), '5');
    expect(screen.getByText('Süt: ₺30,00 → ₺25,00')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Miktar'));
    await userEvent.type(screen.getByLabelText('Miktar'), 'abc');
    expect(screen.getByText('Geçerli bir miktar girin.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /fiyatını değiştir/ })).toBeDisabled();
  });
});
