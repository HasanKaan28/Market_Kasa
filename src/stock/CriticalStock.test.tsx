import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { MarketDb } from '@/data/db';
import { createProduct, deleteProduct } from '@/data/products';
import { recordStockMovement } from '@/data/stock';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { CriticalStock } from './CriticalStock';
import { StockScreen } from './StockScreen';

const at = new Date('2026-10-29T09:00:00Z');

async function stocked(db: MarketDb, name: string, criticalLevelMilli: number, stockMilli: number) {
  const product = await createProduct(
    db,
    { name, sellPrice: 1000, vatRate: 1, criticalLevelMilli },
    at,
  );
  if (stockMilli !== 0) {
    await recordStockMovement(db, { productId: product.id, delta: stockMilli, kind: 'count', at });
  }
  return product;
}

describe('CriticalStock', () => {
  it('lists products at or below their level, the shortest first', async () => {
    const data = createTestData();
    await stocked(data.db, 'Ayran', 10000, 9000);
    await stocked(data.db, 'Bardak', 5000, -2000);
    await stocked(data.db, 'Cips', 5000, 6000);
    await stocked(data.db, 'Defter', 0, -5000);
    const gone = await stocked(data.db, 'Eski', 5000, 0);
    await deleteProduct(data.db, gone.id, at);
    await renderWithData(<CriticalStock onReceive={vi.fn()} />, data);
    const table = await screen.findByRole('table', { name: 'Kritik stok' });
    expect(
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.textContent),
    ).toEqual([
      expect.stringContaining('Bardak−2 adet5 adet'),
      expect.stringContaining('Ayran9 adet10 adet'),
    ]);
  });

  it('says when nothing is running out', async () => {
    await renderWithData(<CriticalStock onReceive={vi.fn()} />);
    expect(await screen.findByText('Kritik stokta ürün yok.')).toBeInTheDocument();
  });

  it('adds a product to the goods receipt', async () => {
    const data = createTestData();
    await stocked(data.db, 'Bardak', 5000, 1000);
    await renderWithData(<StockScreen />, data);
    await userEvent.click(screen.getByRole('radio', { name: 'Kritik stok' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mal kabule ekle: Bardak' }));
    expect(screen.getByRole('radio', { name: 'Mal kabul' })).toBeChecked();
    expect(await screen.findByRole('group', { name: 'Bardak' })).toBeInTheDocument();
  });
});
