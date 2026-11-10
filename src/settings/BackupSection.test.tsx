import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProduct } from '@/data/products';
import { disposeTestData, renderWithData } from '@/test/renderWithData';
import { BackupSection } from './BackupSection';

afterEach(disposeTestData);

const at = new Date('2026-11-09T18:30:00Z');

describe('BackupSection', () => {
  it('saves the whole market as one file and says how much it holds', async () => {
    const save = vi.fn();
    const { data } = await renderWithData(<BackupSection save={save} now={() => at} />);
    await createProduct(data.db, { name: 'Süt', sellPrice: 4250, buyPrice: 3000, vatRate: 1 }, at);

    await userEvent.click(screen.getByRole('button', { name: 'Yedek al' }));

    // The file is made after the tables are read; the line shows once it is saved.
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Yedek kaydedildi: 1 ürün, 0 satış, 0 müşteri.',
    );
    expect(save).toHaveBeenCalledTimes(1);
    const [fileName, text] = save.mock.calls[0] as [string, string];
    expect(fileName).toBe(`market-kasa-yedek-${data.settings.marketId}-2026-11-09.json`);
    const backup = JSON.parse(text);
    expect(backup.format).toBe('market-kasa-backup');
    expect(backup.tables.products).toEqual([expect.objectContaining({ name: 'Süt' })]);
  });

  it('says so when the file could not be made', async () => {
    const save = vi.fn(() => {
      throw new Error('disk full');
    });
    await renderWithData(<BackupSection save={save} now={() => at} />);
    await userEvent.click(screen.getByRole('button', { name: 'Yedek al' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Yedek alınamadı.');
  });
});
