import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PaymentDialog } from './PaymentDialog';

const cash = (onConfirm = vi.fn()) =>
  render(
    <PaymentDialog open method="cash" total={56640} onClose={vi.fn()} onConfirm={onConfirm} />,
  );

describe('PaymentDialog', () => {
  it('shows the change and confirms the amount given', async () => {
    const onConfirm = vi.fn();
    cash(onConfirm);
    await userEvent.type(screen.getByLabelText('Alınan tutar'), '600');
    expect(screen.getByTestId('change')).toHaveTextContent('₺33,60');
    await userEvent.click(screen.getByRole('button', { name: 'Satışı tamamla' }));
    expect(onConfirm).toHaveBeenCalledWith(60000);
  });

  it('cannot complete with less than the total', async () => {
    cash();
    await userEvent.type(screen.getByLabelText('Alınan tutar'), '500');
    expect(screen.getByRole('button', { name: 'Satışı tamamla' })).toBeDisabled();
  });

  it('takes the exact total when nothing is typed, or typed with kuruş', async () => {
    const onConfirm = vi.fn();
    cash(onConfirm);
    await userEvent.click(screen.getByRole('button', { name: 'Satışı tamamla' }));
    await userEvent.type(screen.getByLabelText('Alınan tutar'), '566,40{Enter}');
    expect(onConfirm.mock.calls).toEqual([[56640], [56640]]);
  });

  it('fills a suggested amount', async () => {
    cash();
    await userEvent.click(screen.getByRole('button', { name: '₺600,00' }));
    expect(screen.getByTestId('change')).toHaveTextContent('₺33,60');
  });

  it('confirms a card payment of the total', async () => {
    const onConfirm = vi.fn();
    render(
      <PaymentDialog open method="card" total={56640} onClose={vi.fn()} onConfirm={onConfirm} />,
    );
    expect(screen.getByRole('dialog', { name: 'Kart ile ödeme' })).toHaveTextContent('₺566,40');
    await userEvent.click(screen.getByRole('button', { name: 'Satışı tamamla' }));
    expect(onConfirm).toHaveBeenCalledWith();
  });
});
