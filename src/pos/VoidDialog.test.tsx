import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { MarketDb } from '@/data/db';
import { createProduct } from '@/data/products';
import { recordReturn } from '@/data/returns';
import { recordSale } from '@/data/sales';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { VoidDialog } from './VoidDialog';

const at = new Date('2026-10-29T09:00:00Z');

async function soldMilk(db: MarketDb) {
  const milk = await createProduct(db, { name: 'Süt', sellPrice: 4250, vatRate: 1 }, at);
  const sale = await recordSale(db, {
    deviceCode: 'K1',
    at,
    lines: [{ productId: milk.id, qtyMilli: 1000 }],
    payments: [{ method: 'cash', amount: 4250 }],
  });
  return { milk, sale };
}

describe('VoidDialog', () => {
  it('voids with a reason once, even on a double click', async () => {
    const data = createTestData();
    const { sale } = await soldMilk(data.db);
    const onVoided = vi.fn();
    await renderWithData(
      <VoidDialog open sale={sale} onClose={vi.fn()} onVoided={onVoided} />,
      data,
    );
    await userEvent.type(screen.getByLabelText('İptal nedeni'), 'Yanlış ürün');
    await userEvent.dblClick(screen.getByRole('button', { name: 'İptal et' }));
    await vi.waitFor(() => expect(onVoided).toHaveBeenCalled());
    expect(await data.db.saleVoids.count()).toBe(1);
  });

  it('says what a void gives back', async () => {
    const data = createTestData();
    const milk = await createProduct(data.db, { name: 'Süt', sellPrice: 4000, vatRate: 1 }, at);
    const sale = await recordSale(data.db, {
      deviceCode: 'K1',
      at,
      lines: [{ productId: milk.id, qtyMilli: 1000 }],
      payments: [
        { method: 'cash', amount: 3000 },
        { method: 'card', amount: 1000 },
      ],
    });
    await renderWithData(
      <VoidDialog open sale={sale} onClose={vi.fn()} onVoided={vi.fn()} />,
      data,
    );
    expect(
      await screen.findByText(
        'Stok geri alınır. Nakit ₺30,00 kasadan geri verilir. Kart ₺10,00 karta iade edilir.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/[Vv]eresiye/)).not.toBeInTheDocument();
  });

  it('asks for a reason', async () => {
    const data = createTestData();
    const { sale } = await soldMilk(data.db);
    await renderWithData(
      <VoidDialog open sale={sale} onClose={vi.fn()} onVoided={vi.fn()} />,
      data,
    );
    await userEvent.click(screen.getByRole('button', { name: 'İptal et' }));
    expect(await screen.findByText('İptal nedeni gerekli.')).toBeInTheDocument();
    expect(await data.db.saleVoids.count()).toBe(0);
  });

  it('explains a sale that cannot be voided', async () => {
    const data = createTestData();
    const { milk, sale } = await soldMilk(data.db);
    await recordReturn(data.db, {
      saleId: sale.id,
      lines: [{ productId: milk.id, qtyMilli: 1000 }],
      deviceCode: 'K1',
      at,
    });
    await renderWithData(
      <VoidDialog open sale={sale} onClose={vi.fn()} onVoided={vi.fn()} />,
      data,
    );
    await userEvent.type(screen.getByLabelText('İptal nedeni'), 'Yanlış ürün');
    await userEvent.click(screen.getByRole('button', { name: 'İptal et' }));
    expect(await screen.findByText('İadesi olan satış iptal edilemez.')).toBeInTheDocument();
  });
});
