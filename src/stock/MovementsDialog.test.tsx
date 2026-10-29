import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createProduct } from '@/data/products';
import { recordPurchase } from '@/data/purchases';
import { recordSale } from '@/data/sales';
import { adjustStock } from '@/data/stock';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { MovementsDialog } from './MovementsDialog';

const at = new Date('2026-10-29T09:00:00Z');
const minute = (n: number) => new Date(at.getTime() + n * 60_000);

describe('MovementsDialog', () => {
  it("lists a product's movements with the stock after each", async () => {
    const data = createTestData();
    const cups = await createProduct(
      data.db,
      { name: 'Bardak', sellPrice: 500, buyPrice: 300, vatRate: 20 },
      at,
      { openingStockMilli: 10000 },
    );
    await recordPurchase(
      data.db,
      { deviceCode: 'K1', lines: [{ productId: cups.id, qtyMilli: 5000 }], note: 'İrsaliye 7' },
      minute(1),
    );
    const sale = await recordSale(data.db, {
      deviceCode: 'K1',
      at: minute(2),
      lines: [{ productId: cups.id, qtyMilli: 2000 }],
      payments: [{ method: 'cash', amount: 1000 }],
    });
    await adjustStock(
      data.db,
      { productId: cups.id, deltaMilli: -1000, reason: 'waste' },
      minute(3),
    );

    await renderWithData(<MovementsDialog open product={cups} onClose={vi.fn()} />, data);
    const table = await screen.findByRole('table', { name: 'Stok hareketleri' });
    const rows = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole('cell')
          .slice(1)
          .map((cell) => cell.textContent),
      );
    expect(rows).toEqual([
      ['Düzeltme', '−1 adet', '12 adet', 'Fire'],
      ['Satış', '−2 adet', '13 adet', sale.receiptNo],
      ['Mal kabul', '+5 adet', '15 adet', 'İrsaliye 7'],
      ['Sayım', '+10 adet', '10 adet', ''],
    ]);
  });
});
