import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AppData } from '@/app/appData';
import { openCashSession } from '@/data/cash';
import { createProduct } from '@/data/products';
import { recordSale } from '@/data/sales';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { CashDialog } from './CashDialog';
import { formatDateTime } from './format';

async function sellForCash(data: AppData, amount: number) {
  const tea = await createProduct(
    data.db,
    { name: `Çay ${amount}`, sellPrice: amount, vatRate: 1 },
    new Date(Date.now() - 60_000),
  );
  return recordSale(data.db, {
    deviceCode: 'K1',
    at: new Date(),
    lines: [{ productId: tea.id, qtyMilli: 1000 }],
    payments: [{ method: 'cash', amount }],
  });
}

async function figure(label: string, amount: string) {
  return within(await screen.findByRole('group', { name: label })).findByText(amount);
}

async function closeDay(counted: string) {
  await userEvent.click(await screen.findByRole('button', { name: 'Gün sonu (Z)' }));
  await userEvent.type(await screen.findByLabelText('Sayılan nakit'), counted);
  await userEvent.click(screen.getByRole('button', { name: 'Z raporunu kaydet' }));
  expect(await screen.findByText('Z raporu kaydedildi.')).toBeInTheDocument();
}

describe('CashDialog', () => {
  it('opens the drawer, records cash out and closes with a Z report', async () => {
    const data = createTestData();
    const onDone = vi.fn();
    await renderWithData(
      <CashDialog open paperWidth={80} onClose={vi.fn()} onDone={onDone} />,
      data,
    );
    await userEvent.type(await screen.findByLabelText('Açılış nakdi'), '200');
    await userEvent.click(screen.getByRole('button', { name: 'Kasayı aç' }));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith('Kasa açıldı · ₺200,00'));

    await sellForCash(data, 3000);
    expect(await figure('Beklenen nakit', '₺230,00')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Para çıkışı' }));
    await userEvent.type(screen.getByLabelText('Tutar'), '50');
    await userEvent.type(screen.getByLabelText('Neden'), 'Ekmekçi');
    await userEvent.click(screen.getByRole('button', { name: 'Çıkışı kaydet' }));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith('Para çıkışı kaydedildi · ₺50,00'));
    expect(await figure('Beklenen nakit', '₺180,00')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Gün sonu (Z)' }));
    await userEvent.type(await screen.findByLabelText('Sayılan nakit'), '175');
    expect(await figure('Fark', '−₺5,00')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Z raporunu kaydet' }));
    expect(await screen.findByText('Z raporu kaydedildi.')).toBeInTheDocument();
    const sessions = await data.db.cashSessions.toArray();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      openingCash: 20000,
      expectedCash: 18000,
      countedCash: 17500,
      difference: -500,
      cash: { sales: 3000, movementsOut: 5000 },
    });
  });

  it('closes a day the drawer was never opened', async () => {
    const data = createTestData();
    await sellForCash(data, 4500);
    await renderWithData(
      <CashDialog open paperWidth={80} onClose={vi.fn()} onDone={vi.fn()} />,
      data,
    );
    expect(await screen.findByText('Kasa açılmadı.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Gün sonu (Z)' }));
    expect(await screen.findByText(/Kasa açılmadan satış yapıldı\./)).toBeInTheDocument();
    expect(await figure('Beklenen nakit', '₺45,00')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Sayılan nakit'), '45');
    expect(await figure('Fark', '₺0,00')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Z raporunu kaydet' }));
    expect(await screen.findByText('Z raporu kaydedildi.')).toBeInTheDocument();
    const [z] = await data.db.cashSessions.toArray();
    expect(z).toMatchObject({ openingCash: 0, expectedCash: 4500, difference: 0 });
    expect(z?.openedAt).toBeUndefined();
  });

  it('shows the date of a drawer opened on another day', async () => {
    const data = createTestData();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await openCashSession(data.db, { deviceCode: 'K1', openingCash: 10000 }, yesterday);
    await renderWithData(
      <CashDialog open paperWidth={80} onClose={vi.fn()} onDone={vi.fn()} />,
      data,
    );
    expect(
      await screen.findByText(
        `Açık · ${formatDateTime(yesterday.toISOString())} · Açılış nakdi ₺100,00`,
      ),
    ).toBeInTheDocument();
  });

  it('says the same about an unopened drawer on screen and on paper', async () => {
    const data = createTestData();
    const tea = await createProduct(
      data.db,
      { name: 'Çay', sellPrice: 2000, vatRate: 1 },
      new Date(Date.now() - 60_000),
    );
    await recordSale(data.db, {
      deviceCode: 'K1',
      at: new Date(),
      lines: [{ productId: tea.id, qtyMilli: 1000 }],
      payments: [{ method: 'card', amount: 2000 }],
    });
    await renderWithData(
      <CashDialog open paperWidth={80} onClose={vi.fn()} onDone={vi.fn()} />,
      data,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Gün sonu (Z)' }));
    // A card-only day is still a day of sales.
    expect(await screen.findByText(/Kasa açılmadan satış yapıldı\./)).toBeInTheDocument();
  });

  it('asks for the counted cash', async () => {
    const data = createTestData();
    await renderWithData(
      <CashDialog open paperWidth={80} onClose={vi.fn()} onDone={vi.fn()} />,
      data,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Gün sonu (Z)' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Z raporunu kaydet' }));
    expect(await screen.findByText('Sayılan nakdi girin.')).toBeInTheDocument();
    expect(await data.db.cashSessions.count()).toBe(0);
  });

  it('prints the Z report on the receipt paper', async () => {
    const data = createTestData();
    await sellForCash(data, 4500);
    await renderWithData(
      <CashDialog open paperWidth={58} onClose={vi.fn()} onDone={vi.fn()} />,
      data,
    );
    await closeDay('45');
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    try {
      await userEvent.click(screen.getByRole('button', { name: 'Yazdır' }));
      expect(print).toHaveBeenCalledTimes(1);
      const printed = document.getElementById('print-root');
      expect(printed).toHaveTextContent('Z RAPORU');
      expect(printed).toHaveTextContent('Kasa açılmadan satış yapıldı.');
      expect(document.getElementById('print-page')?.textContent).toContain('size: 58mm');
    } finally {
      window.dispatchEvent(new Event('afterprint'));
      print.mockRestore();
    }
  });
});
