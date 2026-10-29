import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '@/app/App';
import { createCustomer } from '@/data/customers';
import { recordAdjustment, recordPayment } from '@/data/ledger';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { CustomersScreen } from './CustomersScreen';

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

function rowsOf(table: HTMLElement): string[][] {
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent ?? ''),
    );
}

describe('CustomersScreen', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('opens from the menu', async () => {
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'Ana menü' });
    await userEvent.click(within(nav).getByRole('link', { name: 'Müşteriler' }));
    expect(
      await screen.findByRole('heading', { name: 'Müşteriler', level: 1 }),
    ).toBeInTheDocument();
  });

  it('lists customers with balance, debt age and limit', async () => {
    const data = createTestData();
    const ahmet = await createCustomer(
      data.db,
      { name: 'Ahmet', phone: '05321112233', creditLimit: 50000 },
      daysAgo(10),
    );
    const veli = await createCustomer(data.db, { name: 'Veli' }, daysAgo(10));
    await createCustomer(data.db, { name: 'Ayşe' }, daysAgo(10));
    await recordAdjustment(
      data.db,
      { customerId: ahmet.id, amount: 42500, note: 'Eski borç' },
      daysAgo(3),
    );
    await recordAdjustment(data.db, { customerId: veli.id, amount: 1000, note: 'x' }, daysAgo(2));
    await recordPayment(
      data.db,
      { deviceCode: 'K1', customerId: veli.id, amount: 3000, method: 'cash' },
      daysAgo(1),
    );
    await renderWithData(<CustomersScreen />, data);
    const table = await screen.findByRole('table', { name: 'Müşteriler' });
    expect(rowsOf(table)).toEqual([
      ['Ahmet', '05321112233', '₺425,00', '3 gün', '₺500,00'],
      ['Ayşe', '—', '₺0,00', '—', '—'],
      ['Veli', '—', 'Alacak ₺20,00', '—', '—'],
    ]);
    await userEvent.click(screen.getByRole('radio', { name: 'Borçlu' }));
    expect(rowsOf(table).map((row) => row[0])).toEqual(['Ahmet']);
  });

  it('finds a customer by name or phone', async () => {
    const data = createTestData();
    await createCustomer(data.db, { name: 'Ahmet Yılmaz', phone: '05321112233' }, daysAgo(1));
    await createCustomer(data.db, { name: 'Veli' }, daysAgo(1));
    await renderWithData(<CustomersScreen />, data);
    const table = await screen.findByRole('table', { name: 'Müşteriler' });
    const search = screen.getByLabelText('Müşteri ara');
    await userEvent.type(search, 'YILMAZ');
    expect(rowsOf(table).map((row) => row[0])).toEqual(['Ahmet Yılmaz']);
    await userEvent.clear(search);
    await userEvent.type(search, '1112');
    expect(rowsOf(table).map((row) => row[0])).toEqual(['Ahmet Yılmaz']);
    await userEvent.clear(search);
    await userEvent.type(search, 'zzz');
    expect(screen.getByText('Bu aramaya uyan müşteri yok.')).toBeInTheDocument();
  });

  it('opens a customer and adds a new one', async () => {
    const data = createTestData();
    await createCustomer(data.db, { name: 'Ahmet' }, daysAgo(1));
    await renderWithData(<CustomersScreen />, data);
    await userEvent.click(await screen.findByRole('button', { name: 'Ahmet' }));
    expect(await screen.findByRole('dialog', { name: 'Ahmet' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Kapat' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yeni müşteri' }));
    const dialog = await screen.findByRole('dialog', { name: 'Yeni müşteri' });
    await userEvent.type(within(dialog).getByLabelText('Ad'), 'Veli');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    expect(await screen.findByRole('button', { name: 'Veli' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Bildirim' })).toHaveTextContent('Müşteri eklendi.');
  });

  it('lists debtors oldest debt first with a WhatsApp link', async () => {
    const data = createTestData();
    const ahmet = await createCustomer(
      data.db,
      { name: 'Ahmet', phone: '05321112233' },
      daysAgo(10),
    );
    const veli = await createCustomer(data.db, { name: 'Veli' }, daysAgo(10));
    await createCustomer(data.db, { name: 'Ayşe' }, daysAgo(10));
    await recordAdjustment(data.db, { customerId: ahmet.id, amount: 1000, note: 'x' }, daysAgo(2));
    await recordAdjustment(data.db, { customerId: veli.id, amount: 2000, note: 'x' }, daysAgo(5));
    await renderWithData(<CustomersScreen />, data);
    await screen.findByRole('table', { name: 'Müşteriler' });
    await userEvent.click(screen.getByRole('radio', { name: 'Hatırlatma' }));
    const table = screen.getByRole('table', { name: 'Müşteriler' });
    expect(rowsOf(table).map((row) => row[0])).toEqual(['Veli', 'Ahmet']);
    const links = within(table).getAllByRole('link', { name: /WhatsApp/ });
    expect(links.map((link) => link.getAttribute('href')?.split('?')[0])).toEqual([
      'https://wa.me/',
      'https://wa.me/905321112233',
    ]);
    expect(links[1]).toHaveAttribute('target', '_blank');
  });
});
