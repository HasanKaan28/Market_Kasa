import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ProductRecord } from '@/data/types';
import { cartReducer, emptyCart, type Cart } from './cart';
import { CartPanel } from './CartPanel';

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
  for (const product of [e, e, a, a, a, p('b', 'Beyaz Peynir', 18990), p('c', 'Siyah Çay', 27900)]) {
    cart = cartReducer(cart, { type: 'add', product });
  }
  return cart;
}

describe('CartPanel', () => {
  it('shows the mockup cart totals', () => {
    render(<CartPanel cart={mockupCart()} dispatch={vi.fn()} onPay={vi.fn()} />);
    expect(screen.getByText('4 kalem')).toBeInTheDocument();
    expect(screen.getByText('2 × ₺15,00')).toBeInTheDocument();
    expect(screen.getByTestId('total')).toHaveTextContent('₺566,40');
    expect(screen.getByTestId('vat')).toHaveTextContent('₺5,61');
    expect(screen.getByTestId('net')).toHaveTextContent('₺560,79');
  });

  it('changes quantities, clears and starts payments', async () => {
    const dispatch = vi.fn();
    const onPay = vi.fn();
    render(<CartPanel cart={mockupCart()} dispatch={dispatch} onPay={onPay} />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Artır' })[0]!);
    expect(dispatch).toHaveBeenCalledWith({ type: 'increment', productId: 'e' });
    await userEvent.click(screen.getByRole('button', { name: 'Sepeti temizle' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'clear' });
    await userEvent.click(screen.getByRole('button', { name: 'Kart' }));
    expect(onPay).toHaveBeenCalledWith('card');
  });

  it('disables payment for an empty cart', () => {
    render(<CartPanel cart={emptyCart('c')} dispatch={vi.fn()} onPay={vi.fn()} />);
    expect(screen.getByText('Sepet boş')).toBeInTheDocument();
    for (const name of ['Nakit', 'Kart', 'Veresiye']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });
});
