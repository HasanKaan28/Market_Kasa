import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createCustomer } from '@/data/customers';
import { renderWithData } from '@/test/renderWithData';
import { CustomerPicker } from './CustomerPicker';

describe('CustomerPicker', () => {
  it('finds and picks a customer, showing the balance', async () => {
    const onPick = vi.fn();
    const { data } = await renderWithData(
      <CustomerPicker open onClose={vi.fn()} onPick={onPick} />,
    );
    const customer = await createCustomer(data.db, { name: 'Ahmet Yılmaz' }, new Date());
    await userEvent.type(screen.getByLabelText('Müşteri ara'), 'yilmaz');
    await userEvent.click(await screen.findByRole('button', { name: /Ahmet Yılmaz.*₺0,00/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: customer.id }));
  });

  it('adds a new customer inline', async () => {
    const onPick = vi.fn();
    await renderWithData(<CustomerPicker open onClose={vi.fn()} onPick={onPick} />);
    await userEvent.click(screen.getByRole('button', { name: 'Yeni müşteri' }));
    await userEvent.type(screen.getByLabelText('Müşteri adı'), 'Fatma Teyze');
    await userEvent.click(screen.getByRole('button', { name: 'Ekle' }));
    await vi.waitFor(() =>
      expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ name: 'Fatma Teyze' })),
    );
  });
});
