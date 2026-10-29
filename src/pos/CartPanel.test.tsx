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

describe('CartPanel', () => {
  it('shows the mockup cart totals', () => {
    render(
      <CartPanel
        cart={mockupCart()}
        dispatch={vi.fn()}
        onPay={vi.fn()}
        onEditLine={vi.fn()}
        onDiscount={vi.fn()}
      />,
    );
    expect(screen.getByText('4 kalem')).toBeInTheDocument();
    expect(screen.getByText('2 × ₺15,00')).toBeInTheDocument();
    expect(screen.getByTestId('total')).toHaveTextContent('₺566,40');
    expect(screen.getByTestId('vat')).toHaveTextContent('₺5,61');
    expect(screen.getByTestId('subtotal')).toHaveTextContent('₺566,40');
  });

  it('changes quantities, clears and starts payments', async () => {
    const dispatch = vi.fn();
    const onPay = vi.fn();
    render(
      <CartPanel
        cart={mockupCart()}
        dispatch={dispatch}
        onPay={onPay}
        onEditLine={vi.fn()}
        onDiscount={vi.fn()}
      />,
    );
    await userEvent.click(screen.getAllByRole('button', { name: 'Artır' })[0]!);
    expect(dispatch).toHaveBeenCalledWith({ type: 'increment', productId: 'e' });
    await userEvent.click(screen.getByRole('button', { name: 'Sepeti temizle' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'clear' });
    await userEvent.click(screen.getByRole('button', { name: 'Kart' }));
    expect(onPay).toHaveBeenCalledWith('card');
  });

  it('disables payment for an empty cart', () => {
    render(
      <CartPanel
        cart={emptyCart('c')}
        dispatch={vi.fn()}
        onPay={vi.fn()}
        onEditLine={vi.fn()}
        onDiscount={vi.fn()}
      />,
    );
    expect(screen.getByText('Sepet boş')).toBeInTheDocument();
    for (const name of ['Nakit', 'Kart', 'Veresiye']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });

  it('shows line and cart discounts', () => {
    let cart = cartReducer(mockupCart(), { type: 'setLineDiscount', productId: 'e', amount: 300 });
    cart = cartReducer(cart, { type: 'setCartDiscount', amount: 1000 });
    render(
      <CartPanel
        cart={cart}
        dispatch={vi.fn()}
        onPay={vi.fn()}
        onEditLine={vi.fn()}
        onDiscount={vi.fn()}
      />,
    );
    expect(screen.getByText('İndirim −₺3,00')).toBeInTheDocument();
    expect(screen.getByTestId('cart-discount')).toHaveTextContent('−₺10,00');
    expect(screen.getByTestId('total')).toHaveTextContent('₺553,40');
  });

  it('opens the line editor and the discount dialog', async () => {
    const onEditLine = vi.fn();
    const onDiscount = vi.fn();
    const onPay = vi.fn();
    render(
      <CartPanel
        cart={mockupCart()}
        dispatch={vi.fn()}
        onPay={onPay}
        onEditLine={onEditLine}
        onDiscount={onDiscount}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Düzenle · Ekmek' }));
    expect(onEditLine).toHaveBeenCalledWith('e');
    await userEvent.click(screen.getByRole('button', { name: 'İndirim' }));
    expect(onDiscount).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Bölünmüş' }));
    expect(onPay).toHaveBeenCalledWith('split');
  });

  it('shows rows and totals that add up with a cart discount', () => {
    let cart = cartReducer(emptyCart('c'), { type: 'add', product: p('e', 'Ekmek', 1500) });
    cart = cartReducer(cart, { type: 'add', product: p('s', 'Süt', 4250) });
    cart = cartReducer(cart, { type: 'setLineDiscount', productId: 's', amount: 250 });
    cart = cartReducer(cart, { type: 'setCartDiscount', amount: 500 });
    render(
      <CartPanel
        cart={cart}
        dispatch={vi.fn()}
        onPay={vi.fn()}
        onEditLine={vi.fn()}
        onDiscount={vi.fn()}
      />,
    );
    expect(screen.getByTestId('line-total-e')).toHaveTextContent('₺15,00');
    expect(screen.getByTestId('line-total-s')).toHaveTextContent('₺40,00');
    expect(screen.getByTestId('subtotal')).toHaveTextContent('₺55,00');
    expect(screen.getByTestId('cart-discount')).toHaveTextContent('−₺5,00');
    expect(screen.getByTestId('total')).toHaveTextContent('₺50,00');
    expect(screen.getByTestId('vat')).toHaveTextContent('₺0,50');
  });
});
