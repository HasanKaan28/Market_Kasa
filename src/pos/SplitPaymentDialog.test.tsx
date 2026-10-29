import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createCustomer } from '@/data/customers';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { SplitPaymentDialog } from './SplitPaymentDialog';

async function setup(total: number) {
  const data = createTestData();
  const onConfirm = vi.fn();
  await renderWithData(
    <SplitPaymentDialog open total={total} onClose={vi.fn()} onConfirm={onConfirm} />,
    data,
  );
  return { data, onConfirm };
}

describe('SplitPaymentDialog', () => {
  it('confirms when the parts add up to the total', async () => {
    const { data, onConfirm } = await setup(5750);
    const customer = await createCustomer(data.db, { name: 'Ahmet Yılmaz' }, new Date());
    await userEvent.type(screen.getByLabelText('Nakit'), '20');
    await userEvent.type(screen.getByLabelText('Kart'), '20');
    await userEvent.type(screen.getByLabelText('Veresiye'), '17,50');
    await userEvent.click(screen.getByRole('button', { name: 'Müşteri seç' }));
    await userEvent.type(await screen.findByLabelText('Müşteri ara'), 'ahmet');
    await userEvent.click(await screen.findByRole('button', { name: /Ahmet Yılmaz/ }));
    expect(await screen.findByText('Müşteri: Ahmet Yılmaz')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Satışı tamamla' }));
    expect(onConfirm).toHaveBeenCalledWith({
      payments: [
        { method: 'cash', amount: 2000 },
        { method: 'card', amount: 2000 },
        { method: 'credit', amount: 1750 },
      ],
      customerId: customer.id,
    });
  });

  it('shows what is left and fills it', async () => {
    await setup(5750);
    await userEvent.type(screen.getByLabelText('Nakit'), '20');
    expect(screen.getByTestId('remaining')).toHaveTextContent('₺37,50');
    await userEvent.click(screen.getByRole('button', { name: 'Kalanı ekle · Kart' }));
    expect(screen.getByLabelText('Kart')).toHaveValue('37,50');
    expect(screen.getByTestId('remaining')).toHaveTextContent('₺0,00');
  });

  it('needs a customer for the credit part', async () => {
    await setup(5750);
    await userEvent.type(screen.getByLabelText('Veresiye'), '57,50');
    expect(screen.getByText('Veresiye için müşteri seçin.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Satışı tamamla' })).toBeDisabled();
  });

  it('computes change from the cash part only', async () => {
    const { onConfirm } = await setup(4250);
    await userEvent.type(screen.getByLabelText('Nakit'), '20');
    await userEvent.type(screen.getByLabelText('Kart'), '22,50');
    await userEvent.type(screen.getByLabelText('Alınan nakit'), '50');
    expect(screen.getByTestId('change')).toHaveTextContent('₺30,00');
    await userEvent.click(screen.getByRole('button', { name: 'Satışı tamamla' }));
    expect(onConfirm).toHaveBeenCalledWith({
      payments: [
        { method: 'cash', amount: 2000 },
        { method: 'card', amount: 2250 },
      ],
      cashGiven: 5000,
    });
  });

  it('leaves out empty parts', async () => {
    const { onConfirm } = await setup(4250);
    await userEvent.type(screen.getByLabelText('Kart'), '42,50');
    await userEvent.click(screen.getByRole('button', { name: 'Satışı tamamla' }));
    expect(onConfirm).toHaveBeenCalledWith({ payments: [{ method: 'card', amount: 4250 }] });
  });
});
