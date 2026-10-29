import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { recordCount } from '@/data/counts';
import { createProduct } from '@/data/products';
import { recordStockMovement, stockOf } from '@/data/stock';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { scan } from '@/test/scan';
import { StockCount } from './StockCount';

// Counts older than 30 days are not checked, so the times are taken from now.
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);
const tea = { barcode: '8690000000017', name: 'Çay', sellPrice: 9000, vatRate: 1 } as const;

async function lineOf(name: string) {
  return screen.findByRole('group', { name });
}

describe('StockCount', () => {
  it('counts a product up with each scan', async () => {
    const data = createTestData();
    await createProduct(data.db, tea, minutesAgo(60));
    await createProduct(
      data.db,
      { barcode: '2000000000015', name: 'Peynir', unit: 'kg', sellPrice: 32000, vatRate: 1 },
      minutesAgo(60),
    );
    await renderWithData(<StockCount onDone={vi.fn()} />, data);
    await scan('8690000000017');
    await lineOf('Çay');
    await scan('8690000000017');
    await waitFor(async () =>
      expect(within(await lineOf('Çay')).getByLabelText('Sayılan')).toHaveValue('2'),
    );
    await scan('2000000000015');
    expect(within(await lineOf('Peynir')).getByLabelText('Sayılan')).toHaveValue('');
    // A shop's own code with letters: the scanner holds Shift around each capital.
    await createProduct(
      data.db,
      { barcode: 'BRK-0042', name: 'Bardak', sellPrice: 500, vatRate: 20 },
      minutesAgo(60),
    );
    await scan('BRK-0042');
    expect(within(await lineOf('Bardak')).getByLabelText('Sayılan')).toHaveValue('1');
    await scan('8690000000099');
    expect(await screen.findByText('Bu barkod kayıtlı değil.')).toBeInTheDocument();
  });

  it('shows the expected stock and the difference', async () => {
    const data = createTestData();
    await createProduct(data.db, tea, minutesAgo(60), { openingStockMilli: 10000 });
    await renderWithData(<StockCount onDone={vi.fn()} />, data);
    await scan('8690000000017');
    const line = await lineOf('Çay');
    expect(await within(line).findByText('Beklenen: 10 adet')).toBeInTheDocument();
    const counted = within(line).getByLabelText('Sayılan');
    await userEvent.clear(counted);
    await userEvent.type(counted, '8');
    expect(within(line).getByText('Fark: −2 adet')).toBeInTheDocument();
    await userEvent.clear(counted);
    await userEvent.type(counted, '10');
    expect(within(line).getByText('Fark yok')).toBeInTheDocument();
  });

  it('records the count and clears the draft', async () => {
    const data = createTestData();
    const product = await createProduct(data.db, tea, minutesAgo(60), {
      openingStockMilli: 10000,
    });
    const onDone = vi.fn();
    await renderWithData(<StockCount onDone={onDone} />, data);
    await scan('8690000000017');
    const counted = within(await lineOf('Çay')).getByLabelText('Sayılan');
    await userEvent.clear(counted);
    await userEvent.type(counted, '8');
    await userEvent.type(screen.getByLabelText('Not'), 'Raf 3');
    await userEvent.click(screen.getByRole('button', { name: 'Sayımı kaydet' }));
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith('Sayım kaydedildi: 1 ürün, 1 farklı.'),
    );
    expect(await stockOf(data.db, product.id)).toBe(8000);
    expect(await data.db.stockCounts.toArray()).toMatchObject([{ note: 'Raf 3' }]);
    expect(screen.queryByRole('group', { name: 'Çay' })).not.toBeInTheDocument();
  });

  it('keeps the draft across a reload', async () => {
    const data = createTestData();
    await createProduct(data.db, tea, minutesAgo(60));
    const first = await renderWithData(<StockCount onDone={vi.fn()} />, data);
    await scan('8690000000017');
    await scan('8690000000017');
    await waitFor(async () =>
      expect(within(await lineOf('Çay')).getByLabelText('Sayılan')).toHaveValue('2'),
    );
    first.unmount();
    await renderWithData(<StockCount onDone={vi.fn()} />, data);
    expect(within(await lineOf('Çay')).getByLabelText('Sayılan')).toHaveValue('2');
  });

  it('lists counts that need a recount and adds one back', async () => {
    const data = createTestData();
    const product = await createProduct(data.db, tea, minutesAgo(60), {
      openingStockMilli: 10000,
    });
    await recordCount(
      data.db,
      { deviceCode: 'K1', lines: [{ productId: product.id, countedMilli: 10000 }] },
      minutesAgo(10),
    );
    // A sale another register made before the count arrives after it.
    await recordStockMovement(data.db, {
      productId: product.id,
      delta: -1000,
      kind: 'sale',
      at: minutesAgo(20),
    });
    await renderWithData(<StockCount onDone={vi.fn()} />, data);
    const checks = await screen.findByRole('region', { name: 'Kontrol gerekli' });
    expect(
      within(checks).getByText('Çay: sayımda 10 adet beklendi, şimdi 9 adet görünüyor.'),
    ).toBeInTheDocument();
    await userEvent.click(within(checks).getByRole('button', { name: 'Yeniden say: Çay' }));
    expect(await lineOf('Çay')).toBeInTheDocument();
  });
});
