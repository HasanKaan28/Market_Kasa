import { describe, expect, it } from 'vitest';
import type { ProductRecord } from '@/data/types';
import { cartReducer, cartTotals, emptyCart, loadCart, saveCart, type Cart } from './cart';

const product = (id: string, name: string, sellPrice: number): ProductRecord => ({
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
const ekmek = product('ekmek', 'Ekmek', 1500);
const ayran = product('ayran', 'Ayran', 2250);
const peynir = product('peynir', 'Beyaz Peynir', 18990);
const cay = product('cay', 'Siyah Çay', 27900);

function mockupCart(): Cart {
  let cart = emptyCart('cart-1');
  for (const p of [ekmek, ekmek, ayran, ayran, ayran, peynir, cay]) {
    cart = cartReducer(cart, { type: 'add', product: p });
  }
  return cart;
}

describe('cart', () => {
  it('merges repeated products and totals the mockup cart', () => {
    const cart = mockupCart();
    expect(cart.lines.map((l) => [l.name, l.qtyMilli])).toEqual([
      ['Ekmek', 2000],
      ['Ayran', 3000],
      ['Beyaz Peynir', 1000],
      ['Siyah Çay', 1000],
    ]);
    expect(cartTotals(cart)).toMatchObject({ total: 56640, vatTotal: 561 });
  });

  it('removes a line when it is decremented to zero', () => {
    const cart = cartReducer(cartReducer(emptyCart('c'), { type: 'add', product: cay }), {
      type: 'decrement',
      productId: 'cay',
    });
    expect(cart.lines).toEqual([]);
  });

  it('starts a new cart with a new id when cleared', () => {
    const cleared = cartReducer(mockupCart(), { type: 'clear' });
    expect(cleared.lines).toEqual([]);
    expect(cleared.id).not.toBe('cart-1');
  });

  it('follows price changes made elsewhere', () => {
    const cart = mockupCart();
    const refreshed = cartReducer(cart, {
      type: 'refresh',
      products: [{ ...cay, sellPrice: 29900 }],
    });
    expect(refreshed.lines.find((l) => l.productId === 'cay')?.unitPrice).toBe(29900);
    expect(cartTotals(refreshed).total).toBe(58640);
    expect(cartReducer(cart, { type: 'refresh', products: [cay, ekmek] })).toBe(cart);
  });

  it('round-trips through storage', () => {
    const store = new Map<string, string>();
    saveCart(mockupCart(), { setItem: (k, v) => void store.set(k, v) });
    expect(loadCart({ getItem: (k) => store.get(k) ?? null })).toEqual(mockupCart());
  });

  it('opens an empty cart when the stored one is unreadable or storage fails', () => {
    for (const storage of [
      { getItem: () => '{"id":5,"lines":"x"}' },
      {
        getItem: () => {
          throw new Error('blocked');
        },
      },
    ]) {
      const cart = loadCart(storage);
      expect(cart.lines).toEqual([]);
      expect(typeof cart.id).toBe('string');
    }
    const failing = {
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(() => saveCart(mockupCart(), failing)).not.toThrow();
  });
});
