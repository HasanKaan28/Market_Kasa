import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CartLine } from './cart';
import { LineDialog } from './LineDialog';

const line = (overrides: Partial<CartLine> = {}): CartLine => ({
  productId: 'e',
  name: 'Ekmek',
  unit: 'piece',
  unitPrice: 1500,
  vatRate: 1,
  qtyMilli: 2000,
  lineDiscount: 0,
  ...overrides,
});

function setup(value: CartLine) {
  const dispatch = vi.fn();
  const onClose = vi.fn();
  render(<LineDialog open line={value} dispatch={dispatch} onClose={onClose} />);
  return { dispatch, onClose };
}

describe('LineDialog', () => {
  it('sets a weighed quantity', async () => {
    const cheese = line({ productId: 'p', name: 'Peynir', unit: 'kg', unitPrice: 18990, qtyMilli: 1000 });
    const { dispatch, onClose } = setup(cheese);
    const field = screen.getByLabelText('Miktar (kg)');
    await userEvent.clear(field);
    await userEvent.type(field, '1,250');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'setQuantity', productId: 'p', qtyMilli: 1250 });
    expect(onClose).toHaveBeenCalled();
  });

  it('applies a percentage discount to the line', async () => {
    const { dispatch } = setup(line());
    await userEvent.click(screen.getByRole('radio', { name: 'Yüzde (%)' }));
    await userEvent.type(screen.getByLabelText('İndirim'), '10');
    expect(screen.getByTestId('line-total')).toHaveTextContent('₺27,00');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'setLineDiscount', productId: 'e', amount: 300 });
  });

  it('refuses a discount above the line', async () => {
    const { dispatch } = setup(line());
    await userEvent.type(screen.getByLabelText('İndirim'), '40');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(await screen.findByText('İndirim satır tutarını aşamaz.')).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('refuses a fractional quantity for a piece', async () => {
    const { dispatch } = setup(line());
    const field = screen.getByLabelText('Miktar');
    await userEvent.clear(field);
    await userEvent.type(field, '1,5');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(await screen.findByText('Geçerli bir miktar girin.')).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('removes the line', async () => {
    const { dispatch, onClose } = setup(line());
    await userEvent.click(screen.getByRole('button', { name: 'Satırı sil' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'remove', productId: 'e' });
    expect(onClose).toHaveBeenCalled();
  });
});
