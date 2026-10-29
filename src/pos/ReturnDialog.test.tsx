import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { MarketDb } from '@/data/db';
import { createProduct } from '@/data/products';
import { recordReturn } from '@/data/returns';
import { recordSale } from '@/data/sales';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { ReturnDialog } from './ReturnDialog';

const at = new Date('2026-10-29T09:00:00Z');

async function sold(db: MarketDb, name: string, sellPrice: number, units: number) {
  const product = await createProduct(db, { name, sellPrice, vatRate: 1 }, at);
  const sale = await recordSale(db, {
    deviceCode: 'K1',
    at,
    lines: [{ productId: product.id, qtyMilli: units * 1000 }],
    payments: [{ method: 'cash', amount: sellPrice * units }],
  });
  return { product, sale };
}

describe('ReturnDialog', () => {
  it('returns the chosen quantity and shows the refund', async () => {
    const data = createTestData();
    const { sale } = await sold(data.db, 'Ayran', 2250, 3);
    const onReturned = vi.fn();
    await renderWithData(
      <ReturnDialog open sale={sale} onClose={vi.fn()} onReturned={onReturned} />,
      data,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Artır · Ayran' }));
    expect(screen.getByTestId('refund')).toHaveTextContent('₺22,50');
    await userEvent.click(screen.getByRole('button', { name: 'İadeyi kaydet' }));
    await vi.waitFor(() =>
      expect(onReturned).toHaveBeenCalledWith(expect.objectContaining({ amount: 2250 })),
    );
    expect(await data.db.returns.count()).toBe(1);
  });

  it('offers only the methods the sale used', async () => {
    const data = createTestData();
    const { sale } = await sold(data.db, 'Ekmek', 1500, 1);
    await renderWithData(
      <ReturnDialog open sale={sale} onClose={vi.fn()} onReturned={vi.fn()} />,
      data,
    );
    expect(screen.getByRole('radio', { name: 'Nakit' })).toBeChecked();
    expect(screen.queryByRole('radio', { name: 'Veresiye' })).not.toBeInTheDocument();
  });

  it('caps each line at what is left to return', async () => {
    const data = createTestData();
    const { product, sale } = await sold(data.db, 'Ekmek', 1500, 2);
    await recordReturn(data.db, {
      saleId: sale.id,
      lines: [{ productId: product.id, qtyMilli: 1000 }],
      refundMethod: 'cash',
      deviceCode: 'K1',
      at,
    });
    await renderWithData(
      <ReturnDialog open sale={sale} onClose={vi.fn()} onReturned={vi.fn()} />,
      data,
    );
    const more = await screen.findByRole('button', { name: 'Artır · Ekmek' });
    await userEvent.click(more);
    await vi.waitFor(() => expect(more).toBeDisabled());
    expect(screen.getByTestId('refund')).toHaveTextContent('₺15,00');
  });

  it('cannot save an empty return', async () => {
    const data = createTestData();
    const { sale } = await sold(data.db, 'Ekmek', 1500, 1);
    await renderWithData(
      <ReturnDialog open sale={sale} onClose={vi.fn()} onReturned={vi.fn()} />,
      data,
    );
    expect(screen.getByRole('button', { name: 'İadeyi kaydet' })).toBeDisabled();
  });

  it('survives a return made elsewhere while it is open', async () => {
    const data = createTestData();
    const { product, sale } = await sold(data.db, 'Ekmek', 1500, 2);
    await renderWithData(
      <ReturnDialog open sale={sale} onClose={vi.fn()} onReturned={vi.fn()} />,
      data,
    );
    const more = await screen.findByRole('button', { name: 'Artır · Ekmek' });
    await userEvent.click(more);
    await userEvent.click(more);
    expect(screen.getByTestId('refund')).toHaveTextContent('₺30,00');
    await recordReturn(data.db, {
      saleId: sale.id,
      lines: [{ productId: product.id, qtyMilli: 1000 }],
      refundMethod: 'cash',
      deviceCode: 'K1',
      at,
    });
    await vi.waitFor(() => expect(screen.getByTestId('refund')).toHaveTextContent('₺15,00'));
  });
});
