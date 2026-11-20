import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ProductRecord } from '@/data/types';
import { cartReducer, emptyCart, type Cart } from './cart';
import { DiscountDialog } from './DiscountDialog';

const p = (id: string, name: string, sellPrice: number): ProductRecord => ({
  id,
  name,
  sellPrice,
  vatRate: 1,
  unit: 'piece',
  buyPrice: 0,
  isQuick: false,
  criticalLevelMilli: 0,
  createdAt: '',
  updatedAt: '',
});

function mockupCart(): Cart {
  const e = p('e', 'Ekmek', 1500);
  const a = p('a', 'Ayran', 2250);
  let cart = emptyCart('c');
  for (const product of [
    e,
    e,
    a,
    a,
    a,
    p('b', 'Beyaz Peynir', 18990),
    p('c', 'Siyah Çay', 27900),
  ]) {
    cart = cartReducer(cart, { type: 'add', product });
  }
  return cart;
}

function setup(cart: Cart) {
  const dispatch = vi.fn();
  const onClose = vi.fn();
  render(<DiscountDialog open cart={cart} dispatch={dispatch} onClose={onClose} />);
  return { dispatch, onClose };
}

describe('DiscountDialog', () => {
  it('applies an amount', async () => {
    const { dispatch, onClose } = setup(mockupCart());
    await userEvent.type(screen.getByLabelText('İndirim'), '50');
    await userEvent.click(screen.getByRole('button', { name: 'Uygula' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'setCartDiscount', amount: 5000 });
    expect(onClose).toHaveBeenCalled();
  });

  it('applies a percentage of the subtotal', async () => {
    const { dispatch } = setup(mockupCart());
    await userEvent.click(screen.getByRole('radio', { name: 'Yüzde (%)' }));
    await userEvent.type(screen.getByLabelText('İndirim'), '10');
    expect(screen.getByTestId('discounted-total')).toHaveTextContent('₺509,76');
    await userEvent.click(screen.getByRole('button', { name: 'Uygula' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'setCartDiscount', amount: 5664 });
  });

  it('refuses more than the subtotal', async () => {
    const { dispatch } = setup(mockupCart());
    await userEvent.type(screen.getByLabelText('İndirim'), '600');
    await userEvent.click(screen.getByRole('button', { name: 'Uygula' }));
    expect(await screen.findByText('İndirim toplamı aşamaz.')).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('removes the discount', async () => {
    const { dispatch } = setup(
      cartReducer(mockupCart(), { type: 'setCartDiscount', amount: 1000 }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'İndirimi kaldır' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'setCartDiscount', amount: 0 });
  });
});
