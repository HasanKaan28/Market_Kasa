import { describe, expect, it } from 'vitest';
import type { ProductRecord } from '@/data/types';
import { cartReducer, emptyCart, type Cart } from './cart';
import { holdCart, loadHeld, MAX_HELD, saveHeld, takeHeld, type HeldCart } from './held';

const milk: ProductRecord = {
  id: 'p',
  name: 'Süt',
  sellPrice: 4250,
  vatRate: 1,
  unit: 'piece',
  buyPrice: 0,
  isQuick: false,
  criticalLevelMilli: 0,
  createdAt: '',
  updatedAt: '',
};
const cartWith = (id: string): Cart => cartReducer(emptyCart(id), { type: 'add', product: milk });
const at = (minute: number) => new Date(Date.UTC(2026, 9, 29, 9, minute));

describe('held carts', () => {
  it('holds the newest cart first and takes one back by id', () => {
    const held = holdCart(holdCart([], cartWith('a'), at(1)), cartWith('b'), at(2));
    expect(held.map((h) => h.cart.id)).toEqual(['b', 'a']);
    const { cart, rest } = takeHeld(held, 'a');
    expect(cart.id).toBe('a');
    expect(rest.map((h) => h.cart.id)).toEqual(['b']);
    expect(() => takeHeld(rest, 'a')).toThrow(RangeError);
  });

  it('refuses an empty cart and a full list', () => {
    expect(() => holdCart([], emptyCart('x'), at(1))).toThrow(RangeError);
    let held: HeldCart[] = [];
    for (let i = 0; i < MAX_HELD; i += 1) {
      held = holdCart(held, cartWith(`c${i}`), at(i));
    }
    expect(() => holdCart(held, cartWith('extra'), at(30))).toThrow(RangeError);
  });

  it('round-trips held carts', () => {
    const store = new Map<string, string>();
    const held = holdCart([], cartWith('a'), at(1));
    saveHeld(held, { setItem: (k, v) => void store.set(k, v) });
    expect(loadHeld({ getItem: (k) => store.get(k) ?? null })).toEqual(held);
  });

  it('opens with no held carts when the stored list is unreadable', () => {
    expect(loadHeld({ getItem: () => 'not json' })).toEqual([]);
    expect(
      loadHeld({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toEqual([]);
    const [good] = holdCart([], cartWith('a'), at(1));
    const stored = JSON.stringify([good, { cart: { id: 5 }, heldAt: 'x' }, { cart: cartWith('b') }]);
    expect(loadHeld({ getItem: () => stored })).toEqual([good]);
  });
});
