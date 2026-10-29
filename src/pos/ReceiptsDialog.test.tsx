import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { MarketDb } from '@/data/db';
import { createProduct } from '@/data/products';
import { recordSale } from '@/data/sales';
import { voidSale } from '@/data/voids';
import { renderWithData } from '@/test/renderWithData';
import { ReceiptsDialog } from './ReceiptsDialog';

const at = new Date('2026-10-29T09:00:00Z');

async function twoSales(db: MarketDb) {
  const milk = await createProduct(db, { name: 'Süt', sellPrice: 4250, vatRate: 1 }, at);
  const sell = () =>
    recordSale(db, {
      deviceCode: 'K1',
      at,
      lines: [{ productId: milk.id, qtyMilli: 1000 }],
      payments: [{ method: 'cash', amount: 4250 }],
    });
  return [await sell(), await sell()] as const;
}

describe('ReceiptsDialog', () => {
  it('lists recent sales and marks voided ones', async () => {
    const { data } = await renderWithData(
      <ReceiptsDialog open onClose={vi.fn()} onReturn={vi.fn()} onVoid={vi.fn()} />,
    );
    const [first] = await twoSales(data.db);
    await voidSale(data.db, { saleId: first.id, reason: 'Yanlış', deviceCode: 'K1', at });
    expect(await screen.findByText('K1-20261029-0001')).toBeInTheDocument();
    expect(screen.getByText('K1-20261029-0002')).toBeInTheDocument();
    expect(await screen.findAllByText('İptal edildi')).toHaveLength(1);
  });

  it('finds a receipt by its last four digits', async () => {
    const { data } = await renderWithData(
      <ReceiptsDialog open onClose={vi.fn()} onReturn={vi.fn()} onVoid={vi.fn()} />,
    );
    await twoSales(data.db);
    await screen.findByText('K1-20261029-0001');
    await userEvent.type(screen.getByLabelText('Fiş no'), '0002');
    await vi.waitFor(() => expect(screen.queryByText('K1-20261029-0001')).not.toBeInTheDocument());
    expect(screen.getByText('K1-20261029-0002')).toBeInTheDocument();
  });

  it('shows a receipt and starts a return or a void', async () => {
    const onReturn = vi.fn();
    const onVoid = vi.fn();
    const { data } = await renderWithData(
      <ReceiptsDialog open onClose={vi.fn()} onReturn={onReturn} onVoid={onVoid} />,
    );
    const [first] = await twoSales(data.db);
    await userEvent.click(await screen.findByRole('button', { name: /K1-20261029-0001/ }));
    const detail = await screen.findByRole('region', { name: 'Fiş K1-20261029-0001' });
    expect(detail).toHaveTextContent('Süt');
    expect(detail).toHaveTextContent('1 × ₺42,50');
    expect(detail).toHaveTextContent('₺42,50');
    await userEvent.click(within(detail).getByRole('button', { name: 'İade al' }));
    expect(onReturn).toHaveBeenCalledWith(expect.objectContaining({ id: first.id }));
    await userEvent.click(within(detail).getByRole('button', { name: 'Satışı iptal et' }));
    expect(onVoid).toHaveBeenCalledWith(expect.objectContaining({ id: first.id }));
  });

  it('blocks a second void and a return on a voided sale', async () => {
    const { data } = await renderWithData(
      <ReceiptsDialog open onClose={vi.fn()} onReturn={vi.fn()} onVoid={vi.fn()} />,
    );
    const [first] = await twoSales(data.db);
    await voidSale(data.db, { saleId: first.id, reason: 'Yanlış', deviceCode: 'K1', at });
    await userEvent.click(await screen.findByRole('button', { name: /K1-20261029-0001/ }));
    const detail = await screen.findByRole('region', { name: 'Fiş K1-20261029-0001' });
    await vi.waitFor(() =>
      expect(within(detail).getByRole('button', { name: 'Satışı iptal et' })).toBeDisabled(),
    );
    expect(within(detail).getByRole('button', { name: 'İade al' })).toBeDisabled();
  });
});
