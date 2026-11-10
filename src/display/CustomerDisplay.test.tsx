import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CART_STORAGE_KEY, emptyCart, saveCart, type Cart } from '@/pos/cart';
import { CustomerDisplay } from './CustomerDisplay';

afterEach(() => localStorage.clear());

const cart: Cart = {
  ...emptyCart('c1'),
  lines: [
    {
      productId: 'milk',
      name: 'Süt',
      unit: 'piece',
      unitPrice: 4250,
      vatRate: 1,
      qtyMilli: 2000,
      lineDiscount: 0,
    },
    {
      productId: 'cheese',
      name: 'Kaşar',
      unit: 'kg',
      unitPrice: 40000,
      vatRate: 1,
      qtyMilli: 250,
      lineDiscount: 0,
    },
  ],
};

/** What another window of the app does when the register's cart changes. */
function changeCart(next: Cart) {
  saveCart(next);
  act(() => {
    window.dispatchEvent(
      new StorageEvent('storage', { key: CART_STORAGE_KEY, newValue: JSON.stringify(next) }),
    );
  });
}

describe('CustomerDisplay', () => {
  it('greets with the market’s name while the cart is empty', () => {
    render(<CustomerDisplay marketName="Kurşunlu Market" />);
    expect(screen.getByRole('heading', { name: 'Kurşunlu Market' })).toBeInTheDocument();
    expect(screen.getByText('Hoş geldiniz')).toBeInTheDocument();
  });

  it('follows the register’s cart: the lines and the total to pay', () => {
    render(<CustomerDisplay marketName="Kurşunlu Market" />);
    changeCart(cart);
    expect(screen.getByText('Süt')).toBeInTheDocument();
    expect(screen.getByText('2 × ₺42,50')).toBeInTheDocument();
    expect(screen.getByText('0,25 kg × ₺400,00')).toBeInTheDocument();
    expect(screen.getByLabelText('Ödenecek')).toHaveTextContent('₺185,00');

    changeCart(emptyCart('c2'));
    expect(screen.getByText('Hoş geldiniz')).toBeInTheDocument();
  });

  it('shows the cart already there when it opens', () => {
    saveCart(cart);
    render(<CustomerDisplay marketName="Kurşunlu Market" />);
    expect(screen.getByLabelText('Ödenecek')).toHaveTextContent('₺185,00');
  });
});
