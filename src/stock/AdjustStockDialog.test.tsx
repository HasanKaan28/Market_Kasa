import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createProduct } from '@/data/products';
import { stockOf } from '@/data/stock';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { AdjustStockDialog } from './AdjustStockDialog';

const at = new Date('2026-10-29T09:00:00Z');

describe('AdjustStockDialog', () => {
  it('takes stock out with a reason', async () => {
    const data = createTestData();
    const cups = await createProduct(data.db, { name: 'Bardak', sellPrice: 500, vatRate: 20 }, at, {
      openingStockMilli: 12000,
    });
    const onDone = vi.fn();
    await renderWithData(
      <AdjustStockDialog open product={cups} onClose={vi.fn()} onDone={onDone} />,
      data,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Çıkar' }));
    await userEvent.type(screen.getByLabelText('Miktar'), '2');
    await userEvent.selectOptions(screen.getByLabelText('Neden'), 'Fire');
    await userEvent.type(screen.getByLabelText('Not'), 'kırık');
    expect(await screen.findByText('Stok: 12 adet → 10 adet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Stoğu düzelt' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Stok düzeltildi.'));
    expect(await stockOf(data.db, cups.id)).toBe(10000);
    const movements = await data.db.stockMovements.where('productId').equals(cups.id).toArray();
    expect(movements.at(-1)).toMatchObject({ kind: 'manual', delta: -2000, note: 'Fire: kırık' });
  });

  it('warns before stock goes below zero', async () => {
    const data = createTestData();
    const cups = await createProduct(data.db, { name: 'Bardak', sellPrice: 500, vatRate: 20 }, at, {
      openingStockMilli: 1000,
    });
    const onDone = vi.fn();
    await renderWithData(
      <AdjustStockDialog open product={cups} onClose={vi.fn()} onDone={onDone} />,
      data,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Çıkar' }));
    await userEvent.type(screen.getByLabelText('Miktar'), '3');
    expect(await screen.findByText('Stok eksiye düşecek.')).toBeInTheDocument();
    expect(screen.getByText('Stok: 1 adet → −2 adet')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Miktar'));
    await userEvent.type(screen.getByLabelText('Miktar'), '1,5');
    expect(screen.getByText('Adet için tam sayı girin.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stoğu düzelt' })).toBeDisabled();
  });
});
