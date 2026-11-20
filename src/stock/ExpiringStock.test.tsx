import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createProduct } from '@/data/products';
import { recordPurchase } from '@/data/purchases';
import { createTestData, disposeTestData, renderWithData } from '@/test/renderWithData';
import { ExpiringStock } from './ExpiringStock';

afterEach(disposeTestData);

const at = new Date('2026-11-01T09:00:00Z');
// 12:00 on 9 November in Istanbul.
const now = () => new Date('2026-11-09T09:00:00Z');

describe('ExpiringStock', () => {
  it('lists the deliveries running out, the soonest first, with what is left', async () => {
    const data = createTestData();
    const milk = await createProduct(data.db, { name: 'Süt', sellPrice: 4250, vatRate: 1 }, at);
    const yogurt = await createProduct(
      data.db,
      { name: 'Yoğurt', sellPrice: 9000, vatRate: 1 },
      at,
    );
    const cheese = await createProduct(
      data.db,
      { name: 'Kaşar', sellPrice: 40000, vatRate: 1, unit: 'kg' },
      at,
    );
    await recordPurchase(
      data.db,
      {
        deviceCode: 'K1',
        lines: [
          { productId: milk.id, qtyMilli: 12000, expiresOn: '2026-11-12' },
          { productId: yogurt.id, qtyMilli: 6000, expiresOn: '2026-11-08' },
          { productId: cheese.id, qtyMilli: 2500, expiresOn: '2026-11-09' },
        ],
      },
      at,
    );
    await renderWithData(<ExpiringStock now={now} />, data);

    const table = await screen.findByRole('table', { name: 'SKT yaklaşanlar' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      'Yoğurt08.11.2026Geçti (1 gün)6 adet',
      'Kaşar09.11.2026Bugün2,5 kg',
      'Süt12.11.20263 gün kaldı12 adet',
    ]);
  });

  it('says when nothing is running out', async () => {
    await renderWithData(<ExpiringStock now={now} />);
    expect(
      await screen.findByText('30 gün içinde son kullanma tarihi dolan ürün yok.'),
    ).toBeInTheDocument();
  });
});
