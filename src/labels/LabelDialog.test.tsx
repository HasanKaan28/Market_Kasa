import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProduct, updateProduct } from '@/data/products';
import { createTestData, disposeTestData, renderWithData } from '@/test/renderWithData';
import { LabelDialog } from './LabelDialog';

afterEach(async () => {
  document.getElementById('print-root')?.remove();
  await disposeTestData();
});

const printed = () =>
  within(document.getElementById('print-root') as HTMLElement).getAllByRole('listitem');

describe('LabelDialog', () => {
  it('prints the products picked, each as many times as asked', async () => {
    const data = createTestData();
    await createProduct(
      data.db,
      { name: 'Süt', barcode: '4006381333931', sellPrice: 4250, vatRate: 1 },
      new Date(),
    );
    const print = vi.fn();
    await renderWithData(<LabelDialog open onClose={vi.fn()} print={print} />, data);

    await userEvent.type(screen.getByLabelText('Ürün ekle'), 'süt');
    await userEvent.click(await screen.findByRole('button', { name: 'Ekle: Süt' }));
    const copies = screen.getByLabelText('Adet: Süt');
    await userEvent.clear(copies);
    await userEvent.type(copies, '3');
    await userEvent.click(screen.getByRole('radio', { name: 'Barkod etiketi' }));
    expect(screen.getByText('3 etiket · 1 sayfa')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yazdır' }));

    expect(print).toHaveBeenCalledTimes(1);
    expect(printed()).toHaveLength(3);
    expect(printed()[0]?.querySelector('svg rect')).not.toBeNull();
  });

  it('adds every product whose price changed today', async () => {
    const data = createTestData();
    const milk = await createProduct(
      data.db,
      { name: 'Süt', sellPrice: 4250, vatRate: 1 },
      new Date(),
    );
    await createProduct(data.db, { name: 'Çay', sellPrice: 9000, vatRate: 1 }, new Date());
    await updateProduct(data.db, milk.id, { sellPrice: 4500 }, new Date(), { deviceCode: 'K1' });
    await renderWithData(<LabelDialog open onClose={vi.fn()} print={vi.fn()} />, data);

    await userEvent.click(
      await screen.findByRole('button', { name: 'Bugün fiyatı değişenler (1)' }),
    );
    expect(screen.getByLabelText('Adet: Süt')).toHaveValue('1');
    expect(screen.queryByLabelText('Adet: Çay')).toBeNull();
  });

  it('prints nothing while no label is picked', async () => {
    await renderWithData(<LabelDialog open onClose={vi.fn()} print={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Yazdır' })).toBeDisabled();
  });
});
