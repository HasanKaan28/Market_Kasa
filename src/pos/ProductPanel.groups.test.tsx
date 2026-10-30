import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createCategory } from '@/data/categories';
import { createProduct } from '@/data/products';
import type { ProductRecord } from '@/data/types';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { ProductPanel } from './ProductPanel';

// The category query answers only when the test says so, so the panel can be seen mid-switch.
const pending = vi.hoisted(() => ({
  answer: (() => undefined) as (products: ProductRecord[]) => void,
}));
vi.mock('@/data/products', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/products')>();
  return {
    ...actual,
    listProductsInCategory: () =>
      new Promise<ProductRecord[]>((resolve) => {
        pending.answer = resolve;
      }),
  };
});

const at = new Date('2026-10-29T09:00:00Z');

describe('ProductPanel while a group loads', () => {
  it("never shows the previous group's products under the new heading", async () => {
    const data = createTestData();
    const bread = await createCategory(data.db, 'Ekmek', at);
    await createProduct(data.db, { name: 'Süt', sellPrice: 4250, vatRate: 1, isQuick: true }, at);
    const simit = await createProduct(
      data.db,
      { name: 'Simit', sellPrice: 1500, vatRate: 1, categoryId: bread.id },
      at,
    );
    await renderWithData(<ProductPanel onAdd={vi.fn()} onNewProduct={vi.fn()} />, data);
    await screen.findByRole('button', { name: /Süt/ });

    await userEvent.click(screen.getByRole('radio', { name: 'Ekmek' }));
    expect(screen.getByRole('heading', { name: 'Ekmek' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Süt/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Bu grupta ürün yok.')).not.toBeInTheDocument();

    pending.answer([simit]);
    expect(await screen.findByRole('button', { name: /Simit/ })).toBeInTheDocument();
  });
});
