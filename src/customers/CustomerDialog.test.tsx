import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createCustomer, customerBalance } from '@/data/customers';
import { recordAdjustment } from '@/data/ledger';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { CustomerDialog } from './CustomerDialog';
import { CustomerFormDialog } from './CustomerFormDialog';

const at = new Date('2026-10-20T09:00:00Z');

async function owing(amount: number) {
  const data = createTestData();
  const customer = await createCustomer(
    data.db,
    { name: 'Ahmet', phone: '05321112233', creditLimit: 50000 },
    at,
  );
  if (amount !== 0) {
    await recordAdjustment(data.db, { customerId: customer.id, amount, note: 'Eski borç' }, at);
  }
  return { data, customer };
}

describe('CustomerDialog', () => {
  it('takes a payment in cash or by card', async () => {
    const { data, customer } = await owing(42500);
    const onDone = vi.fn();
    await renderWithData(
      <CustomerDialog open customerId={customer.id} onClose={vi.fn()} onDone={onDone} />,
      data,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Ahmet' });
    expect(await within(dialog).findByText('Bakiye: ₺425,00')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Tahsilat al' }));
    const amount = within(dialog).getByLabelText('Tutar');
    expect(amount).toHaveValue('425,00');
    await userEvent.clear(amount);
    await userEvent.type(amount, '100');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Kart' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Tahsilatı kaydet' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Tahsilat alındı: ₺100,00.'));
    expect(await customerBalance(data.db, customer.id)).toBe(32500);
    expect(await within(dialog).findByText('Bakiye: ₺325,00')).toBeInTheDocument();
    const statement = within(dialog).getByRole('table', { name: 'Ekstre' });
    expect(within(statement).getByText('Tahsilat (kart)')).toBeInTheDocument();
    expect((await data.db.ledger.toArray()).at(-1)).toMatchObject({
      kind: 'payment',
      amount: -10000,
      method: 'card',
    });
  });

  it('writes an adjustment only with a note', async () => {
    const { data, customer } = await owing(42500);
    const onDone = vi.fn();
    await renderWithData(
      <CustomerDialog open customerId={customer.id} onClose={vi.fn()} onDone={onDone} />,
      data,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Ahmet' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Düzeltme' }));
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Borç düş' }));
    await userEvent.type(within(dialog).getByLabelText('Tutar'), '20');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Düzeltmeyi kaydet' }));
    expect(await within(dialog).findByText('Neden yazın.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Neden'), 'yuvarlama');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Düzeltmeyi kaydet' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Düzeltme kaydedildi.'));
    expect(await customerBalance(data.db, customer.id)).toBe(40500);
  });

  it('archives only a settled customer', async () => {
    const { data, customer } = await owing(42500);
    const onDone = vi.fn();
    const onClose = vi.fn();
    const view = await renderWithData(
      <CustomerDialog open customerId={customer.id} onClose={onClose} onDone={onDone} />,
      data,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Ahmet' });
    expect(await within(dialog).findByRole('button', { name: 'Arşivle' })).toBeDisabled();
    expect(
      within(dialog).getByText('Bakiyesi sıfır olmayan müşteri arşivlenemez.'),
    ).toBeInTheDocument();
    view.unmount();

    const settled = await owing(0);
    await renderWithData(
      <CustomerDialog open customerId={settled.customer.id} onClose={onClose} onDone={onDone} />,
      settled.data,
    );
    const again = await screen.findByRole('dialog', { name: 'Ahmet' });
    await waitFor(() =>
      expect(within(again).getByRole('button', { name: 'Arşivle' })).toBeEnabled(),
    );
    await userEvent.click(within(again).getByRole('button', { name: 'Arşivle' }));
    // One tap only asks; nothing is archived until it is confirmed.
    expect(within(again).getByText('Bu müşteri arşivlensin mi?')).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    await userEvent.click(within(again).getByRole('button', { name: 'Evet, arşivle' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Müşteri arşivlendi.'));
    expect(onClose).toHaveBeenCalled();
    expect((await settled.data.db.customers.get(settled.customer.id))?.archivedAt).toBeDefined();
  });
});

describe('CustomerFormDialog', () => {
  it('edits and adds a customer', async () => {
    const { data, customer } = await owing(0);
    const onSaved = vi.fn();
    const view = await renderWithData(
      <CustomerFormDialog open customer={customer} onClose={vi.fn()} onSaved={onSaved} />,
      data,
    );
    const dialog = screen.getByRole('dialog', { name: 'Müşteriyi düzenle' });
    expect(within(dialog).getByLabelText('Limit')).toHaveValue('500,00');
    await userEvent.clear(within(dialog).getByLabelText('Ad'));
    await userEvent.type(within(dialog).getByLabelText('Ad'), 'Ahmet Yılmaz');
    await userEvent.clear(within(dialog).getByLabelText('Limit'));
    await userEvent.type(within(dialog).getByLabelText('Limit'), '750');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Müşteri kaydedildi.', customer.id));
    expect(await data.db.customers.get(customer.id)).toMatchObject({
      name: 'Ahmet Yılmaz',
      creditLimit: 75000,
    });
    view.unmount();

    await renderWithData(<CustomerFormDialog open onClose={vi.fn()} onSaved={onSaved} />, data);
    const adding = screen.getByRole('dialog', { name: 'Yeni müşteri' });
    await userEvent.click(within(adding).getByRole('button', { name: 'Kaydet' }));
    expect(within(adding).getByText('Ad gerekli.')).toBeInTheDocument();
    await userEvent.type(within(adding).getByLabelText('Ad'), 'Veli');
    await userEvent.type(within(adding).getByLabelText('Telefon'), '0532 444 55 66');
    await userEvent.click(within(adding).getByRole('button', { name: 'Kaydet' }));
    await waitFor(() =>
      expect(onSaved).toHaveBeenLastCalledWith('Müşteri eklendi.', expect.any(String)),
    );
    expect(await data.db.customers.where('name').equals('Veli').first()).toMatchObject({
      phone: '05324445566',
      creditLimit: 0,
    });
  });

  it('prints the statement and links a reminder', async () => {
    const { data, customer } = await owing(42500);
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    await renderWithData(
      <CustomerDialog open customerId={customer.id} onClose={vi.fn()} onDone={vi.fn()} />,
      data,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Ahmet' });
    const reminder = await within(dialog).findByRole('link', { name: 'WhatsApp ile hatırlat' });
    expect(reminder.getAttribute('href')).toMatch(
      /^https:\/\/wa\.me\/905321112233\?text=Merhaba%20Ahmet/,
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ekstreyi yazdır' }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(document.getElementById('print-root')).toHaveTextContent('Müşteri ekstresi');
    window.dispatchEvent(new Event('afterprint'));
    print.mockRestore();
  });

  it('keeps a customer in credit from being archived', async () => {
    const { data, customer } = await owing(-100);
    await renderWithData(
      <CustomerDialog open customerId={customer.id} onClose={vi.fn()} onDone={vi.fn()} />,
      data,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Ahmet' });
    expect(await within(dialog).findByText('Bakiye: Alacak ₺1,00')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Arşivle' })).toBeDisabled();
  });

  it('takes a payment from the keyboard', async () => {
    const { data, customer } = await owing(42500);
    const onDone = vi.fn();
    await renderWithData(
      <CustomerDialog open customerId={customer.id} onClose={vi.fn()} onDone={onDone} />,
      data,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Ahmet' });
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Tahsilat al' }));
    expect(within(dialog).getByLabelText('Tutar')).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Tahsilat alındı: ₺425,00.'));
  });
});
